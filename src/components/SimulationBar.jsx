import React, { useState } from 'react';

export function SimulationBar({ espState, onSetEspIp }) {
  const [showConfig, setShowConfig] = useState(false);
  const [ipInput, setIpInput] = useState(espState?.ip || '');

  const handleSaveIp = (e) => {
    e.preventDefault();
    onSetEspIp(ipInput);
    setShowConfig(false);
  };

  return (
    <footer className="bottom">
      <div className="bottom-left">
        <span>Interfaz local · preparada para integración ESP32-S3</span>
      </div>

      <div className="bottom-right">
        <button
          type="button"
          className={`esp-badge ${espState?.connected ? 'connected' : ''}`}
          onClick={() => setShowConfig(v => !v)}
          title="Click para configurar IP del ESP32"
        >
          <span className={`esp-dot ${espState?.connected ? 'online' : ''}`} />
          {espState?.connected
            ? `ESP32 Conectado (${espState.ip})`
            : espState?.ip
              ? `ESP32: ${espState.message || 'Desconectado'}`
              : 'Vincular ESP32-S3'}
        </button>

        {showConfig && (
          <form className="esp-modal" onSubmit={handleSaveIp}>
            <span>IP o Host del ESP32:</span>
            <input
              type="text"
              placeholder="Ej: 192.168.4.1 o envero.local"
              value={ipInput}
              onChange={e => setIpInput(e.target.value)}
            />
            <div className="esp-modal-actions">
              <button type="submit" className="save-btn">Conectar</button>
              <button type="button" onClick={() => setShowConfig(false)}>Cerrar</button>
            </div>
          </form>
        )}
      </div>
    </footer>
  );
}
