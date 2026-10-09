import React from 'react';
import { Wind, Activity, Lightbulb } from 'lucide-react';

export function InfoBar({ fanSpeed, rpm, status, led, ledLabel, light }) {
  // Porcentaje PWM de ciclo de trabajo ordenado a los ventiladores
  const pwmPercentage = typeof fanSpeed === 'number' ? fanSpeed : (typeof rpm === 'number' ? rpm : 0);

  return (
    <section className="info" aria-label="Métricas del sistema">
      <div className="infoitem" title="Ciclo de trabajo PWM de ventiladores (0 a 100%)">
        <Wind size={17} />
        <span>VENTILADORES</span>
        <strong>{pwmPercentage}%</strong>
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
