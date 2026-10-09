/**
 * TERMA - Cliente de comunicación WebSocket con ESP32-S3
 * 
 * Gestiona el ciclo de vida del enlace WebSocket, reconexiones controladas,
 * envío de comandos etiquetados y sincronización de estado.
 */

import { DEFAULT_ESP32_IP, DEFAULT_WS_PATH } from '../constants/climate';

class ESP32Client {
  constructor() {
    this.ws = null;
    this.reconnectTimer = null;
    this.connectionTimeoutTimer = null;
    this.listeners = new Set();
    this.statusListeners = new Set();
    this.isManualDisconnect = false;
    this.cmdCounter = 0;

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

    // Si estaba conectado o intentando conectar, reiniciar el enlace hacia la nueva IP
    this.isManualDisconnect = false;
    this.reconnect();
  }

  /**
   * Construye la URL WebSocket absoluta a partir de la IP/Host configurada.
   */
  getWebSocketUrl() {
    let host = this.targetIp || DEFAULT_ESP32_IP;
    if (host.startsWith('ws://') || host.startsWith('wss://')) {
      return host;
    }
    // Si incluye una ruta completa (ej. 192.168.4.1/ws)
    if (host.includes('/')) {
      return `ws://${host}`;
    }
    return `ws://${host}${DEFAULT_WS_PATH}`;
  }

  /**
   * Inicia la conexión WebSocket hacia el ESP32.
   */
  connect() {
    this.isManualDisconnect = false;

    // Evitar conexiones duplicadas si ya está abierta o en proceso de enlace
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.cleanupSocket();

    const wsUrl = this.getWebSocketUrl();
    this.updateStatus('connecting', `Conectando a ${this.targetIp}...`);

    try {
      this.ws = new WebSocket(wsUrl);

      // Timeout de enlace (cancela si no responde en 6 segundos)
      clearTimeout(this.connectionTimeoutTimer);
      this.connectionTimeoutTimer = setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
          console.warn('[ESP32] Timeout de conexión superado');
          this.cleanupSocket();
          this.updateStatus('disconnected', 'Tiempo de conexión agotado');
          this.scheduleReconnect();
        }
      }, 6000);

      this.ws.onopen = () => {
        clearTimeout(this.connectionTimeoutTimer);
        this.updateStatus('connected', 'Conectado');
        // Solicitar sincronización inicial del estado completo del ESP32
        this.sendGetState();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleIncomingMessage(data);
        } catch (e) {
          console.warn('[ESP32] Error parseando JSON entrante:', e);
        }
      };

      this.ws.onclose = (event) => {
        clearTimeout(this.connectionTimeoutTimer);
        const reason = event.wasClean ? 'Conexión cerrada' : 'Enlace perdido';
        this.updateStatus('disconnected', reason);
        if (!this.isManualDisconnect) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        clearTimeout(this.connectionTimeoutTimer);
        this.updateStatus('disconnected', 'Error de enlace');
      };
    } catch (err) {
      clearTimeout(this.connectionTimeoutTimer);
      this.updateStatus('disconnected', 'Fallo al inicializar WebSocket');
      if (!this.isManualDisconnect) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Cierra de forma explícita la conexión sin programar reconexión automática.
   */
  disconnect() {
    this.isManualDisconnect = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectionTimeoutTimer);
    this.cleanupSocket();
    this.updateStatus('disconnected', 'Desconectado manualmente');
  }

  /**
   * Reintenta la conexión limpiando temporizadores activos.
   */
  reconnect() {
    this.isManualDisconnect = false;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectionTimeoutTimer);
    this.cleanupSocket();
    this.connect();
  }

  /**
   * Limpia el socket actual y remueve sus listeners para evitar memory leaks o callbacks huérfanos.
   */
  cleanupSocket() {
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch {
        // Ignorar excepciones al cerrar
      }
      this.ws = null;
    }
  }

  scheduleReconnect() {
    if (this.isManualDisconnect) return;

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.isManualDisconnect) {
        this.connect();
      }
    }, 4000);
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
        console.error(e);
      }
    });
  }

  /**
   * Envía un mensaje JSON al ESP32 si el canal está abierto.
   */
  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
        return true;
      } catch (err) {
        console.error('[ESP32] Error al enviar comando:', err);
        return false;
      }
    }
    return false;
  }

  createCommandId() {
    this.cmdCounter = (this.cmdCounter + 1) % 100000;
    return `cmd_${Date.now()}_${this.cmdCounter}`;
  }

  // Comandos estándar del protocolo TERMA hacia el ESP32

  sendGetState() {
    const id = this.createCommandId();
    this.send({ action: 'getState', id });
    return id;
  }

  sendTarget(target) {
    const id = this.createCommandId();
    const sent = this.send({ action: 'setTarget', target, id });
    return { sent, id, target };
  }

  sendPower(enabled) {
    const id = this.createCommandId();
    const sent = this.send({ action: 'setPower', enabled, id });
    return { sent, id, enabled };
  }

  sendLight(light) {
    const id = this.createCommandId();
    const sent = this.send({ action: 'setLight', light, id });
    return { sent, id, light };
  }

  handleIncomingMessage(data) {
    if (!data || typeof data !== 'object') return;

    // Normalización de telemetría proveniente del ESP32
    this.notifyListeners(data);
  }

  // Suscripciones
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
