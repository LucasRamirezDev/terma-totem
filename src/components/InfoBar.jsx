import React from 'react';
import { Wind, Activity, Lightbulb } from 'lucide-react';

export function InfoBar({ rpm, status, led, ledLabel, light }) {
  return (
    <section className="info" aria-label="Métricas del sistema">
      <div className="infoitem">
        <Wind size={17} />
        <span>VENTILADORES</span>
        <strong>{rpm}%</strong>
      </div>

      <div className="infoitem">
        <Activity size={17} />
        <span>ESTADO</span>
        <strong>{status}</strong>
      </div>

      <div className="infoitem">
        <span className={`indicator ${led}`} />
        <span>LED DE ESTADO</span>
        <strong>{ledLabel}</strong>
      </div>

      <div className="infoitem">
        <Lightbulb size={17} />
        <span>LUZ AUXILIAR</span>
        <strong>{light ? 'Encendida' : 'Apagada'}</strong>
      </div>
    </section>
  );
}
