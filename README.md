# TERMA · Totem de Control Climático

Interfaz de control climático táctil e interactiva desarrollada con **React 19** y **Vite**, preparada para integrarse con microcontroladores **ESP32 / ESP32-S3**.

---

## 📁 Estructura del Proyecto

```text
TERMA-totem/
├── index.html                   # Punto de entrada HTML (monta /src/main.jsx)
├── package.json                 # Dependencias y scripts de Vite
├── esp32/
│   └── TERMA_esp32_example.ino # Sketch de ejemplo para ESP32 con AsyncWebSocket
├── src/
│   ├── main.jsx                 # Bootstrap de React (createRoot)
│   ├── App.jsx                  # Componente contenedor y coordinador
│   ├── components/
│   │   ├── Header.jsx           # Barra superior con branding y estado
│   │   ├── Screen.jsx           # Pantalla digital (lectura, barra y marcas)
│   │   ├── Controls.jsx         # Botonera física (SUBIR, BAJAR, POWER, LUZ)
│   │   ├── InfoBar.jsx          # Métricas (Ventiladores, Estado, LED, Luz)
│   │   └── SimulationBar.jsx    # Footer: simulación y enlace con ESP32
│   ├── constants/
│   │   └── climate.js           # Constantes (15°C a 30°C, cálculo de escala)
│   ├── hooks/
│   │   └── useClimateControl.js # Lógica térmica, simulación y sincronización
│   ├── services/
│   │   └── esp32Client.js       # Cliente WebSocket bidireccional para ESP32
│   └── styles/
│       └── style.css            # Estilos CSS responsive (desktop, landscape, portrait)
```

---

## ⚡ Comandos de Desarrollo

```bash
# Iniciar servidor de desarrollo local
npm run dev

# Compilar para producción (carpeta dist/)
npm run build

# Previsualizar la compilación de producción
npm run preview
```

---

## 🔌 Vinculación con ESP32 / ESP32-S3

La aplicación incluye un cliente WebSocket integrado ([esp32Client.js](file:///d:/ARCHIVOS%202026/TERMA-totem-react/TERMA-totem/src/services/esp32Client.js)):

1. **Detección automática**: Si los archivos estáticos de la app (`dist/`) se cargan directamente en la memoria flash del ESP32 (LittleFS / SPIFFS), la conexión WebSocket se establece automáticamente en `ws://<ESP32_HOST>/ws`.
2. **Conexión remota / Modo Dev**: Al pie de la pantalla se encuentra el botón **"Vincular ESP32-S3"**. Al hacer clic, puedes ingresar la IP del microcontrolador (ej. `192.168.4.1` o `192.168.1.50`).
3. **Modo simulación offline**: Si el ESP32 no está conectado, el simulador físico interno toma el control automáticamente para que la interfaz siga funcionando de forma fluida en el navegador.

### Protocolo WebSocket (JSON)

#### De la Web al ESP32 (Comandos)
* Cambiar consigna de temperatura:
  ```json
  { "action": "setTarget", "target": 18.5 }
  ```
* Encender/Apagar sistema:
  ```json
  { "action": "setPower", "enabled": true }
  ```
* Encender/Apagar luz auxiliar:
  ```json
  { "action": "setLight", "light": false }
  ```

#### Del ESP32 a la Web (Telemetría de Sensores y Actuadores)
```json
{
  "actualTemperature": 19.2,
  "targetTemperature": 18.0,
  "power": true,
  "light": true,
  "fanSpeed": 45,
  "systemStatus": "enfriando",
  "ledMode": "blink-cyan"
}
```
