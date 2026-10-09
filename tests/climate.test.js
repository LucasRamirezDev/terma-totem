import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_TEMP,
  MAX_TEMP,
  TEMP_TOLERANCE,
  SYSTEM_STATUS,
  LED_MODES,
  calculateFanPwm,
  calcProgressPercent,
  validateEsp32Telemetry,
  getLedPresentation,
} from '../src/constants/climate.js';

test('calculateFanPwm - Límites y fórmula unificada', () => {
  // 1. Apagado -> 0%
  assert.equal(calculateFanPwm(false, 25, 20), 0);
  assert.equal(calculateFanPwm(false, true, false, 25, 20), 0);

  // 2. Estable (dentro de histéresis ±0.3°C) -> 30% de recirculación base
  assert.equal(calculateFanPwm(true, 20.0, 20.0), 30);
  assert.equal(calculateFanPwm(true, 20.2, 20.0), 30);
  assert.equal(calculateFanPwm(true, 19.8, 20.0), 30);

  // 3. Calentando (target = 22, actual = 20 -> diff = 2.0°C)
  // Fórmula: 40 + 2.0 * 12 = 64%
  assert.equal(calculateFanPwm(true, 22.0, 20.0), 64);
  assert.equal(calculateFanPwm(true, true, false, 22.0, 20.0), 64);

  // 4. Enfriando (target = 18, actual = 21 -> diff = 3.0°C)
  // Fórmula: 40 + 3.0 * 12 = 76%
  assert.equal(calculateFanPwm(true, 18.0, 21.0), 76);
  assert.equal(calculateFanPwm(true, false, true, 18.0, 21.0), 76);

  // 5. Demanda mínima justo fuera de tolerancia (diff = 0.4°C)
  // 40 + 0.4 * 12 = 44.8 -> 45% (acotado min 35%)
  assert.equal(calculateFanPwm(true, 20.4, 20.0), 45);

  // 6. Demanda máxima saturada (diff = 6.0°C -> 40 + 72 = 112 -> clamp 100%)
  assert.equal(calculateFanPwm(true, 26.0, 20.0), 100);
});

test('calcProgressPercent - Puntos de calibración visual 15°-20°-30°', () => {
  assert.equal(calcProgressPercent(15), 0);
  assert.equal(calcProgressPercent(17.5), 25);
  assert.equal(calcProgressPercent(20), 50);
  assert.equal(calcProgressPercent(25), 75);
  assert.equal(calcProgressPercent(30), 100);
});

test('validateEsp32Telemetry - Validación y sanitización estricta de payloads', () => {
  // 1. Payload válido completo
  const validPayload = {
    type: 'state',
    targetTemperature: 21.5,
    actualTemperature: 20.8,
    power: true,
    light: false,
    fanSpeed: 52,
    systemStatus: 'calentando',
    ledMode: 'blink-green',
    ack: 'cmd_123',
  };

  const res1 = validateEsp32Telemetry(validPayload);
  assert.equal(res1.valid, true);
  assert.deepEqual(res1.sanitized, {
    targetTemperature: 21.5,
    actualTemperature: 20.8,
    power: true,
    light: false,
    fanSpeed: 52,
    systemStatus: 'calentando',
    ledMode: 'blink-green',
    ack: 'cmd_123',
  });

  // 2. Valores extremos o fuera de rango
  const outOfRange = {
    targetTemperature: 35.0, // Mayor que MAX_TEMP (30)
    actualTemperature: 99.0, // Mayor que 85°C
    fanSpeed: 150,           // Mayor que 100%
    systemStatus: 'invalido_status',
    ledMode: 'ultra_violeta',
  };

  const res2 = validateEsp32Telemetry(outOfRange);
  assert.equal(res2.valid, true);
  assert.equal(res2.sanitized.targetTemperature, MAX_TEMP); // Clampeado a 30
  assert.equal(res2.sanitized.actualTemperature, undefined); // Descartado por fuera de rango físico
  assert.equal(res2.sanitized.fanSpeed, 100);               // Clampeado a 100
  assert.equal(res2.sanitized.systemStatus, undefined);     // Filtrado por desconocido
  assert.equal(res2.sanitized.ledMode, undefined);          // Filtrado por desconocido

  // 3. Tipos inválidos o corruptos (NaN, cadenas donde van booleanos, etc)
  const corruptPayload = {
    actualTemperature: NaN,
    power: 'true', // string en vez de booleano
    fanSpeed: 'rapido',
  };

  const res3 = validateEsp32Telemetry(corruptPayload);
  assert.equal(res3.valid, false); // No hay campos válidos

  // 4. Payload no objeto o nulo
  assert.equal(validateEsp32Telemetry(null).valid, false);
  assert.equal(validateEsp32Telemetry('texto').valid, false);
});

test('getLedPresentation - 4 Estados visuales TERMA', () => {
  // Apagado: rojo fijo
  assert.deepEqual(getLedPresentation(LED_MODES.RED), { className: 'red', label: 'Rojo fijo' });

  // Calentando: verde intermitente
  assert.deepEqual(getLedPresentation(LED_MODES.BLINK_GREEN), { className: 'blink', label: 'Verde intermitente' });

  // Enfriando: celeste intermitente
  assert.deepEqual(getLedPresentation(LED_MODES.BLINK_CYAN), { className: 'blink cyan', label: 'Celeste intermitente' });

  // Estable: verde fijo
  assert.deepEqual(getLedPresentation(LED_MODES.GREEN), { className: 'green', label: 'Verde fijo' });
});
