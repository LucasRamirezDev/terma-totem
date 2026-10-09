# ENVERO · Tótem de Control Climático para Invernaderos

Interfaz de control climático táctil e interactiva desarrollada con **React 19** y **Vite**, preparada para gobernar microcontroladores **ESP32 / ESP32-S3** mediante **WebSocket** en tiempo real.

---

## 🏛️ Arquitectura y Separación de Responsabilidades

El sistema divide estrictamente el rol del frontend web y del microcontrolador para evitar que dos controladores calculen simultáneamente el mismo estado físico:

| Responsabilidad | Modo Simulación (Offline) | Modo Conectado (ESP32-S3) |
| :--- | :--- | :--- |
| **Fuente de Verdad** | React (`useClimateControl.js`) | **Firmware ESP32-S3** |
| **Evolución Térmica** | Motor físico simulado en React (550ms) | Microcontrolador (sensores físicos o simulación en firmware) |
| **Control PWM Ventiladores** | Calculado en React (0% a 100%) | **Generado por ESP32** (señal PWM 25 kHz común) |
| **Control LED RGB** | Calculado en React (`red`, `blink`, `cyan`, `green`) | **Generado por ESP32** en base a histéresis térmica |
| **Luz Auxiliar de Cultivo** | Estado local en React | Relevador físico comandado por ESP32 |
| **Pérdida de Enlace** | N/A | **Congela último estado confirmado** (no asume apagado) |

---

## 📁 Estructura del Código

```text
envero-totem/
├── index.html                   # Punto de entrada HTML (monta /src/main.jsx)
├── README.md                    # Documentación arquitectónica y de protocolo
├── esp32/
│   └── envero_esp32_example.ino # Firmware de referencia para ESP32-S3 con AsyncWebSocket
├── src/
│   ├── main.jsx                 # Bootstrap de React (createRoot)
│   ├── App.jsx                  # Coordinador de componentes visuales y estados
│   ├── components/
│   │   ├── Header.jsx           # Barra superior con branding y estado
│   │   ├── Screen.jsx           # Pantalla digital (lectura, marcas 15°-20°-30°, barra y vista QR)
│   │   ├── Controls.jsx         # Botonera física táctil (SUBIR, BAJAR, POWER, LUZ)
│   │   ├── InfoBar.jsx          # Panel de métricas (% PWM ventiladores, estado, LED, luz)
│   │   └── SimulationBar.jsx    # Footer con selector de modo (Simulación / Hardware) y badge de enlace
│   ├── constants/
│   │   └── climate.js           # Constantes térmicas, fórmulas PWM, marcas de escala y modos
│   ├── hooks/
│   │   └── useClimateControl.js # Hook principal con separación de simulación y estado de hardware
│   ├── services/
│   │   └── esp32Client.js       # Cliente WebSocket con timeouts, reconexión y etiquetado de comandos
│   └── styles/
│       └── style.css            # Estilos CSS responsive (desktop, landscape móvil y portrait)
```

---

## 🔌 Protocolo WebSocket Bidireccional (`/ws`)

### 1. Dirección y Configuración
* **Dirección predeterminada:** `ws://192.168.4.1/ws` (Access Point por defecto de ESP32).
* **Configuración personalizada:** Editable directamente desde la interfaz y persistida en `localStorage`.
* **Preparación para Capacitor:** No deriva la IP de `window.location.host` para evitar enlaces erróneos a `localhost` dentro de un WebView de Android.

### 2. Comandos desde React hacia el ESP32

Todos los comandos incluyen un identificador correlativo (`id`) para rastrear respuestas y acuses de recibo:

#### A. Sincronización Inicial de Estado
Enviado automáticamente por React al abrir el canal WebSocket:
```json
{
  "action": "getState",
  "id": "cmd_1712678900_1"
}
```

#### B. Ajuste de Temperatura Objetivo (Consigna)
```json
{
  "action": "setTarget",
  "target": 18.5,
  "id": "cmd_1712678900_2"
}
```

#### C. Encendido / Apagado General
```json
{
  "action": "setPower",
  "enabled": true,
  "id": "cmd_1712678900_3"
}
```

#### D. Encendido / Apagado de Luz Auxiliar
```json
{
  "action": "setLight",
  "light": false,
  "id": "cmd_1712678900_4"
}
```

---

### 3. Telemetría y Acuse desde el ESP32 hacia React

El ESP32 emite el estado completo de manera periódica (cada 600 ms) y de forma inmediata ante cualquier comando:

```json
{
  "type": "state",
  "targetTemperature": 18.5,
  "actualTemperature": 19.4,
  "power": true,
  "light": false,
  "fanSpeed": 45,
  "systemStatus": "enfriando",
  "ledMode": "blink-cyan",
  "ack": "cmd_1712678900_2"
}
```

* **`actualTemperature`**: Lectura del sensor físico o simulación en firmware (°C).
* **`targetTemperature`**: Temperatura consigna (°C).
* **`power`**: `true` (encendido) | `false` (apagado).
* **`light`**: `true` (encendida) | `false` (apagada).
* **`fanSpeed`**: Ciclo de trabajo PWM común (0 a 100%) ordenado a los 3 ventiladores.
* **`systemStatus`**: `"apagado"` | `"calentando"` | `"enfriando"` | `"estable"`.
* **`ledMode`**: `"red"` (rojo fijo) | `"blink-green"` (verde intermitente) | `"blink-cyan"` (celeste intermitente) | `"green"` (verde fijo).
* **`ack`**: Identificador del comando recibido que motivó la actualización (opcional).

---

## 🌀 Ventiladores de 12V (Control Común)

El sistema opera con **tres ventiladores de 12V en paralelo** comandados por una señal PWM común a **25 kHz** generada por el periférico LEDC del ESP32:
* **Apagado:** `0%` PWM.
* **Estable:** `30%` PWM (recirculación de aire base dentro del invernadero).
* **Calentando / Enfriando:** Modulación dinámica entre `35%` y `100%` en función de la brecha térmica:  
  `fanSpeed = clamp(40 + abs(diff) * 12, 35, 100)`
* En la interfaz se muestra el porcentaje de potencia PWM (`VENTILADORES: XX%`), dejando abierta la futura incorporación de lectura tacométrica para RPM reales.

---

## 🛠️ Comandos de Desarrollo

```bash
# Servidor de desarrollo con Hot Reload
npm run dev

# Compilar para producción (carpeta dist/)
npm run build

# Previsualizar build de producción
npm run preview
```
