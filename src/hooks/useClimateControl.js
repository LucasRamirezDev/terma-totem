import { useState, useEffect, useCallback } from 'react';
import {
  MIN_TEMP,
  MAX_TEMP,
  DEFAULT_TARGET_TEMP,
  DEFAULT_SIMULATED_TEMP,
  TEMP_STEP,
} from '../constants/climate';
import { esp32 } from '../services/esp32Client';

/**
 * Hook para gestionar el estado, la simulación física ambiental
 * y la comunicación bidireccional con el firmware ESP32-S3.
 */
export function useClimateControl() {
  const [target, setTarget] = useState(DEFAULT_TARGET_TEMP);
  const [actual, setActual] = useState(DEFAULT_SIMULATED_TEMP);
  const [enabled, setEnabled] = useState(false);
  const [light, setLight] = useState(true);
  const [simulation, setSimulation] = useState(true);
  const [espState, setEspState] = useState({
    connected: false,
    message: '',
    ip: esp32.targetIp,
  });

  // Conexión y escucha de eventos del ESP32
  useEffect(() => {
    esp32.connect();

    const unsubscribeStatus = esp32.onStatusChange(status => {
      setEspState(status);
    });

    const unsubscribeData = esp32.onMessage(data => {
      // Si el ESP32 envía telemetría real de sensores y actuadores
      if (typeof data.actualTemperature === 'number') {
        setActual(data.actualTemperature);
      }
      if (typeof data.targetTemperature === 'number') {
        setTarget(data.targetTemperature);
      }
      if (typeof data.power === 'boolean') {
        setEnabled(data.power);
      }
      if (typeof data.light === 'boolean') {
        setLight(data.light);
      }
    });

    return () => {
      unsubscribeStatus();
      unsubscribeData();
    };
  }, []);

  // Estados térmicos calculados
  const heating = enabled && actual < target - 0.3;
  const cooling = enabled && actual > target + 0.3;

  // Texto descriptivo del estado
  const status = !enabled
    ? 'Apagado'
    : heating
      ? 'Calentando'
      : cooling
        ? 'Enfriando'
        : 'Estable';

  // Velocidad de ventiladores según demanda térmica
  const rpm = !enabled
    ? 0
    : heating
      ? Math.min(100, Math.max(35, Math.round(40 + (target - actual) * 12)))
      : cooling
        ? Math.min(100, Math.max(35, Math.round(40 + (actual - target) * 12)))
        : 30;

  // Modo y clases CSS para el LED
  const led = !enabled
    ? 'red'
    : heating
      ? 'blink'
      : cooling
        ? 'blink cyan'
        : 'green';

  // Etiqueta legible del LED de estado
  const ledLabel = !enabled
    ? 'Rojo fijo'
    : heating
      ? 'Verde intermitente'
      : cooling
        ? 'Celeste intermitente'
        : 'Verde fijo';

  // Simulación física de temperatura (activa solo cuando no hay ESP32 enviando lecturas reales)
  useEffect(() => {
    if (!simulation || espState.connected) return;

    const timer = setInterval(() => {
      setActual(v => {
        const aim = enabled ? target : DEFAULT_SIMULATED_TEMP;
        const diff = aim - v;
        if (Math.abs(diff) < 0.04) return aim;

        const rate = enabled ? 0.12 : 0.08;
        const delta = Math.sign(diff) * Math.min(Math.abs(diff), rate);
        return Math.round((v + delta) * 10) / 10;
      });
    }, 550);

    return () => clearInterval(timer);
  }, [enabled, target, simulation, espState.connected]);

  // Emisión de evento local en ventana para integraciones por WebView o scripts
  useEffect(() => {
    const payload = {
      power: enabled,
      targetTemperature: target,
      simulatedTemperature: actual,
      fanSpeed: rpm,
      systemStatus: status.toLowerCase(),
      lightEnabled: light,
      ledMode: !enabled
        ? 'red'
        : heating
          ? 'blink-green'
          : cooling
            ? 'blink-cyan'
            : 'green',
      espConnected: espState.connected,
    };

    window.dispatchEvent(new CustomEvent('TERMA:state', { detail: payload }));
  }, [enabled, target, actual, rpm, status, light, led, heating, cooling, espState.connected]);

  // Controles de usuario con envío instantáneo a ESP32
  const increaseTemp = useCallback(() => {
    setTarget(t => {
      const next = Math.min(MAX_TEMP, Math.round((t + TEMP_STEP) * 10) / 10);
      esp32.sendTarget(next);
      return next;
    });
  }, []);

  const decreaseTemp = useCallback(() => {
    setTarget(t => {
      const next = Math.max(MIN_TEMP, Math.round((t - TEMP_STEP) * 10) / 10);
      esp32.sendTarget(next);
      return next;
    });
  }, []);

  const togglePower = useCallback(() => {
    setEnabled(v => {
      const next = !v;
      esp32.sendPower(next);
      return next;
    });
  }, []);

  const toggleLight = useCallback(() => {
    setLight(v => {
      const next = !v;
      esp32.sendLight(next);
      return next;
    });
  }, []);

  const setManualActual = useCallback((value) => {
    setActual(Number(value));
  }, []);

  const setSimulationEnabled = useCallback((value) => {
    setSimulation(Boolean(value));
  }, []);

  const setEspIp = useCallback((ip) => {
    esp32.setTargetIp(ip);
  }, []);

  return {
    target,
    actual,
    enabled,
    light,
    simulation,
    heating,
    cooling,
    status,
    rpm,
    led,
    ledLabel,
    espState,
    increaseTemp,
    decreaseTemp,
    togglePower,
    toggleLight,
    setManualActual,
    setSimulationEnabled,
    setEspIp,
  };
}
