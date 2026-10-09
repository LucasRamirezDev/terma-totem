/**
 * TERMA - Constantes del sistema de climatización y protocolo ESP32-S3
 */

// Rangos térmicos de operación
export const MIN_TEMP = 15.0;
export const MAX_TEMP = 30.0;
export const DEFAULT_TARGET_TEMP = 18.0;
export const DEFAULT_SIMULATED_TEMP = 20.0;
export const TEMP_STEP = 0.5;
export const TEMP_TOLERANCE = 0.3; // Histéresis térmica (±0.3 °C)

// Marcas visuales de la escala
export const SCALE_MARKS = [15, 20, 30];

// Red y WebSocket predeterminados
export const DEFAULT_ESP32_IP = '192.168.4.1';
export const DEFAULT_WS_PATH = '/ws';

// Modos de conexión de la aplicación
export const CONNECTION_MODE = {
  SIMULATION: 'simulation',     // Simulación térmica local en React
  CONNECTING: 'connecting',     // Estableciendo enlace WebSocket
  CONNECTED: 'connected',       // ESP32 conectado (fuente de verdad única)
  DISCONNECTED: 'disconnected', // Enlace perdido (mantiene último estado conocido)
};

// Estados térmicos del sistema
export const SYSTEM_STATUS = {
  OFF: 'apagado',
  HEATING: 'calentando',
  COOLING: 'enfriando',
  STABLE: 'estable',
};

// Modos del indicador LED RGB
export const LED_MODES = {
  RED: 'red',                  // Apagado: rojo fijo
  BLINK_GREEN: 'blink-green',  // Calentando: verde intermitente
  BLINK_CYAN: 'blink-cyan',    // Enfriando: celeste intermitente
  GREEN: 'green',              // Estable: verde fijo
};

/**
 * Mapeo de modo LED a clases CSS y etiquetas legibles
 */
export function getLedPresentation(ledMode) {
  switch (ledMode) {
    case LED_MODES.RED:
    case 'red':
      return { className: 'red', label: 'Rojo fijo' };
    case LED_MODES.BLINK_GREEN:
    case 'blink-green':
    case 'blink':
      return { className: 'blink', label: 'Verde intermitente' };
    case LED_MODES.BLINK_CYAN:
    case 'blink-cyan':
    case 'blink cyan':
      return { className: 'blink cyan', label: 'Celeste intermitente' };
    case LED_MODES.GREEN:
    case 'green':
    default:
      return { className: 'green', label: 'Verde fijo' };
  }
}

/**
 * Calcula el ciclo de trabajo PWM (0 a 100%) para el control común
 * de los 3 ventiladores de 12V según demanda térmica:
 * 
 * Fórmula:
 * - Apagado: 0%
 * - En demanda (|consigna - actual| > 0.3°C):
 *     clamp(round(40 + |consigna - actual| * 12), 35, 100)
 * - En reposo / estable (|consigna - actual| <= 0.3°C):
 *     30% (recirculación de aire base)
 * 
 * Soporta ambas firmas:
 * - calculateFanPwm(power, target, actual)
 * - calculateFanPwm(power, heating, cooling, target, actual) [retrocompatible]
 * 
 * NOTA: Representa porcentaje de comando PWM, no RPM medidas físicamente.
 */
export function calculateFanPwm(power, arg1, arg2, arg3, arg4) {
  if (!power) return 0;

  let target;
  let actual;

  if (typeof arg3 === 'number' && typeof arg4 === 'number') {
    // Firma extendida: (power, heating, cooling, target, actual)
    target = arg3;
    actual = arg4;
  } else if (typeof arg1 === 'number' && typeof arg2 === 'number') {
    // Firma directa: (power, target, actual)
    target = arg1;
    actual = arg2;
  } else {
    return 30;
  }

  const diff = Math.abs(target - actual);
  if (diff > TEMP_TOLERANCE) {
    return Math.min(100, Math.max(35, Math.round(40 + diff * 12)));
  }
  return 30; // Velocidad de recirculación base en reposo
}

/**
 * Valida y sanitiza cualquier payload JSON recibido desde el ESP32-S3.
 * Protege a React de campos inexistentes, tipos corruptos, NaN o valores fuera de rango.
 */
export function validateEsp32Telemetry(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Payload no es un objeto válido', sanitized: null };
  }

  const sanitized = {};

  // Correlación de comando (ack)
  if (typeof data.ack === 'string' && data.ack.trim().length > 0) {
    sanitized.ack = data.ack.trim();
  }

  // Temperatura actual simulada/leída en el ESP32 (rango admisible: -20 °C a 85 °C)
  if (typeof data.actualTemperature === 'number' && !Number.isNaN(data.actualTemperature)) {
    if (data.actualTemperature >= -20 && data.actualTemperature <= 85) {
      sanitized.actualTemperature = Math.round(data.actualTemperature * 10) / 10;
    }
  }

  // Temperatura objetivo consignada (acotada entre MIN_TEMP y MAX_TEMP)
  if (typeof data.targetTemperature === 'number' && !Number.isNaN(data.targetTemperature)) {
    sanitized.targetTemperature = Math.max(
      MIN_TEMP,
      Math.min(MAX_TEMP, Math.round(data.targetTemperature * 10) / 10)
    );
  }

  // Encendido del sistema
  if (typeof data.power === 'boolean') {
    sanitized.power = data.power;
  }

  // Luz auxiliar (tira de 9 LED WS2812B)
  if (typeof data.light === 'boolean') {
    sanitized.light = data.light;
  }

  // Ciclo de trabajo PWM común para los 3 ventiladores (0% a 100%)
  if (typeof data.fanSpeed === 'number' && !Number.isNaN(data.fanSpeed)) {
    sanitized.fanSpeed = Math.max(0, Math.min(100, Math.round(data.fanSpeed)));
  }

  // Estado del sistema ('apagado', 'calentando', 'enfriando', 'estable')
  if (typeof data.systemStatus === 'string') {
    const s = data.systemStatus.toLowerCase().trim();
    if (Object.values(SYSTEM_STATUS).includes(s)) {
      sanitized.systemStatus = s;
    }
  }

  // Modo del indicador LED RGB ('red', 'blink-green', 'blink-cyan', 'green')
  if (typeof data.ledMode === 'string') {
    const l = data.ledMode.toLowerCase().trim();
    if (Object.values(LED_MODES).includes(l)) {
      sanitized.ledMode = l;
    }
  }

  return {
    valid: Object.keys(sanitized).length > 0,
    sanitized,
  };
}

/**
 * Calcula el avance porcentual de la barra de progreso
 * para que coincida exactamente con las marcas visuales (15°, 20°, 30°):
 * - 15°C a 20°C: 0% a 50%
 * - 20°C a 30°C: 50% a 100%
 */
export function calcProgressPercent(target) {
  if (target <= 20) {
    return Math.max(0, Math.min(50, (target - 15) * 10));
  }
  return Math.max(50, Math.min(100, 50 + (target - 20) * 5));
}
