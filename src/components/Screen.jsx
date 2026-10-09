import React, { useState, useEffect } from 'react';
import { QrCode, ArrowLeft } from 'lucide-react';
import { calcProgressPercent, SCALE_MARKS } from '../constants/climate';

export function Screen({ target, actual, status, led, isStale }) {
  const [showQr, setShowQr] = useState(false);
  const [countdown, setCountdown] = useState(10);

  const progressPercent = calcProgressPercent(target);

  const handleOpenQr = () => {
    setCountdown(10);
    setShowQr(true);
  };

  const handleCloseQr = () => {
    setShowQr(false);
  };

  useEffect(() => {
    if (!showQr) return;

    setCountdown(10);

    const timer = setTimeout(() => {
      setShowQr(false);
    }, 10000);

    const interval = setInterval(() => {
      setCountdown(c => (c > 1 ? c - 1 : 1));
    }, 1000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [showQr]);

  return (
    <div className="screen">
      {showQr ? (
        <div className="screen-qr">
          <div className="qr-head">
            <div className="qr-badge">
              <QrCode size={16} />
              <span>APLICACIÓN COMPLETA</span>
            </div>
            <span className="qr-timer">Volviendo en {countdown}s</span>
          </div>

          <div
            className="qr-box"
            onClick={handleCloseQr}
            title="Click para volver inmediatamente"
          >
            <img src="/qr.svg" alt="Código QR TERMA" className="qr-image" />
          </div>

          <div className="qr-info">
            <p>Escaneá con tu celular para abrir la app</p>
          </div>

          <div className="qr-footer">
            <div className="qr-countdown-bar">
              <div className="qr-countdown-fill" />
            </div>
            <button
              type="button"
              className="qr-dismiss-btn"
              onClick={handleCloseQr}
            >
              <ArrowLeft size={13} /> Volver a pantalla
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="screenhead">
            <div>
              <span className="screenlabel">CONTROL CLIMÁTICO</span>
              <h1>
                TEMPERATURA<br />DE CULTIVO
              </h1>
              <div className="accent" />
            </div>

            <button
              type="button"
              className="plant"
              onClick={handleOpenQr}
              title="Click para ver código QR de la aplicación"
              aria-label="Mostrar código QR de la aplicación"
            >
              <img src="/icono-qr.png" alt="Abrir QR" className="qr-trigger-icon" />
              <span>ENVERO</span>
            </button>
          </div>

          <div className="reading">
            <span className="value">{target.toFixed(1)}</span>
            <span className="degree">°C</span>
          </div>

          <div className="progress">
            <div className="fill" style={{ width: `${progressPercent}%` }} />
          </div>

          <div className="scale">
            {SCALE_MARKS.map(mark => (
              <span key={mark}>{mark}°</span>
            ))}
          </div>

          <div className="screenfooter">
            <div>
              <span className="tiny">
                {isStale ? 'TEMPERATURA (ÚLTIMA LECTURA)' : 'TEMPERATURA SIMULADA'}
              </span>
              <strong>{actual.toFixed(1)} °C</strong>
            </div>

            <div className={`state ${led}`}>
              <span className="statuslamp" />
              {status}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
