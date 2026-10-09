import React from 'react';

export function Header() {
  return (
    <header className="topline">
      <div className="topline-brand">
        <img src="/icono-terma.png" alt="Logo ENVERO" className="brand-icon" />
        <span className="eyebrow">ENVERO / INTERFAZ LOCAL</span>
      </div>
      <span className="mock">
        PROTOTIPO INTERACTIVO <span className="dot" />
      </span>
    </header>
  );
}
