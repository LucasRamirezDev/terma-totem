/*
  ==============================================================
  TERMA - Firmware de Referencia para ESP32-S3 (Servidor WebSocket)
  ==============================================================
  Controlador principal del sistema físico de climatización:
  - Servidor WebSocket asíncrono en "/ws"
  - Punto de acceso WiFi propio (IP 192.168.4.1) o cliente de red local
  - Control PWM unificado a 25 kHz para 3 ventiladores de 12V
  - Control de calefactor y refrigeración/ventilación
  - Modos de LED RGB: red (apagado), blink-green (calentando), blink-cyan (enfriando), green (estable)
  - Control independiente de iluminación auxiliar
  - Motor térmico y de sensores en el propio microcontrolador

  Librerías requeridas:
  - ESPAsyncWebServer (https://github.com/me-no-dev/ESPAsyncWebServer)
  - AsyncTCP (https://github.com/me-no-dev/AsyncTCP)
  - ArduinoJson (v6 o v7)
*/

#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>

// Modo WiFi:
// Si USE_ACCESS_POINT está en true, el ESP32 crea su propia red "TERMA-AP" (IP 192.168.4.1)
// Si está en false, se conecta al router WiFi configurado.
const bool USE_ACCESS_POINT = true;
const char* AP_SSID = "TERMA-TOTEM";
const char* AP_PASS = "TERMA1234";

const char* STA_SSID = "TU_WIFI_SSID";
const char* STA_PASS = "TU_WIFI_PASSWORD";

// Servidor Web y WebSocket
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// ==============================================================
// VARIABLES DE ESTADO FÍSICO (Fuente de verdad del sistema)
// ==============================================================
float targetTemperature = 18.0;   // Consigna (°C)
float actualTemperature = 20.0;   // Temperatura de sensores (°C)
bool powerEnabled = false;        // Sistema encendido/apagado
bool lightEnabled = true;         // Luz auxiliar de cultivo (independiente de LED RGB)
int fanSpeed = 0;                 // Ciclo de trabajo PWM común para los 3 ventiladores (0 a 100%)
String systemStatus = "apagado";  // "apagado" | "calentando" | "enfriando" | "estable"
String ledMode = "red";           // "red" | "blink-green" | "blink-cyan" | "green"

// Pines de actuadores (ajustar según placa ESP32-S3)
const int PIN_HEATER = 18;        // Relé / MOSFET Calefactor
const int PIN_COOLER = 19;        // Relé / MOSFET Enfriador o extracción
const int PIN_FAN_PWM = 21;       // Señal PWM común para los 3 ventiladores de 12V
const int PIN_GROW_LIGHT = 22;    // Relé Iluminación auxiliar

// Configuración PWM de ventiladores (25 kHz estándar para ventiladores de 12V)
const int PWM_FREQ = 25000;
const int PWM_RESOLUTION = 8;     // 0 a 255
const int PWM_CHANNEL = 0;

void applyActuators() {
  // 1. Control de ventiladores (PWM común)
  int dutyCycle = map(fanSpeed, 0, 100, 0, 255);
  ledcWrite(PWM_CHANNEL, dutyCycle);

  // 2. Control térmico
  if (!powerEnabled) {
    digitalWrite(PIN_HEATER, LOW);
    digitalWrite(PIN_COOLER, LOW);
  } else if (systemStatus == "calentando") {
    digitalWrite(PIN_HEATER, HIGH);
    digitalWrite(PIN_COOLER, LOW);
  } else if (systemStatus == "enfriando") {
    digitalWrite(PIN_HEATER, LOW);
    digitalWrite(PIN_COOLER, HIGH);
  } else {
    digitalWrite(PIN_HEATER, LOW);
    digitalWrite(PIN_COOLER, LOW);
  }

  // 3. Luz auxiliar
  digitalWrite(PIN_GROW_LIGHT, lightEnabled ? HIGH : LOW);
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

void handleWebSocketMessage(void *arg, uint8_t *data, size_t len) {
  AwsFrameInfo *info = (AwsFrameInfo*)arg;
  if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
    StaticJsonDocument<256> doc;
    DeserializationError error = deserializeJson(doc, data, len);
    if (error) return;

    const char* action = doc["action"];
    const char* cmdId = doc["id"] | "";

    if (!action) return;

    if (strcmp(action, "setTarget") == 0) {
      if (doc.containsKey("target")) {
        targetTemperature = doc["target"];
        Serial.printf("[ESP32] setTarget -> %.1f °C (id: %s)\n", targetTemperature, cmdId);
      }
    } 
    else if (strcmp(action, "setPower") == 0) {
      if (doc.containsKey("enabled")) {
        powerEnabled = doc["enabled"];
        Serial.printf("[ESP32] setPower -> %s (id: %s)\n", powerEnabled ? "ON" : "OFF", cmdId);
      }
    } 
    else if (strcmp(action, "setLight") == 0) {
      if (doc.containsKey("light")) {
        lightEnabled = doc["light"];
        Serial.printf("[ESP32] setLight -> %s (id: %s)\n", lightEnabled ? "ON" : "OFF", cmdId);
      }
    }
    else if (strcmp(action, "getState") == 0) {
      Serial.printf("[ESP32] getState solicitado por cliente (id: %s)\n", cmdId);
    }

    applyActuators();
    broadcastState(cmdId);
  }
}

void onEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type,
             void *arg, uint8_t *data, size_t len) {
  switch (type) {
    case WS_EVT_CONNECT:
      Serial.printf("Cliente WebSocket #%u conectado desde %s\n", client->id(), client->remoteIP().toString().c_str());
      broadcastState();
      break;
    case WS_EVT_DISCONNECT:
      Serial.printf("Cliente WebSocket #%u desconectado\n", client->id());
      break;
    case WS_EVT_DATA:
      handleWebSocketMessage(arg, data, len);
      break;
    case WS_EVT_PONG:
    case WS_EVT_ERROR:
      break;
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(PIN_HEATER, OUTPUT);
  pinMode(PIN_COOLER, OUTPUT);
  pinMode(PIN_GROW_LIGHT, OUTPUT);

  // Configurar canal PWM de ventiladores
  ledcSetup(PWM_CHANNEL, PWM_FREQ, PWM_RESOLUTION);
  ledcAttachPin(PIN_FAN_PWM, PWM_CHANNEL);

  applyActuators();

  // Inicializar red
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

  // WebSocket Server
  ws.onEvent(onEvent);
  server.addHandler(&ws);
  server.begin();
  Serial.println("[ESP32] Servidor WebSocket activo en /ws");
}

unsigned long lastControlTick = 0;

void loop() {
  ws.cleanupClients();

  // Bucle de control y simulación térmica autónoma en el ESP32 (cada 600ms)
  if (millis() - lastControlTick > 600) {
    lastControlTick = millis();

    // 1. Lectura de sensores físicos (o evolución térmica simulada en hardware):
    // Si tienes sensor DHT22 / BME280 / DS18B20:
    // actualTemperature = bme.readTemperature();
    //
    // Si aún no tienes sensor físico conectado, el ESP32 ejecuta su propia simulación:
    float aim = powerEnabled ? targetTemperature : 20.0;
    float diff = aim - actualTemperature;
    if (abs(diff) >= 0.04) {
      float rate = powerEnabled ? 0.12 : 0.08;
      float delta = (diff > 0 ? 1.0 : -1.0) * min(abs(diff), rate);
      actualTemperature = round((actualTemperature + delta) * 10.0) / 10.0;
    } else {
      actualTemperature = aim;
    }

    // 2. Cálculo de estados térmicos y velocidad común de ventiladores (PWM):
    if (!powerEnabled) {
      systemStatus = "apagado";
      ledMode = "red";
      fanSpeed = 0;
    } else {
      float tempDiff = targetTemperature - actualTemperature;

      if (tempDiff > 0.3) {
        // Necesita calentar
        systemStatus = "calentando";
        ledMode = "blink-green";
        fanSpeed = constrain(map(tempDiff * 10, 3, 50, 35, 100), 35, 100);
      } else if (tempDiff < -0.3) {
        // Necesita enfriar / ventilar
        systemStatus = "enfriando";
        ledMode = "blink-cyan";
        fanSpeed = constrain(map(abs(tempDiff) * 10, 3, 50, 35, 100), 35, 100);
      } else {
        // Dentro de tolerancia (estable)
        systemStatus = "estable";
        ledMode = "green";
        fanSpeed = 30; // Velocidad de recirculación base
      }
    }

    applyActuators();
    broadcastState();
  }
}
