/**
 * TERMA - Cliente de comunicación Bluetooth Low Energy (BLE) con ESP32-S3
 * 
 * Cumple estrictamente con la especificación TERMA_BLE_PROTOCOL.md:
 * - Advertised name: TERMA-CONTROL
 * - GATT Service: 8d7a0001-31d5-4db4-a9d7-0e3c4b1a7001
 * - RX (Android -> ESP32): 8d7a0002-31d5-4db4-a9d7-0e3c4b1a7001 (Write with response)
 * - TX (ESP32 -> Android): 8d7a0003-31d5-4db4-a9d7-0e3c4b1a7001 (Notify & Read)
 * 
 * Wire Framing:
 * - Objetos JSON codificados en UTF-8, terminados con delimitador '\n' (0x0A).
 * - Envíos divididos en chunks <= 20 bytes con write with response secuencial.
 * - Recepción mediante reensamblado continuo de chunks <= 20 bytes delimitados por '\n'.
 * - Descarte explícito del banner de bienvenida "TERMA ready\n".
 * - Correlación de ACK por ID de comando y validación estricta de telemetría.
 */

import { BLE_CONFIG, validateEsp32Telemetry } from '../constants/climate.js';
import { BleClient, numbersToDataView, ConnectionPriority } from '@capacitor-community/bluetooth-le';

export class ESP32BleClient {
  constructor(options = {}) {
    this.driver = options.driver || null; // Driver inyectable para pruebas o Web Bluetooth
    this.deviceId = null;
    this.device = null;
    this.connectionState = 'disconnected'; // 'connected' | 'connecting' | 'disconnected'
    this.isManualDisconnect = false;
    this.cmdCounter = 0;
    this.sessionId = null;

    // Búfer de recepción de bytes crudos para reensamblar mensajes UTF-8 delimitados por '\n'
    this.rxBuffer = [];

    // Cola secuencial de envíos para evitar intercalar trozos de distintos JSON
    this.writeQueue = Promise.resolve();

    // Tabla de comandos pendientes: Map<string, { id, action, payload, sessionId, timeoutTimer, resolve, reject, timestamp }>
    this.pendingCommands = new Map();

    this.listeners = new Set();
    this.statusListeners = new Set();

    this.textEncoder = new TextEncoder();
    this.textDecoder = new TextDecoder('utf-8');
  }

  isConnected() {
    return this.connectionState === 'connected';
  }

  getPendingCount() {
    return this.pendingCommands.size;
  }

  createCommandId() {
    this.cmdCounter = (this.cmdCounter + 1) % 100000;
    return `ble_${Date.now()}_${this.cmdCounter}`;
  }

  updateStatus(state, message) {
    this.connectionState = state;
    const isConnected = state === 'connected';
    this.statusListeners.forEach(listener => {
      try {
        listener({
          connected: isConnected,
          state,
          message,
          deviceId: this.deviceId || 'TERMA-CONTROL',
          protocol: 'bluetooth',
        });
      } catch (e) {
        console.error('[BLE] Error en statusListener:', e);
      }
    });
  }

  /**
   * Inicializa el escaneo, emparejamiento, descubrimiento GATT y suscripción de notificaciones
   */
  async connect() {
    this.isManualDisconnect = false;
    if (this.connectionState === 'connected' || this.connectionState === 'connecting') {
      return;
    }

    this.cleanupPendingCommands('Reiniciando conexión BLE');
    this.rxBuffer = [];
    this.sessionId = `ble_sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.updateStatus('connecting', 'Buscando dispositivo TERMA-CONTROL...');

    // 1. Uso de driver inyectado (mocks de testing o adaptadores custom)
    if (this.driver && typeof this.driver.connect === 'function') {
      try {
        await this.driver.connect(this);
        return;
      } catch (err) {
        this.updateStatus('disconnected', err.message || 'Error en driver BLE');
        return;
      }
    }

    // 2. Uso de Capacitor Bluetooth LE (Nativo Android)
    try {
      await BleClient.initialize({ androidNeverForLocation: true });

      // Verificar si Bluetooth está encendido en el teléfono
      try {
        const isEnabled = await BleClient.isEnabled();
        if (!isEnabled) {
          this.updateStatus('connecting', 'Solicitando activar Bluetooth...');
          await BleClient.requestEnable();
        }
      } catch (enableErr) {
        console.warn('[BLE] Error al verificar/solicitar Bluetooth:', enableErr);
      }

      this.updateStatus('connecting', 'Buscando TERMA-CONTROL...');

      // Búsqueda de dispositivo: no usar namePrefix porque en Android el plugin descarta
      // dispositivos no emparejados cuando device.name es null inicialmente.
      let device = null;
      try {
        device = await BleClient.requestDevice({
          services: [BLE_CONFIG.SERVICE_UUID],
          optionalServices: [BLE_CONFIG.SERVICE_UUID],
        });
      } catch (filterErr) {
        console.warn('[BLE] Búsqueda por servicio finalizó sin selección o timeout, probando escaneo general:', filterErr?.message);
        // Fallback: escaneo abierto si el UUID no estaba en el payload primario
        device = await BleClient.requestDevice({
          optionalServices: [BLE_CONFIG.SERVICE_UUID],
        });
      }

      if (!device || !device.deviceId) {
        throw new Error('No se seleccionó ningún dispositivo TERMA');
      }

      this.deviceId = device.deviceId;
      this.updateStatus('connecting', `Conectando a ${device.name || 'TERMA-CONTROL'}...`);

      await BleClient.connect(this.deviceId, (disconnectedId) => {
        console.warn(`[BLE] Dispositivo desconectado: ${disconnectedId}`);
        this.handleDisconnect('Enlace Bluetooth desconectado');
      });

      // Solicitar máxima velocidad (Connection Interval 7.5ms - 15ms) para respuesta táctil instantánea
      try {
        await BleClient.requestConnectionPriority(this.deviceId, ConnectionPriority.CONNECTION_PRIORITY_HIGH);
      } catch (prioErr) {
        console.warn('[BLE] No se pudo fijar CONNECTION_PRIORITY_HIGH:', prioErr);
      }

      this.updateStatus('connecting', 'Suscribiendo a notificaciones TX...');

      // Suscripción a notificaciones TX (8d7a0003-...)
      await BleClient.startNotifications(
        this.deviceId,
        BLE_CONFIG.SERVICE_UUID,
        BLE_CONFIG.TX_CHAR_UUID,
        (dataView) => {
          this.handleIncomingRawData(dataView);
        }
      );

      // REGLA TERMA_BLE_PROTOCOL.md:
      // "Android must not claim BLE connected until GATT discovery and TX notification subscription succeed."
      this.updateStatus('connected', `Conectado a ${device.name || 'TERMA-CONTROL'}`);

      // REGLA TERMA_BLE_PROTOCOL.md:
      // "When connected and subscribed, send getState to synchronize."
      this.sendGetState().catch(err => {
        console.warn('[BLE] Error en getState inicial:', err.message);
      });
      return;
    } catch (capErr) {
      console.error('[BLE] Error en conexión Capacitor Bluetooth LE:', capErr);
      const isCancelled = capErr?.message?.toLowerCase().includes('cancel') || capErr?.message?.toLowerCase().includes('no device');
      const errorMsg = isCancelled
        ? 'Búsqueda BLE cancelada'
        : (capErr?.message || 'Error de conexión Bluetooth');
      this.handleDisconnect(errorMsg);
      return;
    }

    // 3. Fallback a Web Bluetooth API (Navegadores Chrome / Edge con Web Bluetooth)
    if (typeof navigator !== 'undefined' && navigator.bluetooth) {
      try {
        this.updateStatus('connecting', 'Solicitando permiso Web Bluetooth...');
        const device = await navigator.bluetooth.requestDevice({
          filters: [{ namePrefix: BLE_CONFIG.DEVICE_NAME }],
          optionalServices: [BLE_CONFIG.SERVICE_UUID],
        });

        this.device = device;
        this.deviceId = device.id || device.name;

        device.addEventListener('gattserverdisconnected', () => {
          this.handleDisconnect('Dispositivo BLE desconectado del navegador');
        });

        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(BLE_CONFIG.SERVICE_UUID);
        this.rxChar = await service.getCharacteristic(BLE_CONFIG.RX_CHAR_UUID);
        this.txChar = await service.getCharacteristic(BLE_CONFIG.TX_CHAR_UUID);

        await this.txChar.startNotifications();
        this.txChar.addEventListener('characteristicvaluechanged', (event) => {
          this.handleIncomingRawData(event.target.value);
        });

        this.updateStatus('connected', 'Conectado por Web Bluetooth');
        this.sendGetState().catch(err => {
          console.warn('[BLE] Error en getState inicial:', err.message);
        });
        return;
      } catch (webErr) {
        console.warn('[BLE] Error en Web Bluetooth:', webErr.message);
        this.handleDisconnect(`Bluetooth no conectado: ${webErr.message}`);
        return;
      }
    }

    this.handleDisconnect('Bluetooth no soportado o permisos no concedidos');
  }

  handleDisconnect(reason = 'Desconectado') {
    this.connectionState = 'disconnected';
    this.cleanupPendingCommands(reason);
    this.rxBuffer = [];
    this.updateStatus('disconnected', reason);
  }

  async disconnect() {
    this.isManualDisconnect = true;
    this.cleanupPendingCommands('Desconectado manualmente');
    this.rxBuffer = [];

    if (this.driver && typeof this.driver.disconnect === 'function') {
      try {
        await this.driver.disconnect();
      } catch {
        // Ignorar
      }
    }

    if (this.deviceId) {
      try {
        await BleClient.disconnect(this.deviceId);
      } catch {
        // Ignorar
      }
      this.deviceId = null;
    }

    if (this.device && this.device.gatt && this.device.gatt.connected) {
      try {
        this.device.gatt.disconnect();
      } catch {
        // Ignorar
      }
      this.device = null;
    }

    this.updateStatus('disconnected', 'Desconectado manualmente');
  }

  cleanupPendingCommands(reason = 'Operación cancelada') {
    for (const [, pending] of this.pendingCommands.entries()) {
      clearTimeout(pending.timeoutTimer);
      try {
        pending.reject(new Error(reason));
      } catch {
        // Ignorar
      }
    }
    this.pendingCommands.clear();
  }

  /**
   * Wire framing:
   * "Android splits the UTF-8 byte sequence including newline into sequential chunks
   * of no more than 20 bytes and writes each to RX using write with response,
   * awaiting completion before sending the next."
   */
  async sendRawChunks(bytes) {
    if (!this.isConnected() && !this.driver) {
      throw new Error('Bluetooth no conectado');
    }

    const totalLen = bytes.length;
    let offset = 0;

    while (offset < totalLen) {
      const chunkLen = Math.min(BLE_CONFIG.MAX_CHUNK_SIZE, totalLen - offset);
      const chunk = bytes.slice(offset, offset + chunkLen);

      if (this.driver && typeof this.driver.writeChunk === 'function') {
        await this.driver.writeChunk(chunk);
      } else if (this.deviceId) {
        const dataView = numbersToDataView(Array.from(chunk));
        await BleClient.write(this.deviceId, BLE_CONFIG.SERVICE_UUID, BLE_CONFIG.RX_CHAR_UUID, dataView);
      } else if (this.rxChar) {
        if (typeof this.rxChar.writeValueWithResponse === 'function') {
          await this.rxChar.writeValueWithResponse(chunk);
        } else {
          await this.rxChar.writeValue(chunk);
        }
      } else {
        throw new Error('Canal RX no disponible para escritura BLE');
      }

      offset += chunkLen;
    }
  }

  /**
   * Envía un comando serializado a JSON con framing y cola secuencial
   */
  sendCommand(action, payload = {}, timeoutMs = 3000) {
    const id = this.createCommandId();
    const messageObj = { action, ...payload, id };
    const jsonStr = JSON.stringify(messageObj);

    // Wire framing: "UTF-8 JSON objects, terminated by one newline byte 0x0A (\n)"
    // "Maximum JSON payload before newline: 511 bytes."
    const encodedPayload = this.textEncoder.encode(jsonStr);
    if (encodedPayload.length > BLE_CONFIG.MAX_PAYLOAD_SIZE) {
      const err = new Error(`El payload del comando supera el límite máximo de ${BLE_CONFIG.MAX_PAYLOAD_SIZE} bytes`);
      return Promise.reject(err);
    }

    const fullBytes = new Uint8Array(encodedPayload.length + 1);
    fullBytes.set(encodedPayload, 0);
    fullBytes[encodedPayload.length] = 0x0A; // \n byte

    if (!this.isConnected() && !this.driver) {
      const err = new Error(`Bluetooth LE no está conectado para enviar ${action}`);
      const rejectedPromise = Promise.reject(err);
      rejectedPromise.commandId = id;
      rejectedPromise.id = id;
      rejectedPromise.sent = false;
      return rejectedPromise;
    }

    let resolvePromise;
    let rejectPromise;

    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    promise.commandId = id;
    promise.id = id;

    const timeoutTimer = setTimeout(() => {
      if (this.pendingCommands.has(id)) {
        this.pendingCommands.delete(id);
        rejectPromise(new Error(`Timeout de ${timeoutMs}ms esperando confirmación BLE de ${action} (id: ${id})`));
      }
    }, timeoutMs);

    this.pendingCommands.set(id, {
      id,
      action,
      payload,
      sessionId: this.sessionId,
      timestamp: Date.now(),
      timeoutTimer,
      resolve: resolvePromise,
      reject: rejectPromise,
    });

    // Encadenar en la cola secuencial para evitar intercalar trozos ("Do not interleave chunks from two JSON messages")
    this.writeQueue = this.writeQueue
      .then(() => this.sendRawChunks(fullBytes))
      .then(() => {
        promise.sent = true;
      })
      .catch(writeErr => {
        clearTimeout(timeoutTimer);
        this.pendingCommands.delete(id);
        rejectPromise(new Error(`Fallo de transmisión BLE en ${action}: ${writeErr.message}`));
      });

    return promise;
  }

  sendGetState(timeoutMs = 3000) {
    return this.sendCommand('getState', {}, timeoutMs);
  }

  sendTarget(target, timeoutMs = 3000) {
    const p = this.sendCommand('setTarget', { target }, timeoutMs);
    p.target = target;
    return p;
  }

  sendPower(enabled, timeoutMs = 3000) {
    const p = this.sendCommand('setPower', { enabled }, timeoutMs);
    p.enabled = enabled;
    return p;
  }

  sendLight(light, timeoutMs = 3000) {
    const p = this.sendCommand('setLight', { light }, timeoutMs);
    p.light = light;
    return p;
  }

  /**
   * Wire framing:
   * "Android subscribes to TX notifications, concatenates the raw notification bytes,
   * and parses one complete JSON object at each \n. Notification chunks are at most 20 bytes;
   * never parse one notification as a whole JSON object."
   */
  handleIncomingRawData(raw) {
    let bytes = [];
    if (raw instanceof DataView) {
      for (let i = 0; i < raw.byteLength; i++) {
        bytes.push(raw.getUint8(i));
      }
    } else if (raw instanceof Uint8Array || Array.isArray(raw)) {
      bytes = Array.from(raw);
    } else if (raw && raw.buffer instanceof ArrayBuffer) {
      const view = new Uint8Array(raw.buffer, raw.byteOffset || 0, raw.byteLength);
      bytes = Array.from(view);
    }

    for (const byte of bytes) {
      if (byte === 0x0A) {
        // Encontrado delimitador de fin de mensaje '\n'
        if (this.rxBuffer.length > 0) {
          const rawMessageBytes = new Uint8Array(this.rxBuffer);
          this.rxBuffer = [];
          this.processCompleteMessage(rawMessageBytes);
        }
      } else {
        this.rxBuffer.push(byte);
        // Protección contra desbordamiento de búfer corrupto (> 1024 bytes sin \n)
        if (this.rxBuffer.length > 1024) {
          console.warn('[BLE] Desbordamiento de búfer RX, descartando datos');
          this.rxBuffer = [];
        }
      }
    }
  }

  processCompleteMessage(messageBytes) {
    const text = this.textDecoder.decode(messageBytes).trim();
    if (!text) return;

    // REGLA TERMA_BLE_PROTOCOL.md:
    // "The initial READ value ('TERMA ready\n') is not a state message."
    if (text === 'TERMA ready') {
      console.log('[BLE] Recibido saludo de inicialización del ESP32-S3');
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.warn('[BLE] Error parseando JSON recibido por BLE:', e.message, text);
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;

    // 1. Correlación de ACK por id
    const ackId = typeof parsed.ack === 'string' ? parsed.ack.trim() : null;
    if (ackId && this.pendingCommands.has(ackId)) {
      const pending = this.pendingCommands.get(ackId);

      clearTimeout(pending.timeoutTimer);
      this.pendingCommands.delete(ackId);

      const isNegative = parsed.success === false || parsed.status === 'error';
      if (isNegative) {
        const errorMsg = parsed.error || parsed.message || `Comando ${pending.action} rechazado por microcontrolador`;
        pending.reject(new Error(errorMsg));
      } else {
        pending.resolve(parsed);
      }
    }

    // 2. Telemetría y estado: validar con validateEsp32Telemetry y notificar a los listeners
    const { valid, sanitized } = validateEsp32Telemetry(parsed);
    if (valid && sanitized) {
      this.notifyListeners(sanitized);
    }
  }

  onMessage(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  onStatusChange(callback) {
    this.statusListeners.add(callback);
    callback({
      connected: this.connectionState === 'connected',
      state: this.connectionState,
      message: this.connectionState === 'connected' ? 'Conectado por Bluetooth' : 'Bluetooth desconectado',
      deviceId: this.deviceId || 'TERMA-CONTROL',
      protocol: 'bluetooth',
    });
    return () => this.statusListeners.delete(callback);
  }

  notifyListeners(data) {
    this.listeners.forEach(cb => {
      try {
        cb(data);
      } catch (err) {
        console.error('[BLE] Error en listener de telemetría:', err);
      }
    });
  }
}

export const esp32Ble = new ESP32BleClient();
