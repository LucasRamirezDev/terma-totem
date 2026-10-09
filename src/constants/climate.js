export const MIN_TEMP = 15.0;
export const MAX_TEMP = 30.0;
export const DEFAULT_TARGET_TEMP = 18.0;
export const DEFAULT_SIMULATED_TEMP = 20.0;
export const TEMP_STEP = 0.5;

export const SCALE_MARKS = [15, 20, 30];

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
