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
  // Instalar MockWebSocket en entorno global
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

  // 3. Envío de comando con correlación de ACK
  const targetPromise = esp32.sendTarget(24.5);
  assert.equal(esp32.getPendingCount(), 2); // getState + setTarget

  const targetSentMsg = JSON.parse(mockWs.sentMessages[1]);
  assert.equal(targetSentMsg.action, 'setTarget');
  assert.equal(targetSentMsg.target, 24.5);
  const cmdId = targetSentMsg.id;

  // Simular respuesta del ESP32 con ACK correspondiente
  mockWs.simulateMessage({
    type: 'state',
    targetTemperature: 24.5,
    actualTemperature: 20.2,
    power: true,
    light: true,
    fanSpeed: 88,
    systemStatus: 'calentando',
    ledMode: 'blink-green',
    ack: cmdId,
  });

  const resolvedData = await targetPromise;
  assert.equal(resolvedData.targetTemperature, 24.5);
  assert.equal(resolvedData.ack, cmdId);

  // 4. Protección frente a JSON corrupto
  let telemetryReceived = null;
  const unsubData = esp32.onMessage(data => {
    telemetryReceived = data;
  });

  // Enviar mensaje con sintaxis inválida: no debe lanzar excepción
  mockWs.simulateMessage('{invalido json');

  // Enviar mensaje con valores válidos
  mockWs.simulateMessage({
    actualTemperature: 21.0,
    systemStatus: 'calentando',
  });
  assert.equal(telemetryReceived.actualTemperature, 21.0);

  // 5. Desconexión y limpieza de comandos pendientes
  const pendingPromise = esp32.sendPower(false);
  assert.equal(esp32.getPendingCount() >= 1, true);

  // Simular pérdida de enlace
  mockWs.simulateClose(false);
  assert.equal(esp32.isConnected(), false);

  // El comando pendiente debe rechazarse por la desconexión
  await assert.rejects(async () => {
    await pendingPromise;
  }, { message: /Conexión cerrada/ });

  assert.equal(esp32.getPendingCount(), 0);

  unsubStatus();
  unsubData();
});
