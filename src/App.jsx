import React from 'react';
import { useClimateControl } from './hooks/useClimateControl';
import { Header } from './components/Header';
import { Screen } from './components/Screen';
import { Controls } from './components/Controls';
import { InfoBar } from './components/InfoBar';
import { SimulationBar } from './components/SimulationBar';
import './styles/style.css';

export function App() {
  const {
    target,
    actual,
    enabled,
    light,
    simulation,
    status,
    rpm,
    led,
    ledLabel,
    espState,
    increaseTemp,
    decreaseTemp,
    togglePower,
    toggleLight,
    setManualActual,
    setSimulationEnabled,
    setEspIp,
  } = useClimateControl();

  return (
    <main className="page">
      <Header />

      <section className="housing">
        <Screen
          target={target}
          actual={actual}
          status={status}
          led={led}
        />

        <Controls
          enabled={enabled}
          light={light}
          onIncrease={increaseTemp}
          onDecrease={decreaseTemp}
          onTogglePower={togglePower}
          onToggleLight={toggleLight}
        />
      </section>

      <InfoBar
        rpm={rpm}
        status={status}
        led={led}
        ledLabel={ledLabel}
        light={light}
      />

      <SimulationBar
        espState={espState}
        onSetEspIp={setEspIp}
      />
    </main>
  );
}

export default App;
