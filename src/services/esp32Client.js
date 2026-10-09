/**
 * Cliente de comunicación con ESP32 (ESP-IDF / Arduino / ESPAsyncWebServer)
 * Soporta conexión WebSocket bidireccional y puente de eventos.
 */

class ESP32Client {
  constructor() {
    this.ws = null;
    this.reconnectTimer = null;
    this.listeners = new Set();
    this.statusListeners = new Set();
    this.isConnected = false;
    this.targetIp = this.getStoredIp();
  }

  getStoredIp() {
    try {
      return localStorage.getItem('TERMA_esp32_ip') || (
        window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
          ? window.location.host
          : ''
      );
    } catch {
      return '';
    }
  }

  setTargetIp(ip) {
    this.targetIp = ip.trim();
    try {
      if (this.targetIp) {
        localStorage.setItem('TERMA_esp32_ip', this.targetIp);
      } else {
        localStorage.removeItem('TERMA_esp32_ip');
      }
    } catch {
      // Ignorar restricciones de almacenamiento
    }
    this.reconnect();
  }

  connect() {
    if (!this.targetIp) {
      this.updateStatus(false, 'Sin IP configurada');
      return;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const wsUrl = this.targetIp.startsWith('ws://') || this.targetIp.startsWith('wss://')
      ? this.targetIp
      : `ws://${this.targetIp}/ws`;

    try {
      this.updateStatus(false, 'Conectando...');
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.updateStatus(true, 'Conectado');
        // Solicitar estado actual al ESP32
        this.send({ action: 'getState' });
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.notifyListeners(data);
        } catch (e) {
          console.warn('[ESP32] Error parseando mensaje recibido:', e);
        }
      };

      this.ws.onclose = () => {
        this.updateStatus(false, 'Desconectado');
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.updateStatus(false, 'Error de conexión');
      };
    } catch (err) {
      this.updateStatus(false, 'No se pudo iniciar WebSocket');
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.targetIp) {
        this.connect();
      }
    }, 4000);
  }

  reconnect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignorar
      }
    }
    clearTimeout(this.reconnectTimer);
    if (this.targetIp) {
      this.connect();
    } else {
      this.updateStatus(false, 'Modo local');
    }
  }

  updateStatus(connected, message) {
    this.isConnected = connected;
    this.statusListeners.forEach(listener => listener({ connected, message, ip: this.targetIp }));
  }

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  // Comandos hacia el ESP32
  sendTarget(target) {
    return this.send({ action: 'setTarget', target });
  }

  sendPower(enabled) {
    return this.send({ action: 'setPower', enabled });
  }

  sendLight(light) {
    return this.send({ action: 'setLight', light });
  }

  // Suscripción a datos del ESP32
  onMessage(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  onStatusChange(callback) {
    this.statusListeners.add(callback);
    callback({ connected: this.isConnected, ip: this.targetIp });
    return () => this.statusListeners.delete(callback);
  }

  notifyListeners(data) {
    this.listeners.forEach(cb => {
      try {
        cb(data);
      } catch (err) {
        console.error(err);
      }
    });
  }
}

export const esp32 = new ESP32Client();
