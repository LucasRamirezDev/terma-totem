import React, { useState } from 'react';
import { CONNECTION_MODE } from '../constants/climate';

export function SimulationBar({
  activeMode,
  isStale,
  espState,
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

  // Etiqueta y estilo del badge según el modo
  const getBadgeContent = () => {
    switch (activeMode) {
      case CONNECTION_MODE.CONNECTED:
        return {
          className: 'connected',
          dotClass: 'online',
          text: `ESP32-S3 Conectado (${espState.ip})`,
        };
      case CONNECTION_MODE.CONNECTING:
        return {
          className: 'connecting',
          dotClass: 'warning',
          text: `Conectando a ${espState.ip}...`,
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
          text: isStale ? 'ESP32 Desconectado (Último estado)' : 'ESP32 Desconectado',
        };
    }
  };

  const badge = getBadgeContent();

  return (
    <footer className="bottom">
      <div className="bottom-left">
        <span>
          {activeMode === CONNECTION_MODE.SIMULATION
            ? 'Motor de simulación térmica local activo'
            : isStale
              ? 'Conexión perdida · Mostrando último estado confirmado'
              : 'Interfaz TERMA · Enlace con firmware ESP32-S3'}
        </span>
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
          </div>
        )}
      </div>
    </footer>
  );
}
