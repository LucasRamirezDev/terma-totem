import test from 'node:test';
import assert from 'node:assert/strict';
import { ESP32BleClient } from '../src/services/esp32BleClient.js';
import { BLE_CONFIG } from '../src/constants/climate.js';

test('ESP32BleClient - Wire framing, chunks <= 20 bytes, delimitador \\n y ACK', async (t) => {
  const writtenChunks = [];

  const mockDriver = {
    connect: async (client) => {
      client.deviceId = 'TEST-BLE-DEVICE';
      client.updateStatus('connected', 'Conectado para test');
    },
    disconnect: async () => {},
    writeChunk: async (chunk) => {
      // Registrar cada chunk enviado y verificar que nunca exceda 20 bytes
      assert.ok(chunk.length <= BLE_CONFIG.MAX_CHUNK_SIZE, `Chunk no debe exceder 20 bytes, mide ${chunk.length}`);
      writtenChunks.push(Array.from(chunk));
    },
  };

  const bleClient = new ESP32BleClient({ driver: mockDriver });

  t.after(() => {
    bleClient.disconnect();
  });

  // 1. Conexión
  await bleClient.connect();
  assert.equal(bleClient.isConnected(), true);

  // 2. Envío de comando setTarget
  const targetPromise = bleClient.sendTarget(23.5);
  await new Promise(r => setTimeout(r, 10)); // Esperar flush de la cola secuencial

  assert.ok(writtenChunks.length > 0, 'Debe haber escrito chunks');

  // Reconstruir los bytes enviados
  const totalBytes = [];
  for (const chunk of writtenChunks) {
    totalBytes.push(...chunk);
  }

  // Verificar que el último byte sea \n (0x0A)
  assert.equal(totalBytes[totalBytes.length - 1], 0x0A, 'El último byte debe ser delimitador newline 0x0A');

  // Decodificar el mensaje enviado
  const decoder = new TextDecoder();
  const sentString = decoder.decode(new Uint8Array(totalBytes.slice(0, -1)));
  const sentJson = JSON.parse(sentString);

  assert.equal(sentJson.action, 'setTarget');
  assert.equal(sentJson.target, 23.5);
  assert.ok(sentJson.id, 'Debe incluir id');
  const cmdId = sentJson.id;

  // 3. Simular recepción del mensaje inicial "TERMA ready\n" en chunks de 10 bytes
  let telemetryReceived = null;
  const unsubMsg = bleClient.onMessage((data) => {
    telemetryReceived = data;
  });

  const bannerBytes = new TextEncoder().encode('TERMA ready\n');
  bleClient.handleIncomingRawData(bannerBytes.slice(0, 6)); // "TERMA "
  bleClient.handleIncomingRawData(bannerBytes.slice(6));    // "ready\n"

  // El banner de inicio NO debe interpretarse como telemetría ni provocar error
  assert.equal(telemetryReceived, null);

  // 4. Simular recepción de ACK fragmentado en chunks de 8 bytes
  const ackPayload = JSON.stringify({
    type: 'ack',
    ack: cmdId,
    success: true,
    message: 'Estado actualizado',
  }) + '\n';
  const ackBytes = new TextEncoder().encode(ackPayload);

  // Enviar en trozos pequeños <= 20 bytes
  for (let i = 0; i < ackBytes.length; i += 8) {
    bleClient.handleIncomingRawData(ackBytes.slice(i, i + 8));
  }

  const ackResult = await targetPromise;
  assert.equal(ackResult.ack, cmdId);
  assert.equal(ackResult.success, true);
  assert.equal(bleClient.getPendingCount(), 0);

  // 5. Simular telemetría fragmentada en chunks
  const statePayload = JSON.stringify({
    type: 'state',
    targetTemperature: 23.5,
    actualTemperature: 21.0,
    power: true,
    light: false,
    fanSpeed: 45,
    systemStatus: 'calentando',
    ledMode: 'blink-green',
  }) + '\n';

  const stateBytes = new TextEncoder().encode(statePayload);
  for (let i = 0; i < stateBytes.length; i += 15) {
    bleClient.handleIncomingRawData(stateBytes.slice(i, i + 15));
  }

  assert.ok(telemetryReceived, 'Debe haber notificado telemetría');
  assert.equal(telemetryReceived.targetTemperature, 23.5);
  assert.equal(telemetryReceived.actualTemperature, 21.0);
  assert.equal(telemetryReceived.power, true);
  assert.equal(telemetryReceived.fanSpeed, 45);

  unsubMsg();
});
