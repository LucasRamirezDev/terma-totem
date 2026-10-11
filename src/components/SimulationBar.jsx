import React, { useState } from 'react';
import { Wifi, Bluetooth } from 'lucide-react';
import { CONNECTION_MODE } from '../constants/climate';

export function SimulationBar({
  activeMode,
  isStale,
  espState,
  protocol = 'wifi',
  onSetProtocol,
  onSetMode,
  onReconnect,
  onSetEspIp,
}) {
  const [showConfig, setShowConfig] = useState(false);
  const [ipInput, setIpInput] = useState(espState?.ip || '192.168.4.1');

  const handleSaveIp = (e) => {
    e.preventDefault();
    onSetEspIp(ipInput);
    setShowConfig(false);
  };

  const handleSwitchToSim = () => {
    onSetMode('simulation');
    setShowConfig(false);
  };

  const handleSwitchToAuto = () => {
    onSetMode('auto');
    setShowConfig(false);
  };

  // Etiqueta y estilo del badge según el modo y protocolo
  const getBadgeContent = () => {
    if (protocol === 'bluetooth') {
      return {
        className: 'bluetooth',
        dotClass: 'ble',
        text: 'Bluetooth BLE · Enlace listo',
      };
    }

    switch (activeMode) {
      case CONNECTION_MODE.CONNECTED:
        return {
          className: 'connected',
          dotClass: 'online',
          text: `ESP32 Conectado (${espState.ip})`,
        };
      case CONNECTION_MODE.CONNECTING:
        return {
          className: 'connecting',
          dotClass: 'warning',
          text: espState.message || `Buscando ESP32 (${espState.ip})...`,
        };
      case CONNECTION_MODE.SIMULATION:
        return {
          className: 'simulation',
          dotClass: 'sim',
          text: 'Modo Simulación (Offline)',
        };
      case CONNECTION_MODE.DISCONNECTED:
      default:
        return {
          className: 'disconnected',
          dotClass: 'offline',
          text: isStale ? 'ESP32 Desconectado (Último estado)' : `Reintentando enlace (${espState.ip})...`,
        };
    }
  };

  const badge = getBadgeContent();

  return (
    <footer className="bottom">
      <div className="bottom-left">
        <div className="protocol-selector" role="group" aria-label="Selector de protocolo de conexión">
          <button
            type="button"
            className={`protocol-btn ${protocol === 'wifi' ? 'active' : ''}`}
            onClick={() => onSetProtocol && onSetProtocol('wifi')}
            title="Conexión por red local Wi-Fi / WebSocket"
          >
            <Wifi size={13} />
            <span>Wi-Fi</span>
          </button>
          <button
            type="button"
            className={`protocol-btn ${protocol === 'bluetooth' ? 'active' : ''}`}
            onClick={() => onSetProtocol && onSetProtocol('bluetooth')}
            title="Conexión inalámbrica Bluetooth Low Energy"
          >
            <Bluetooth size={13} />
            <span>Bluetooth</span>
          </button>
        </div>
      </div>

      <div className="bottom-right">
        <button
          type="button"
          className={`esp-badge ${badge.className}`}
          onClick={() => setShowConfig(v => !v)}
          title="Click para gestionar conexión o modo simulación"
        >
          <span className={`esp-dot ${badge.dotClass}`} />
          {badge.text}
        </button>

        {showConfig && (
          <div className="esp-modal">
            <div className="esp-modal-section">
              <span>Protocolo de enlace:</span>
              <div className="protocol-modal-grid">
                <button
                  type="button"
                  className={`mode-btn ${protocol === 'wifi' ? 'active' : ''}`}
                  onClick={() => onSetProtocol && onSetProtocol('wifi')}
                >
                  <Wifi size={12} /> Wi-Fi (WebSocket)
                </button>
                <button
                  type="button"
                  className={`mode-btn ${protocol === 'bluetooth' ? 'active' : ''}`}
                  onClick={() => onSetProtocol && onSetProtocol('bluetooth')}
                >
                  <Bluetooth size={12} /> Bluetooth (BLE)
                </button>
              </div>
            </div>

            <div className="esp-modal-divider" />

            {protocol === 'wifi' ? (
              <form onSubmit={handleSaveIp}>
                <span>Dirección IP del ESP32-S3:</span>
                <input
                  type="text"
                  placeholder="192.168.4.1"
                  value={ipInput}
                  onChange={e => setIpInput(e.target.value)}
                />
                <div className="esp-modal-actions">
                  <button type="submit" className="save-btn">Conectar</button>
                  <button type="button" onClick={() => setShowConfig(false)}>Cerrar</button>
                </div>
              </form>
            ) : (
              <div className="esp-modal-ble-info">
                <span>Estado de Bluetooth:</span>
                <div style={{ color: '#27b9eb', fontSize: '12px', fontWeight: 'bold', margin: '4px 0' }}>
                  Canal BLE preparado
                </div>
                <div style={{ fontSize: '11px', color: '#8ca6a5', lineHeight: '1.4' }}>
                  El selector Bluetooth/Wi-Fi está activado en modo BLE para vinculación directa sin red Wi-Fi.
                </div>
                <div className="esp-modal-actions" style={{ marginTop: '8px' }}>
                  <button type="button" onClick={() => setShowConfig(false)}>Cerrar</button>
                </div>
              </div>
            )}

            <div className="esp-modal-divider" />

            <div className="esp-modal-modes">
              <span>Modo de funcionamiento:</span>
              {activeMode === CONNECTION_MODE.SIMULATION ? (
                <button
                  type="button"
                  className="mode-btn auto"
                  onClick={handleSwitchToAuto}
                >
                  Conectar a hardware ESP32
                </button>
              ) : (
                <button
                  type="button"
                  className="mode-btn sim"
                  onClick={handleSwitchToSim}
                >
                  Activar Modo Simulación (Offline)
                </button>
              )}
            </div>

            {protocol === 'wifi' && (
              <>
                <div className="esp-modal-divider" />
                <div style={{ fontSize: '11px', color: '#8ca6a5', lineHeight: '1.4', marginTop: '6px' }}>
                  <strong style={{ color: '#2ce2b1' }}>Verificación Wi-Fi:</strong>
                  <div style={{ marginTop: '3px' }}>1. Conectá el celular a <strong>TERMA-TOTEM</strong>.</div>
                  <div>2. Si Android avisa "Sin internet", tocá <em>"Mantener conexión"</em>.</div>
                  <div>3. Si no conecta, desactivá temporalmente los Datos Móviles (4G/5G).</div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </footer>
  );
}
