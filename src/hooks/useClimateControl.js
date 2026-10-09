import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  MIN_TEMP,
  MAX_TEMP,
  DEFAULT_TARGET_TEMP,
  DEFAULT_SIMULATED_TEMP,
  TEMP_STEP,
  TEMP_TOLERANCE,
  SYSTEM_STATUS,
  LED_MODES,
  CONNECTION_MODE,
  calculateFanPwm,
  getLedPresentation,
} from '../constants/climate.js';
import { esp32 } from '../services/esp32Client.js';

/**
 * TERMA - Hook de Control Climático
 * 
 * Separa estrictamente:
 * 1. MODO SIMULACIÓN: Motor de física local en React cuando se prueba sin hardware.
 * 2. MODO CONECTADO: ESP32-S3 como única fuente de verdad (sensores, PWM y actuadores).
 * 3. MODO DESCONECTADO: Congela el último estado conocido sin suponer apagado ni mutar datos.
 */
export function useClimateControl() {
  // Modo de operación seleccionado por el usuario: 'auto' (intenta conectar a ESP32) o 'simulation' (forzado offline)
  const [userMode, setUserMode] = useState(() => {
    try {
      return localStorage.getItem('TERMA_op_mode') || 'auto';
    } catch {
      return 'auto';
    }
  });

  // Estado de enlace WebSocket con ESP32
  const [espState, setEspState] = useState({
    connected: false,
    state: 'disconnected',
    message: 'Inicializando enlace...',
    ip: esp32.targetIp,
  });

  // =========================================================================
  // 1. ESTADO DEL MODO SIMULACIÓN (React es el controlador)
  // =========================================================================
  const [simState, setSimState] = useState({
    target: DEFAULT_TARGET_TEMP,
    actual: DEFAULT_SIMULATED_TEMP,
    power: false,
    light: true,
  });

  // =========================================================================
  // 2. ESTADO DEL MODO CONECTADO (ESP32 es la única fuente de verdad)
  // =========================================================================
  const [connectedState, setConnectedState] = useState({
    target: DEFAULT_TARGET_TEMP,
    actual: DEFAULT_SIMULATED_TEMP,
    power: false,
    light: true,
    fanSpeed: 0,
    systemStatus: SYSTEM_STATUS.OFF,
    ledMode: LED_MODES.RED,
    lastUpdate: null,
  });

  // Bloqueos de comandos en tránsito para evitar ráfagas duplicadas o contradictorias
  const pendingTargetRef = useRef(null);
  const powerPendingRef = useRef(false);
  const lightPendingRef = useRef(false);
  const [pendingCommand, setPendingCommand] = useState(null);

  // =========================================================================
  // CONEXIÓN Y SUSCRIPCIÓN A TELEMETRÍA DEL ESP32
  // =========================================================================
  useEffect(() => {
    if (userMode !== 'simulation') {
      esp32.connect();
    } else {
      esp32.disconnect();
    }

    const unsubscribeStatus = esp32.onStatusChange(status => {
      setEspState(status);
      if (!status.connected) {
        // Al desconectarse, liberar bloqueos en vuelo sin alterar el último estado confirmado
        pendingTargetRef.current = null;
        powerPendingRef.current = false;
        lightPendingRef.current = false;
        setPendingCommand(null);
      }
    });

    const unsubscribeData = esp32.onMessage(data => {
      // Telemetría oficial transmitida y sanitizada desde el firmware del ESP32-S3
      setConnectedState(prev => {
        const next = { ...prev, lastUpdate: Date.now() };

        if (typeof data.actualTemperature === 'number') {
          next.actual = data.actualTemperature;
        }
        if (typeof data.targetTemperature === 'number') {
          next.target = data.targetTemperature;
        }
        if (typeof data.power === 'boolean') {
          next.power = data.power;
        }
        if (typeof data.light === 'boolean') {
          next.light = data.light;
        }
        if (typeof data.fanSpeed === 'number') {
          next.fanSpeed = data.fanSpeed;
        }
        if (typeof data.systemStatus === 'string') {
          next.systemStatus = data.systemStatus;
        }
        if (typeof data.ledMode === 'string') {
          next.ledMode = data.ledMode;
        }

        return next;
      });

      // Si la temperatura objetivo confirmada coincide con la consigna en cola, liberar la referencia
      if (pendingTargetRef.current !== null && data.targetTemperature === pendingTargetRef.current) {
        pendingTargetRef.current = null;
      }
    });

    return () => {
      unsubscribeStatus();
      unsubscribeData();
    };
  }, [userMode]);

  // =========================================================================
  // DETERMINACIÓN DEL MODO DE OPERACIÓN ACTIVO
  // =========================================================================
  const activeMode = useMemo(() => {
    if (userMode === 'simulation') {
      return CONNECTION_MODE.SIMULATION;
    }
    if (espState.connected) {
      return CONNECTION_MODE.CONNECTED;
    }
    if (espState.state === 'connecting') {
      return CONNECTION_MODE.CONNECTING;
    }
    return CONNECTION_MODE.DISCONNECTED;
  }, [userMode, espState.connected, espState.state]);

  // =========================================================================
  // CÁLCULOS TÉRMICOS DE LA SIMULACIÓN LOCAL
  // Ejecutados EXCLUSIVAMENTE cuando se encuentra en modo simulación
  // =========================================================================
  const simHeating = simState.power && simState.actual < simState.target - TEMP_TOLERANCE;
  const simCooling = simState.power && simState.actual > simState.target + TEMP_TOLERANCE;

  const simStatus = !simState.power
    ? SYSTEM_STATUS.OFF
    : simHeating
      ? SYSTEM_STATUS.HEATING
      : simCooling
        ? SYSTEM_STATUS.COOLING
        : SYSTEM_STATUS.STABLE;

  const simFanPwm = calculateFanPwm(
    simState.power,
    simState.target,
    simState.actual
  );

  const simLedMode = !simState.power
    ? LED_MODES.RED
    : simHeating
      ? LED_MODES.BLINK_GREEN
      : simCooling
        ? LED_MODES.BLINK_CYAN
        : LED_MODES.GREEN;

  // Temporizador físico de la simulación local (solo activo en modo simulación)
  useEffect(() => {
    if (activeMode !== CONNECTION_MODE.SIMULATION) return;

    const timer = setInterval(() => {
      setSimState(prev => {
        const aim = prev.power ? prev.target : DEFAULT_SIMULATED_TEMP;
        const diff = aim - prev.actual;
        if (Math.abs(diff) < 0.04) return { ...prev, actual: aim };

        const rate = prev.power ? 0.12 : 0.08;
        const delta = Math.sign(diff) * Math.min(Math.abs(diff), rate);
        const nextActual = Math.round((prev.actual + delta) * 10) / 10;
        return { ...prev, actual: nextActual };
      });
    }, 550);

    return () => clearInterval(timer);
  }, [activeMode]);

  // =========================================================================
  // CONSOLIDACIÓN DEL ESTADO FINAL PARA LA INTERFAZ
  // =========================================================================
  const currentTarget = activeMode === CONNECTION_MODE.SIMULATION ? simState.target : connectedState.target;
  const currentActual = activeMode === CONNECTION_MODE.SIMULATION ? simState.actual : connectedState.actual;
  const currentPower = activeMode === CONNECTION_MODE.SIMULATION ? simState.power : connectedState.power;
  const currentLight = activeMode === CONNECTION_MODE.SIMULATION ? simState.light : connectedState.light;
  const currentFanPwm = activeMode === CONNECTION_MODE.SIMULATION ? simFanPwm : connectedState.fanSpeed;
  const rawStatus = activeMode === CONNECTION_MODE.SIMULATION ? simStatus : connectedState.systemStatus;
  const rawLedMode = activeMode === CONNECTION_MODE.SIMULATION ? simLedMode : connectedState.ledMode;

  // Formato para UI (Mayúscula inicial)
  const statusFormatted = useMemo(() => {
    switch (rawStatus) {
      case SYSTEM_STATUS.HEATING:
        return 'Calentando';
      case SYSTEM_STATUS.COOLING:
        return 'Enfriando';
      case SYSTEM_STATUS.STABLE:
        return 'Estable';
      case SYSTEM_STATUS.OFF:
      default:
        return 'Apagado';
    }
  }, [rawStatus]);

  const { className: ledClassName, label: ledLabel } = getLedPresentation(rawLedMode);

  // Emisión de evento en ventana para telemetría o testing
  useEffect(() => {
    const payload = {
      mode: activeMode,
      power: currentPower,
      targetTemperature: currentTarget,
      actualTemperature: currentActual,
      fanSpeed: currentFanPwm,
      systemStatus: rawStatus,
      lightEnabled: currentLight,
      ledMode: rawLedMode,
      pendingCommand: Boolean(pendingCommand),
      isStale: activeMode === CONNECTION_MODE.DISCONNECTED && connectedState.lastUpdate !== null,
    };

    window.dispatchEvent(new CustomEvent('TERMA:state', { detail: payload }));
  }, [
    activeMode,
    currentPower,
    currentTarget,
    currentActual,
    currentFanPwm,
    rawStatus,
    currentLight,
    rawLedMode,
    pendingCommand,
    connectedState.lastUpdate,
  ]);

  // =========================================================================
  // CONTROLADORES DE ACCIONES DE USUARIO
  // En modo Simulación: modifican el estado local reactivo.
  // En modo Conectado: transmiten el comando al ESP32 con confirmación explícita ACK.
  // =========================================================================
  const increaseTemp = useCallback(() => {
    if (activeMode === CONNECTION_MODE.SIMULATION) {
      const nextTemp = Math.min(MAX_TEMP, Math.round((simState.target + TEMP_STEP) * 10) / 10);
      if (nextTemp !== simState.target) {
        setSimState(prev => ({ ...prev, target: nextTemp }));
      }
    } else if (activeMode === CONNECTION_MODE.CONNECTED) {
      const baseTarget = pendingTargetRef.current !== null ? pendingTargetRef.current : connectedState.target;
      const nextTemp = Math.min(MAX_TEMP, Math.round((baseTarget + TEMP_STEP) * 10) / 10);
      if (nextTemp === baseTarget) return;

      pendingTargetRef.current = nextTemp;
      setPendingCommand(prev => ({ ...prev, target: nextTemp }));

      esp32.sendTarget(nextTemp)
        .then(() => {
          if (pendingTargetRef.current === nextTemp) {
            pendingTargetRef.current = null;
          }
        })
        .catch(err => {
          console.warn('[TERMA] Error o timeout en comando setTarget:', err.message);
          if (pendingTargetRef.current === nextTemp) {
            pendingTargetRef.current = null;
          }
        })
        .finally(() => {
          setPendingCommand(prev => {
            if (!prev) return null;
            const next = { ...prev };
            delete next.target;
            return Object.keys(next).length > 0 ? next : null;
          });
        });
    }
  }, [activeMode, simState.target, connectedState.target]);

  const decreaseTemp = useCallback(() => {
    if (activeMode === CONNECTION_MODE.SIMULATION) {
      const nextTemp = Math.max(MIN_TEMP, Math.round((simState.target - TEMP_STEP) * 10) / 10);
      if (nextTemp !== simState.target) {
        setSimState(prev => ({ ...prev, target: nextTemp }));
      }
    } else if (activeMode === CONNECTION_MODE.CONNECTED) {
      const baseTarget = pendingTargetRef.current !== null ? pendingTargetRef.current : connectedState.target;
      const nextTemp = Math.max(MIN_TEMP, Math.round((baseTarget - TEMP_STEP) * 10) / 10);
      if (nextTemp === baseTarget) return;

      pendingTargetRef.current = nextTemp;
      setPendingCommand(prev => ({ ...prev, target: nextTemp }));

      esp32.sendTarget(nextTemp)
        .then(() => {
          if (pendingTargetRef.current === nextTemp) {
            pendingTargetRef.current = null;
          }
        })
        .catch(err => {
          console.warn('[TERMA] Error o timeout en comando setTarget:', err.message);
          if (pendingTargetRef.current === nextTemp) {
            pendingTargetRef.current = null;
          }
        })
        .finally(() => {
          setPendingCommand(prev => {
            if (!prev) return null;
            const next = { ...prev };
            delete next.target;
            return Object.keys(next).length > 0 ? next : null;
          });
        });
    }
  }, [activeMode, simState.target, connectedState.target]);

  const togglePower = useCallback(() => {
    if (activeMode === CONNECTION_MODE.SIMULATION) {
      setSimState(prev => ({ ...prev, power: !prev.power }));
      return;
    }

    if (activeMode === CONNECTION_MODE.CONNECTED) {
      // Protección: Si ya existe una orden de POWER en vuelo, bloquear una segunda orden contradictoria
      if (powerPendingRef.current) return;

      const nextPower = !connectedState.power;
      powerPendingRef.current = true;
      setPendingCommand(prev => ({ ...prev, power: true }));

      esp32.sendPower(nextPower)
        .then(() => {
          // Confirmación positiva recibida del ESP32
        })
        .catch(err => {
          console.warn('[TERMA] Error o timeout en comando setPower:', err.message);
          // Ante fallo o timeout, el estado se mantiene en el último confirmado por el hardware
        })
        .finally(() => {
          powerPendingRef.current = false;
          setPendingCommand(prev => {
            if (!prev) return null;
            const next = { ...prev };
            delete next.power;
            return Object.keys(next).length > 0 ? next : null;
          });
        });
    }
  }, [activeMode, connectedState.power]);

  const toggleLight = useCallback(() => {
    if (activeMode === CONNECTION_MODE.SIMULATION) {
      setSimState(prev => ({ ...prev, light: !prev.light }));
      return;
    }

    if (activeMode === CONNECTION_MODE.CONNECTED) {
      // Protección: Si ya existe una orden de LUZ en vuelo, bloquear una segunda orden contradictoria
      if (lightPendingRef.current) return;

      const nextLight = !connectedState.light;
      lightPendingRef.current = true;
      setPendingCommand(prev => ({ ...prev, light: true }));

      esp32.sendLight(nextLight)
        .then(() => {
          // Confirmación positiva recibida del ESP32
        })
        .catch(err => {
          console.warn('[TERMA] Error o timeout en comando setLight:', err.message);
          // Ante fallo o timeout, el estado se mantiene en el último confirmado por el hardware
        })
        .finally(() => {
          lightPendingRef.current = false;
          setPendingCommand(prev => {
            if (!prev) return null;
            const next = { ...prev };
            delete next.light;
            return Object.keys(next).length > 0 ? next : null;
          });
        });
    }
  }, [activeMode, connectedState.light]);

  // Control explícito de modo (Simulación vs Hardware)
  const setMode = useCallback((mode) => {
    setUserMode(mode);
    try {
      localStorage.setItem('TERMA_op_mode', mode);
    } catch {
      // Ignorar errores
    }
    if (mode === 'simulation') {
      esp32.disconnect();
    } else {
      esp32.reconnect();
    }
  }, []);

  const setEspIp = useCallback((ip) => {
    esp32.setTargetIp(ip);
  }, []);

  const reconnect = useCallback(() => {
    setUserMode('auto');
    try {
      localStorage.setItem('TERMA_op_mode', 'auto');
    } catch {
      // Ignorar errores
    }
    esp32.reconnect();
  }, []);

  return {
    // Lecturas y estado consolidados
    target: currentTarget,
    actual: currentActual,
    enabled: currentPower,
    light: currentLight,
    fanSpeed: currentFanPwm,
    rpm: currentFanPwm, // Alias retrocompatible
    status: statusFormatted,
    led: ledClassName,
    ledLabel,

    // Conexión y arquitectura
    activeMode,
    isPending: Boolean(pendingCommand),
    isStale: activeMode === CONNECTION_MODE.DISCONNECTED && connectedState.lastUpdate !== null,
    espState,

    // Acciones
    increaseTemp,
    decreaseTemp,
    togglePower,
    toggleLight,
    setMode,
    reconnect,
    setEspIp,
  };
}
