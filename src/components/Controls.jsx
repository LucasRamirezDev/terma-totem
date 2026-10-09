import React from 'react';
import { ArrowUp, ArrowDown, Power, Lightbulb } from 'lucide-react';

export function Controls({
  enabled,
  light,
  onIncrease,
  onDecrease,
  onTogglePower,
  onToggleLight,
}) {
  return (
    <div className="controls">
      <button
        type="button"
        className="key blue"
        onClick={onIncrease}
        aria-label="Subir temperatura"
      >
        <ArrowUp />
        <span>SUBIR</span>
      </button>

      <button
        type="button"
        className="key blue"
        onClick={onDecrease}
        aria-label="Bajar temperatura"
      >
        <ArrowDown />
        <span>BAJAR</span>
      </button>

      <button
        type="button"
        className={`key power ${enabled ? 'on' : ''}`}
        onClick={onTogglePower}
        aria-label={enabled ? 'Apagar sistema' : 'Encender sistema'}
      >
        <Power />
        <span>{enabled ? 'APAGAR' : 'ENCENDER'}</span>
      </button>

      <button
        type="button"
        className={`key amber ${light ? 'on' : 'off'}`}
        onClick={onToggleLight}
        aria-label={light ? 'Apagar luz auxiliar' : 'Encender luz auxiliar'}
      >
        <Lightbulb />
        <span>LUZ TERMA</span>
      </button>
    </div>
  );
}
