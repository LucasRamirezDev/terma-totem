import test from 'node:test';
import assert from 'node:assert/strict';

import { esp32 } from '../src/services/esp32Client.js';

// Simulador de WebSocket para pruebas unitarias deterministas
class MockWebSocket {
  static instances = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.sentMessages = [];
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    MockWebSocket.instances.push(this);
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen();
  }

  simulateMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: typeof data === 'string' ? data : JSON.stringify(data) });
    }
  }

  simulateClose(wasClean = true) {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({ wasClean });
  }

  simulateError() {
    if (this.onerror) this.onerror(new Error('Simulated socket error'));
  }

  send(data) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
}

test('ESP32Client - Manejo de socket, comandos y aislamiento', async (t) => {
  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = MockWebSocket;

  t.after(() => {
    globalThis.WebSocket = originalWebSocket;
    esp32.disconnect();
  });

  // 1. Enviar comandos mientras está desconectado debe fallar inmediatamente
  await assert.rejects(
    async () => {
      await esp32.sendTarget(22.0);
    },
    { message: /WebSocket no está conectado/ }
  );

  // 2. Conectar y simular apertura de enlace
  esp32.connect();
  const mockWs = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  assert.ok(mockWs, 'Debe haberse instanciado un WebSocket');
  assert.equal(mockWs.url, 'ws://192.168.4.1/ws');

  let statusReported = null;
  const unsubStatus = esp32.onStatusChange(s => {
    statusReported = s;
  });

  mockWs.simulateOpen();
  assert.equal(statusReported.connected, true);
  assert.equal(statusReported.state, 'connected');

  // Al abrir el socket debe solicitarse getState
  const firstMessage = JSON.parse(mockWs.sentMessages[0]);
  assert.equal(firstMessage.action, 'getState');
  assert.ok(firstMessage.id, 'Debe incluir un ID de comando');

  // 3. Envío de comando con correlación de ACK positivo
  const targetPromise = esp32.sendTarget(24.5);
  const targetSentMsg = JSON.parse(mockWs.sentMessages[mockWs.sentMessages.length - 1]);
  assert.equal(targetSentMsg.action, 'setTarget');
  assert.equal(targetSentMsg.target, 24.5);
  const cmdId = targetSentMsg.id;

  // Telemetría sin ACK NO debe resolver el comando pendiente
  mockWs.simulateMessage({
    type: 'state',
    targetTemperature: 24.5,
    actualTemperature: 20.2,
  });
  // El comando aún debe permanecer pendiente
  assert.equal(esp32.pendingCommands.has(cmdId), true);

  // Simular ACK explícito desde el ESP32
  mockWs.simulateMessage({
    type: 'ack',
    ack: cmdId,
    success: true,
    message: 'Consigna actualizada',
  });

  const resolvedData = await targetPromise;
  assert.equal(resolvedData.ack, cmdId);
  assert.equal(resolvedData.success, true);
  assert.equal(esp32.pendingCommands.has(cmdId), false);

  // 4. Confirmación negativa (rechazo de comando por el ESP32)
  const rejectedCmdPromise = esp32.sendTarget(35.0); // Valor fuera de rango
  const rejectedSentMsg = JSON.parse(mockWs.sentMessages[mockWs.sentMessages.length - 1]);
  const rejectedCmdId = rejectedSentMsg.id;

  mockWs.simulateMessage({
    type: 'ack',
    ack: rejectedCmdId,
    success: false,
    status: 'error',
    error: 'Temperatura objetivo fuera de rango [15.0, 30.0]',
  });

  await assert.rejects(
    async () => {
      await rejectedCmdPromise;
    },
    { message: /Temperatura objetivo fuera de rango/ }
  );

  // 5. Manejo fuera de orden de múltiples comandos concurrentes
  const cmdA = esp32.sendPower(true);
  const cmdAId = JSON.parse(mockWs.sentMessages[mockWs.sentMessages.length - 1]).id;

  const cmdB = esp32.sendLight(true);
  const cmdBId = JSON.parse(mockWs.sentMessages[mockWs.sentMessages.length - 1]).id;

  // Responder primero a B y luego a A
  mockWs.simulateMessage({ type: 'ack', ack: cmdBId, success: true });
  mockWs.simulateMessage({ type: 'ack', ack: cmdAId, success: true });

  const resB = await cmdB;
  const resA = await cmdA;
  assert.equal(resB.ack, cmdBId);
  assert.equal(resA.ack, cmdAId);

  // 6. Timeout configurable
  const timeoutPromise = esp32.sendCommand('testTimeout', {}, 50);
  await assert.rejects(
    async () => {
      await timeoutPromise;
    },
    { message: /Timeout de 50ms/ }
  );

  // 7. Protección frente a JSON corrupto
  let telemetryReceived = null;
  const unsubData = esp32.onMessage(data => {
    telemetryReceived = data;
  });

  mockWs.simulateMessage('{invalido json');

  mockWs.simulateMessage({
    actualTemperature: 21.0,
    systemStatus: 'calentando',
  });
  assert.equal(telemetryReceived.actualTemperature, 21.0);

  // 8. Desconexión y limpieza de comandos pendientes
  const pendingPromise = esp32.sendPower(false);
  assert.equal(esp32.getPendingCount() >= 1, true);

  mockWs.simulateClose(false);
  assert.equal(esp32.isConnected(), false);

  await assert.rejects(async () => {
    await pendingPromise;
  }, { message: /Conexión cerrada/ });

  assert.equal(esp32.getPendingCount(), 0);

  unsubStatus();
  unsubData();
});
