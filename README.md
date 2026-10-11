# TERMA · Tótem de Control Climático para Invernaderos

Interfaz de control climático táctil e interactiva desarrollada con **React 19**, **Vite** y **Capacitor 8**, empaquetada como aplicación **Android APK nativa** y lista para gobernar microcontroladores **ESP32 / ESP32-S3** mediante **WebSocket (Wi-Fi)** y **Bluetooth Low Energy (BLE)** en tiempo real, operando **100% offline sin necesidad de conexión a Internet**.

---

## 🏛️ Arquitectura y Separación de Responsabilidades

El sistema divide estrictamente el rol del frontend web/móvil y del microcontrolador para evitar que dos controladores calculen simultáneamente el mismo estado físico:

| Responsabilidad | Modo Simulación (Offline) | Modo Conectado (ESP32-S3) |
| :--- | :--- | :--- |
| **Fuente de Verdad** | React (`useClimateControl.js`) | **Firmware ESP32-S3** |
| **Evolución Térmica** | Motor físico simulado en React (550ms) | Microcontrolador (sensores físicos o simulación en firmware) |
| **Control PWM Ventiladores** | Calculado en React (0% a 100%) | **Generado por ESP32** (señal PWM 25 kHz común) |
| **Control LED RGB** | Calculado en React (`red`, `blink`, `cyan`, `green`) | **Generado por ESP32** en base a histéresis térmica |
| **Luz Auxiliar de Cultivo** | Estado local en React | Relevador físico comandado por ESP32 |
| **Pérdida de Enlace** | N/A | **Congela último estado confirmado** (no asume apagado) |

---

## 📱 Interfaz de Usuario: Sin Header y con Selector Integrado

Para optimizar al máximo el espacio vertical en pantallas de dispositivos móviles Android (tanto en orientación vertical como horizontal):

1. **Eliminación del Header Superior:**
   - Se removió el encabezado superior `<Header />` y el contenedor `.topline`.
   - El dashboard principal (`.housing`) se monta de forma inmediata aprovechando todo el alto disponible de la pantalla.
   - Se respetan con precisión las áreas seguras (`safe-area-inset-top`, `safe-area-inset-bottom`, `safe-area-inset-left`, `safe-area-inset-right`) para prevenir solapamientos con la barra de estado o notch del dispositivo móvil.
2. **Selector de Protocolo Wi-Fi / Bluetooth LE Integrado:**
   - Ubicado discretamente en el pie del dashboard (`SimulationBar.jsx`), manteniendo la coherencia estética industrial oscura.
   - **Izquierda:** Botones selectores **Wi-Fi** y **Bluetooth (BLE)**.
   - **Derecha:** Botón interactivo de estado de enlace y acceso al modal de configuración / modo simulación.

---

## 📁 Estructura del Proyecto

```text
TERMA-totem/
├── TERMA-debug.apk              # APK Android compilada e instalable en dispositivos
├── build-apk.ps1                # Script automatizado de compilación de APK con JDK 21 y Android SDK
├── capacitor.config.json        # Configuración de Capacitor 8 (cleartext, HTTP scheme, Splash Screen)
├── android/                     # Proyecto nativo Android generado y sincronizado por Capacitor
│   └── app/src/main/
│       ├── AndroidManifest.xml  # Permisos INTERNET, Wi-Fi, Bluetooth LE y rotación 'unspecified'
│       ├── java/.../MainActivity.java # Flags FLAG_KEEP_SCREEN_ON y bindProcessToNetwork Wi-Fi
│       └── res/                 # Splash screens adaptados con isotipo TERMA en todas las densidades
├── src/
│   ├── main.jsx                 # Bootstrap de React (createRoot)
│   ├── App.jsx                  # Montaje directo del dashboard sin header superior
│   ├── components/
│   │   ├── Screen.jsx           # Pantalla digital (lectura, marcas 15°-20°-30°, barra y vista QR)
│   │   ├── Controls.jsx         # Botonera táctil (SUBIR, BAJAR, POWER, LUZ)
│   │   ├── InfoBar.jsx          # Panel de métricas (% PWM ventiladores, estado, LED, luz)
│   │   └── SimulationBar.jsx    # Footer con selector de protocolo (Wi-Fi/BLE) y badge de enlace
│   ├── constants/
│   │   └── climate.js           # Constantes térmicas, fórmulas PWM, marcas de escala y UUIDs BLE
│   ├── hooks/
│   │   └── useClimateControl.js # Hook con despacho unificado a WebSocket y Bluetooth LE
│   ├── services/
│   │   ├── esp32Client.js       # Cliente WebSocket con timeouts, reconexión y correlación ACK
│   │   └── esp32BleClient.js    # Cliente BLE con wire-framing (chunks <= 20 bytes, delimitador \n)
│   └── styles/
│       └── style.css            # Estilos CSS responsive optimizados (portrait y landscape sin header)
└── tests/
    ├── climate.test.js          # Pruebas unitarias de física térmica, PWM y validación
    ├── esp32Client.test.js      # Pruebas unitarias del cliente WebSocket y aislamiento
    └── esp32BleClient.test.js   # Pruebas unitarias del cliente BLE (framing, chunks, \n y ACK)
```

---

## 📡 Protocolo 1: Wi-Fi WebSocket (`ws://192.168.4.1/ws`)

* **SSID del ESP32:** `TERMA-TOTEM`
* **IP por defecto:** `192.168.4.1`
* **Endpoint:** `ws://192.168.4.1/ws`
* **Tráfico Cleartext:** Habilitado mediante `network-security-config` y `androidScheme: "http"` en Capacitor para evitar restricciones de contenido mixto.
* **Red sin Internet:** `MainActivity.java` enlaza el socket al Wi-Fi con `ConnectivityManager.bindProcessToNetwork` para que Android no derive el tráfico hacia datos móviles al detectar que el ESP32 no tiene salida a Internet.
* **Concurrencia:** Admite **múltiples clientes simultáneos** conectados en paralelo a la red del ESP32. Todos los dispositivos reciben las actualizaciones de telemetría y pueden comandar el sistema en tiempo real.

---

## 🔵 Protocolo 2: Bluetooth Low Energy (BLE ESP32-S3 NimBLE 2.x)

### 1. Parámetros del Servicio GATT
* **Device advertised name:** `TERMA-CONTROL`
* **GATT Service UUID:** `8d7a0001-31d5-4db4-a9d7-0e3c4b1a7001`
* **RX Characteristic (Android → ESP32):** `8d7a0002-31d5-4db4-a9d7-0e3c4b1a7001` (WRITE con respuesta)
* **TX Characteristic (ESP32 → Android):** `8d7a0003-31d5-4db4-a9d7-0e3c4b1a7001` (NOTIFY y READ)

### 2. Wire Framing y Fragmentación
* **Formato:** Objetos JSON codificados en UTF-8 delimitados por un byte de nueva línea `0x0A` (`\n`).
* **Transmisión (Android → ESP32):**
  - Cada mensaje JSON se envía con el delimitador `\n`.
  - Se valida que la carga útil no supere los 511 bytes.
  - La secuencia de bytes se divide en fragmentos secuenciales de **no más de 20 bytes**.
  - Cada fragmento se envía mediante **write con respuesta**, esperando la finalización de cada uno antes de transmitir el siguiente.
  - Una cola secuencial interna (`writeQueue`) impide intercalar fragmentos de comandos simultáneos.
* **Recepción (ESP32 → Android):**
  - La aplicación se suscribe a notificaciones en la característica TX.
  - Los fragmentos recibidos (<= 20 bytes) se acumulan de forma continua en un búfer receptor de bytes crudos (`rxBuffer`).
  - Únicamente se extrae y parsea un objeto JSON completo al detectar el delimitador `0x0A` (`\n`).
  - Se descarta explícitamente el mensaje de bienvenida inicial `"TERMA ready\n"` emitido por el firmware antes de la primera sincronización.
  - Las notificaciones se despachan según su contenido: respuestas `ack` (correlacionadas con el `id` de la solicitud) o marcos de telemetría `state`.
* **Sincronización:** Inmediatamente tras descubrir el servicio GATT y suscribirse exitosamente a las notificaciones TX, la aplicación emite `getState` para sincronizar el estado completo.

### 3. Modelo de Conexión Exclusiva (Punto a Punto 1 a 1)
* A diferencia del canal Wi-Fi, la conexión Bluetooth Low Energy opera de forma **exclusiva 1 a 1**:
  - Al conectarse el primer teléfono móvil, el chip Bluetooth detiene automáticamente el anuncio (*Advertising*) para asegurar el canal y garantizar que los búferes de fragmentación no se mezclen.
  - Mientras un dispositivo esté enlazado, otros celulares no verán al ESP32 disponible.
  - Tan pronto como el celular activo se desconecta, el ESP32 reanuda el anuncio de inmediato (`startAdvertising()`) para permitir que otro usuario tome el control.

### 4. Optimizaciones de Latencia
* **Connection Priority HIGH:** La app solicita a Android un intervalo de conexión de alta velocidad (`7.5 ms a 15 ms`) mediante `BleClient.requestConnectionPriority(..., ConnectionPriority.CONNECTION_PRIORITY_HIGH)`.
* **Bombeo rápido de notificaciones:** En el firmware ESP32 se redujo el retardo entre fragmentos a **8 ms**, logrando que la telemetría completa viaje en menos de 75 ms.
* **Advertising sin desbordamiento:** Para no exceder el límite de 31 bytes del estándar BLE Legacy y evitar que Android lo muestre como *Unknown*, el nombre `TERMA-CONTROL` se transmite en el paquete primario y el Service UUID en el paquete de *Scan Response*.

---

## 🔄 Comandos Comunes (WebSocket y BLE)

Ambos canales de comunicación comparten la misma sintaxis JSON y el mismo esquema de correlación de respuestas:

### 1. Comandos hacia el ESP32
```json
{"action":"setPower","enabled":true,"id":"cmd_1712678900_1"}
{"action":"setTarget","target":23.5,"id":"cmd_1712678900_2"}
{"action":"setLight","light":false,"id":"cmd_1712678900_3"}
{"action":"getState","id":"cmd_1712678900_4"}
```

### 2. Respuestas y Acuses de Recibo (ACK)
```json
{"type":"ack","ack":"cmd_1712678900_2","success":true,"status":"ok","message":"Estado actualizado"}
```

### 3. Telemetría y Estado
```json
{"type":"state","targetTemperature":18.5,"actualTemperature":19.4,"power":true,"light":false,"fanSpeed":45,"systemStatus":"enfriando","ledMode":"blink-cyan"}
```

---

## 🌀 Ventiladores de 12V y PWM

* Tres ventiladores de 12V en paralelo comandados por señal PWM común a **25 kHz** generada por el periférico LEDC del ESP32.
* **Apagado:** `0%` PWM.
* **Estable:** `30%` PWM (recirculación de aire base dentro del invernadero).
* **Calentando / Enfriando:** Modulación dinámica entre `35%` y `100%`:  
  `fanSpeed = clamp(40 + abs(diff) * 12, 35, 100)`

---

## 💡 Iluminación LED RGB WS2812B

* Botón **LUZ** activa/desactiva la tira direccionable:
  * **Apagado:** Rojo fijo (`red`).
  * **Calentando:** Verde intermitente (`blink-green`).
  * **Estable:** Verde fijo (`green`).
  * **Enfriando:** Celeste intermitente (`blink-cyan`).
* Si la luz está apagada, la tira permanece apagada mientras los controles climáticos y ventiladores continúan operando con normalidad.

---

## 🛠️ Comandos de Compilación y Ejecución

```bash
# Ejecutar suite de pruebas unitarias (Node.js test runner)
npm test

# Compilar frontend web para producción
npm run build

# Sincronizar recursos web y plugins con el proyecto Android
npx cap sync

# Compilar la aplicación Android APK con Gradle
npm run build:apk
```

El script `build:apk` genera el archivo `TERMA-debug.apk` directamente en la raíz del proyecto para su instalación manual inmediata en cualquier teléfono o tablet Android.
