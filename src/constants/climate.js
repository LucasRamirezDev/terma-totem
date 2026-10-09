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
 * de los 3 ventiladores de 12V según demanda térmica.
 * 
 * NOTA: Representa porcentaje de comando PWM, no RPM medidas físicamente.
 */
export function calculateFanPwm(power, heating, cooling, target, actual) {
  if (!power) return 0;
  if (heating) {
    return Math.min(100, Math.max(35, Math.round(40 + (target - actual) * 12)));
  }
  if (cooling) {
    return Math.min(100, Math.max(35, Math.round(40 + (actual - target) * 12)));
  }
  return 30; // Velocidad de recirculación base en reposo
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
