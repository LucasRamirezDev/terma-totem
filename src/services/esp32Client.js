/**
 * TERMA - Cliente de comunicación WebSocket con ESP32-S3
 * 
 * Gestiona el ciclo de vida del enlace WebSocket, reconexiones controladas,
 * aislamiento de sockets obsoletos, tabla de comandos en tránsito con timeouts,
 * correlación de solicitudes/respuestas y validación estricta de telemetría.
 */

import { DEFAULT_ESP32_IP, DEFAULT_WS_PATH, validateEsp32Telemetry } from '../constants/climate.js';

class ESP32Client {
  constructor() {
    this.ws = null;
    this.reconnectTimer = null;
    this.connectionTimeoutTimer = null;
    this.listeners = new Set();
    this.statusListeners = new Set();
    this.isManualDisconnect = false;
    this.cmdCounter = 0;

    // Tabla de comandos pendientes: Map<string, { id, action, payload, timeoutTimer, resolve, reject, timestamp }>
    this.pendingCommands = new Map();

    // Dirección IP / Host predeterminada: 192.168.4.1 (Access Point estándar de ESP32)
    this.targetIp = this.getStoredIp() || DEFAULT_ESP32_IP;
    this.connectionState = 'disconnected'; // 'connected' | 'connecting' | 'disconnected'
  }

  getStoredIp() {
    try {
      const stored = localStorage.getItem('TERMA_esp32_ip');
      if (stored && stored.trim().length > 0) {
        return stored.trim();
      }
    } catch {
      // Ignorar restricciones en entornos aislados
    }
    return '';
  }

  setTargetIp(ip) {
    const cleanIp = (ip || '').trim();
    this.targetIp = cleanIp || DEFAULT_ESP32_IP;

    try {
      if (cleanIp) {
        localStorage.setItem('TERMA_esp32_ip', cleanIp);
      } else {
        localStorage.removeItem('TERMA_esp32_ip');
      }
    } catch {
      // Ignorar errores de almacenamiento
    }

    // Reiniciar enlace hacia la nueva IP
    this.isManualDisconnect = false;
    this.reconnect();
  }

  getWebSocketUrl() {
    let host = this.targetIp || DEFAULT_ESP32_IP;
    if (host.startsWith('ws://') || host.startsWith('wss://')) {
      return host;
    }
    if (host.includes('/')) {
      return `ws://${host}`;
    }
    return `ws://${host}${DEFAULT_WS_PATH}`;
  }

  isConnected() {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
  }

  getPendingCount() {
    return this.pendingCommands.size;
  }

  connect() {
    this.isManualDisconnect = false;

    // Evitar conexiones duplicadas si ya está abierta o en proceso de enlace
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.clearTimers();
    this.cleanupSocket();

    const wsUrl = this.getWebSocketUrl();
    this.updateStatus('connecting', `Conectando a ${this.targetIp}...`);

    try {
      const currentWs = new WebSocket(wsUrl);
      this.ws = currentWs;

      // Timeout de enlace (cancela si no responde en 5 segundos)
      this.connectionTimeoutTimer = setTimeout(() => {
        if (this.ws === currentWs && currentWs.readyState === WebSocket.CONNECTING) {
          console.warn('[ESP32] Timeout de conexión superado');
          this.cleanupSocket();
          this.updateStatus('disconnected', 'Tiempo de conexión agotado');
          this.scheduleReconnect();
        }
      }, 5000);

      currentWs.onopen = () => {
        if (this.ws !== currentWs) return;
        clearTimeout(this.connectionTimeoutTimer);
        this.connectionTimeoutTimer = null;
        this.updateStatus('connected', 'Conectado');
        // Solicitar sincronización inicial del estado completo del ESP32
        this.sendGetState().catch(err => {
          console.warn('[ESP32] Error en getState inicial:', err.message);
        });
      };

      currentWs.onmessage = (event) => {
        if (this.ws !== currentWs) return;
        this.handleIncomingMessage(event.data);
      };

      currentWs.onerror = () => {
        if (this.ws !== currentWs) return;
        clearTimeout(this.connectionTimeoutTimer);
        this.connectionTimeoutTimer = null;
        this.cleanupPendingCommands('Error en conexión WebSocket');
        this.updateStatus('disconnected', 'Error de enlace');
      };

      currentWs.onclose = (event) => {
        if (this.ws !== currentWs) return;
        clearTimeout(this.connectionTimeoutTimer);
        this.connectionTimeoutTimer = null;
        this.cleanupPendingCommands('Conexión cerrada');
        const reason = event.wasClean ? 'Conexión cerrada' : 'Enlace perdido';
        this.updateStatus('disconnected', reason);
        if (!this.isManualDisconnect) {
          this.scheduleReconnect();
        }
      };
    } catch (err) {
      this.clearTimers();
      this.cleanupPendingCommands('Fallo al inicializar WebSocket');
      this.updateStatus('disconnected', 'Fallo al inicializar WebSocket');
      if (!this.isManualDisconnect) {
        this.scheduleReconnect();
      }
    }
  }

  disconnect() {
    this.isManualDisconnect = true;
    this.clearTimers();
    this.cleanupPendingCommands('Desconectado manualmente');
    this.cleanupSocket();
    this.updateStatus('disconnected', 'Desconectado manualmente');
  }

  reconnect() {
    this.isManualDisconnect = false;
    this.clearTimers();
    this.cleanupPendingCommands('Reiniciando conexión');
    this.cleanupSocket();
    this.connect();
  }

  clearTimers() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectionTimeoutTimer) {
      clearTimeout(this.connectionTimeoutTimer);
      this.connectionTimeoutTimer = null;
    }
  }

  cleanupSocket() {
    if (this.ws) {
      const socket = this.ws;
      this.ws = null;
      try {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close();
        }
      } catch {
        // Ignorar excepciones al cerrar
      }
    }
  }

  cleanupPendingCommands(reason = 'Operación cancelada') {
    for (const [, pending] of this.pendingCommands.entries()) {
      clearTimeout(pending.timeoutTimer);
      try {
        pending.reject(new Error(reason));
      } catch {
        // Ignorar errores de rechazo
      }
    }
    this.pendingCommands.clear();
  }

  scheduleReconnect() {
    if (this.isManualDisconnect) return;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isManualDisconnect) {
        this.connect();
      }
    }, 3500);
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
          ip: this.targetIp,
        });
      } catch (e) {
        console.error('[ESP32] Error en statusListener:', e);
      }
    });
  }

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
        return true;
      } catch (err) {
        console.error('[ESP32] Error al enviar mensaje:', err);
        return false;
      }
    }
    return false;
  }

  createCommandId() {
    this.cmdCounter = (this.cmdCounter + 1) % 100000;
    return `cmd_${Date.now()}_${this.cmdCounter}`;
  }

  sendCommand(action, payload = {}) {
    const id = this.createCommandId();
    const message = { action, ...payload, id };

    if (!this.isConnected()) {
      const err = new Error(`WebSocket no está conectado para enviar ${action}`);
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
        rejectPromise(new Error(`Timeout de 3s esperando confirmación de ${action} (id: ${id})`));
      }
    }, 3000);

    this.pendingCommands.set(id, {
      id,
      action,
      payload,
      timestamp: Date.now(),
      timeoutTimer,
      resolve: resolvePromise,
      reject: rejectPromise,
    });

    const sent = this.send(message);
    promise.sent = sent;

    if (!sent) {
      clearTimeout(timeoutTimer);
      this.pendingCommands.delete(id);
      rejectPromise(new Error(`Fallo de socket al transmitir ${action}`));
    }

    return promise;
  }

  sendGetState() {
    return this.sendCommand('getState');
  }

  sendTarget(target) {
    const p = this.sendCommand('setTarget', { target });
    p.target = target;
    return p;
  }

  sendPower(enabled) {
    const p = this.sendCommand('setPower', { enabled });
    p.enabled = enabled;
    return p;
  }

  sendLight(light) {
    const p = this.sendCommand('setLight', { light });
    p.light = light;
    return p;
  }

  handleIncomingMessage(rawData) {
    let parsed;
    try {
      parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    } catch (e) {
      console.warn('[ESP32] Error parseando JSON entrante:', e);
      return;
    }

    const { valid, sanitized } = validateEsp32Telemetry(parsed);
    if (!valid || !sanitized) return;

    // 1. Correlación de comandos pendientes mediante ack explícito
    if (sanitized.ack && this.pendingCommands.has(sanitized.ack)) {
      const pending = this.pendingCommands.get(sanitized.ack);
      clearTimeout(pending.timeoutTimer);
      this.pendingCommands.delete(sanitized.ack);
      pending.resolve(sanitized);
    } else {
      // Correlación de respaldo por valor si el firmware no envía ack explícito
      for (const [id, pending] of this.pendingCommands.entries()) {
        let matches = false;
        if (pending.action === 'setTarget' && sanitized.targetTemperature === pending.payload.target) {
          matches = true;
        } else if (pending.action === 'setPower' && sanitized.power === pending.payload.enabled) {
          matches = true;
        } else if (pending.action === 'setLight' && sanitized.light === pending.payload.light) {
          matches = true;
        } else if (pending.action === 'getState') {
          matches = true;
        }

        if (matches) {
          clearTimeout(pending.timeoutTimer);
          this.pendingCommands.delete(id);
          pending.resolve(sanitized);
          break;
        }
      }
    }

    // 2. Notificación a los componentes con telemetría sanitizada
    this.notifyListeners(sanitized);
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
      message: this.connectionState === 'connected' ? 'Conectado' : 'Desconectado',
      ip: this.targetIp,
    });
    return () => this.statusListeners.delete(callback);
  }

  notifyListeners(data) {
    this.listeners.forEach(cb => {
      try {
        cb(data);
      } catch (err) {
        console.error('[ESP32] Error en listener de telemetría:', err);
      }
    });
  }
}

export const esp32 = new ESP32Client();
