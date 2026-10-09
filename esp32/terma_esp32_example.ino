/*
  ==============================================================
  TERMA - Firmware de Referencia para ESP32-S3 (Servidor WebSocket)
  ==============================================================
  Controlador principal del sistema físico de climatización:
  - Servidor WebSocket asíncrono en "/ws" (Puerto 80)
  - Punto de acceso WiFi propio "TERMA-TOTEM" (IP 192.168.4.1) o cliente de red local
  - Control PWM unificado a 25 kHz para 3 ventiladores de 12V (4 pines PWM)
  - Control de tira de 9 LED RGB WS2812B con animaciones no bloqueantes (millis)
  - Los 4 estados visuales: red (apagado), blink-green (calentando), blink-cyan (enfriando), green (estable)
  - El botón LUZ habilita/deshabilita la tira; cuando está apagada, los 9 LED permanecen en negro sin detener ventiladores ni simulación
  - Protocolo de confirmación explícita mediante 'ack' y telemetría JSON
  - Motor de simulación térmica autónoma en el ESP32 (mantiene control si React se desconecta)

  COMPATIBILIDAD DE NÚCLEO ARDUINO-ESP32:
  - Compatible con Arduino-ESP32 Core v2.0.x y Core v3.x mediante macros condicionales LEDC.

  LIBRERÍAS REQUERIDAS:
  - ESPAsyncWebServer (https://github.com/me-no-dev/ESPAsyncWebServer)
  - AsyncTCP (https://github.com/me-no-dev/AsyncTCP)
  - ArduinoJson (v6 o v7)
  - Adafruit_NeoPixel (v1.11.0 o superior)

  CONSIDERACIONES ELÉCTRICAS IMPORTANTES:
  - NO alimentar los ventiladores de 12V ni la tira WS2812B desde el regulador 3.3V del ESP32.
  - Los 3 ventiladores deben alimentarse de una fuente externa de 12V DC, compartiendo GND con el ESP32.
  - La tira WS2812B de 9 LED debe alimentarse de una fuente de 5V DC regulada, compartiendo GND con el ESP32.
  - La señal PWM del pin GPIO (3.3V) se conecta a la línea de control PWM de los 3 ventiladores en paralelo.
*/

#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <Adafruit_NeoPixel.h>

// ==============================================================
// CONFIGURACIÓN DE RED WIFI
// ==============================================================
// Si USE_ACCESS_POINT está en true, el ESP32 crea su propia red "TERMA-TOTEM" (IP 192.168.4.1)
// Si está en false, se conecta al router WiFi configurado en STA.
const bool USE_ACCESS_POINT = true;
const char* AP_SSID = "TERMA-TOTEM";
const char* AP_PASS = "TERMA1234";

const char* STA_SSID = "TU_WIFI_SSID";
const char* STA_PASS = "TU_WIFI_PASSWORD";

// Servidor Web y WebSocket
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// ==============================================================
// ASIGNACIÓN DE PINES (GPIO) EN ESP32-S3
// ==============================================================
// Control PWM común para los 3 ventiladores de 12V (4 pines)
const int PIN_FAN_PWM = 21;

// Pin de datos para la tira de 9 LED WS2812B
const int PIN_WS2812B = 48;
const int NUM_LEDS = 9;

// ==============================================================
// CONFIGURACIÓN PWM (25 kHz Estándar Intel 4-Wire Fans)
// ==============================================================
const int PWM_FREQ = 25000;
const int PWM_RESOLUTION = 8; // 0 a 255
const int PWM_CHANNEL = 0;    // Para núcleos v2.x

#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
  inline void initFanPwm() {
    ledcAttach(PIN_FAN_PWM, PWM_FREQ, PWM_RESOLUTION);
  }
  inline void writeFanPwm(int duty) {
    ledcWrite(PIN_FAN_PWM, duty);
  }
#else
  inline void initFanPwm() {
    ledcSetup(PWM_CHANNEL, PWM_FREQ, PWM_RESOLUTION);
    ledcAttachPin(PIN_FAN_PWM, PWM_CHANNEL);
  }
  inline void writeFanPwm(int duty) {
    ledcWrite(PWM_CHANNEL, duty);
  }
#endif

// ==============================================================
// TIRA DE 9 LED RGB WS2812B
// ==============================================================
Adafruit_NeoPixel strip(NUM_LEDS, PIN_WS2812B, NEO_GRB + NEO_KHZ800);

// ==============================================================
// VARIABLES DE ESTADO FÍSICO (Fuente de verdad del sistema)
// ==============================================================
float targetTemperature = 18.0;   // Consigna (°C) [15.0 a 30.0]
float actualTemperature = 20.0;   // Temperatura simulada en firmware (°C)
bool powerEnabled = false;        // Encendido general del sistema
bool lightEnabled = true;         // Habilitación de la tira WS2812B
int fanSpeed = 0;                 // Ciclo de trabajo PWM común (0 a 100%)
String systemStatus = "apagado";  // "apagado" | "calentando" | "enfriando" | "estable"
String ledMode = "red";           // "red" | "blink-green" | "blink-cyan" | "green"

// Control temporal de parpadeo de LED sin delay()
unsigned long lastLedBlinkTick = 0;
bool ledBlinkState = false;

// ==============================================================
// ACTUALIZACIÓN DE ACTUADORES FÍSICOS
// ==============================================================
void applyFanPwm() {
  int dutyCycle = map(fanSpeed, 0, 100, 0, 255);
  writeFanPwm(dutyCycle);
}

void updateLeds() {
  // Si el botón LUZ está desactivado, todos los LED permanecen apagados
  if (!lightEnabled) {
    strip.clear();
    strip.show();
    return;
  }

  // Alternancia de parpadeo cada 500 ms sin bloqueo
  if (millis() - lastLedBlinkTick >= 500) {
    lastLedBlinkTick = millis();
    ledBlinkState = !ledBlinkState;
  }

  uint32_t color = 0;

  if (ledMode == "red") {
    // Apagado: Rojo fijo
    color = strip.Color(255, 0, 0);
  } else if (ledMode == "blink-green") {
    // Calentando: Verde intermitente
    color = ledBlinkState ? strip.Color(0, 255, 60) : strip.Color(0, 0, 0);
  } else if (ledMode == "blink-cyan") {
    // Enfriando: Celeste intermitente
    color = ledBlinkState ? strip.Color(0, 220, 255) : strip.Color(0, 0, 0);
  } else if (ledMode == "green") {
    // Estable: Verde fijo
    color = strip.Color(0, 255, 60);
  } else {
    color = strip.Color(0, 255, 60);
  }

  for (int i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, color);
  }
  strip.show();
}

// ==============================================================
// TRANSMISIÓN DE TELEMETRÍA Y RESPUESTAS ACK
// ==============================================================
void sendAck(AsyncWebSocketClient* client, const char* ackId, bool success, const char* msg = nullptr) {
  if (ackId == nullptr || strlen(ackId) == 0) return;

  StaticJsonDocument<256> doc;
  doc["type"] = "ack";
  doc["ack"] = ackId;
  doc["success"] = success;
  doc["status"] = success ? "ok" : "error";
  if (msg != nullptr) {
    doc["message"] = msg;
  }

  String output;
  serializeJson(doc, output);
  if (client != nullptr) {
    client->text(output);
  } else {
    ws.textAll(output);
  }
}

void broadcastState(const char* ackId = nullptr) {
  StaticJsonDocument<384> doc;
  doc["type"] = "state";
  doc["targetTemperature"] = targetTemperature;
  doc["actualTemperature"] = actualTemperature;
  doc["power"] = powerEnabled;
  doc["light"] = lightEnabled;
  doc["fanSpeed"] = fanSpeed;
  doc["systemStatus"] = systemStatus;
  doc["ledMode"] = ledMode;

  if (ackId != nullptr && strlen(ackId) > 0) {
    doc["ack"] = ackId;
  }

  String output;
  serializeJson(doc, output);
  ws.textAll(output);
}

// ==============================================================
// PROCESAMIENTO DE COMANDOS WEBSOCKET DESDE REACT
// ==============================================================
void handleWebSocketMessage(AsyncWebSocketClient *client, void *arg, uint8_t *data, size_t len) {
  AwsFrameInfo *info = (AwsFrameInfo*)arg;
  if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
    StaticJsonDocument<256> doc;
    DeserializationError error = deserializeJson(doc, data, len);
    if (error) return;

    const char* action = doc["action"];
    const char* cmdId = doc["id"] | "";

    if (!action) return;

    if (strcmp(action, "setTarget") == 0) {
      if (doc.containsKey("target") && doc["target"].is<float>()) {
        float nextTarget = doc["target"];
        if (nextTarget >= 15.0 && nextTarget <= 30.0) {
          targetTemperature = round(nextTarget * 10.0) / 10.0;
          Serial.printf("[ESP32] setTarget -> %.1f °C (id: %s)\n", targetTemperature, cmdId);
          sendAck(client, cmdId, true, "Consigna actualizada");
          broadcastState(cmdId);
        } else {
          sendAck(client, cmdId, false, "Temperatura objetivo fuera de rango [15.0, 30.0]");
        }
      } else {
        sendAck(client, cmdId, false, "Campo 'target' invalido o ausente");
      }
    } 
    else if (strcmp(action, "setPower") == 0) {
      if (doc.containsKey("enabled") && doc["enabled"].is<bool>()) {
        powerEnabled = doc["enabled"];
        Serial.printf("[ESP32] setPower -> %s (id: %s)\n", powerEnabled ? "ON" : "OFF", cmdId);
        sendAck(client, cmdId, true, "Estado de alimentacion actualizado");
        broadcastState(cmdId);
      } else {
        sendAck(client, cmdId, false, "Campo 'enabled' invalido o ausente");
      }
    } 
    else if (strcmp(action, "setLight") == 0) {
      if (doc.containsKey("light") && doc["light"].is<bool>()) {
        lightEnabled = doc["light"];
        Serial.printf("[ESP32] setLight -> %s (id: %s)\n", lightEnabled ? "ON" : "OFF", cmdId);
        sendAck(client, cmdId, true, "Tira WS2812B conmutada");
        broadcastState(cmdId);
      } else {
        sendAck(client, cmdId, false, "Campo 'light' invalido o ausente");
      }
    }
    else if (strcmp(action, "getState") == 0) {
      Serial.printf("[ESP32] getState solicitado (id: %s)\n", cmdId);
      sendAck(client, cmdId, true, "Estado sincronizado");
      broadcastState(cmdId);
    }

    applyFanPwm();
    updateLeds();
  }
}

void onEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type,
             void *arg, uint8_t *data, size_t len) {
  switch (type) {
    case WS_EVT_CONNECT:
      Serial.printf("[ESP32] Cliente WebSocket #%u conectado desde %s\n", client->id(), client->remoteIP().toString().c_str());
      broadcastState();
      break;
    case WS_EVT_DISCONNECT:
      Serial.printf("[ESP32] Cliente WebSocket #%u desconectado\n", client->id());
      break;
    case WS_EVT_DATA:
      handleWebSocketMessage(client, arg, data, len);
      break;
    case WS_EVT_PONG:
    case WS_EVT_ERROR:
      break;
  }
}

void setup() {
  Serial.begin(115200);

  // Inicializar tira de 9 LED WS2812B
  strip.begin();
  strip.setBrightness(120); // Brillo moderado para evitar calentamiento
  strip.show();

  // Inicializar señal PWM para los 3 ventiladores a 25 kHz
  initFanPwm();
  applyFanPwm();
  updateLeds();

  // Inicializar red WiFi
  if (USE_ACCESS_POINT) {
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASS);
    Serial.println("");
    Serial.println("[ESP32] Red Access Point creada: " + String(AP_SSID));
    Serial.print("[ESP32] IP AP: ");
    Serial.println(WiFi.softAPIP()); // 192.168.4.1
  } else {
    WiFi.mode(WIFI_STA);
    WiFi.begin(STA_SSID, STA_PASS);
    while (WiFi.status() != WL_CONNECTED) {
      delay(400);
      Serial.print(".");
    }
    Serial.println("");
    Serial.print("[ESP32] Conectado a WiFi. IP: ");
    Serial.println(WiFi.localIP());
  }

  // Iniciar Servidor WebSocket
  ws.onEvent(onEvent);
  server.addHandler(&ws);
  server.begin();
  Serial.println("[ESP32] Servidor WebSocket activo en /ws");
}

unsigned long lastControlTick = 0;

void loop() {
  ws.cleanupClients();

  // Actualizar animación de los 9 LED continuamente sin bloqueos
  updateLeds();

  // Bucle de control térmico autónomo del ESP32 (cada 600 ms)
  // Mantiene el control aunque React esté desconectado
  if (millis() - lastControlTick > 600) {
    lastControlTick = millis();

    // 1. Simulación térmica física en el firmware
    float aim = powerEnabled ? targetTemperature : 20.0;
    float diff = aim - actualTemperature;
    if (abs(diff) >= 0.04) {
      float rate = powerEnabled ? 0.12 : 0.08;
      float delta = (diff > 0 ? 1.0 : -1.0) * min(abs(diff), rate);
      actualTemperature = round((actualTemperature + delta) * 10.0) / 10.0;
    } else {
      actualTemperature = aim;
    }

    // 2. Cálculo unificado de estados y velocidad común de ventiladores (PWM):
    // Fórmula idéntica a React:
    // - Apagado: 0%
    // - Estable (|diff| <= 0.3): 30% (recirculación base)
    // - Demanda (|diff| > 0.3): clamp(round(40 + |diff| * 12), 35, 100)
    if (!powerEnabled) {
      systemStatus = "apagado";
      ledMode = "red";
      fanSpeed = 0;
    } else {
      float tempDiff = abs(targetTemperature - actualTemperature);

      if (tempDiff > 0.3) {
        fanSpeed = constrain(round(40.0 + tempDiff * 12.0), 35, 100);
        if (actualTemperature < targetTemperature - 0.3) {
          systemStatus = "calentando";
          ledMode = "blink-green";
        } else {
          systemStatus = "enfriando";
          ledMode = "blink-cyan";
        }
      } else {
        systemStatus = "estable";
        ledMode = "green";
        fanSpeed = 30; // Velocidad base de recirculación
      }
    }

    applyFanPwm();
    broadcastState();
  }
}
