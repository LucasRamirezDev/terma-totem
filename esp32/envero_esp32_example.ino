/*
  ==============================================================
  TERMA TOTEM - ESP32 Firmware Example (WebSocket Server)
  ==============================================================
  Este sketch implementa el servidor WebSocket para comunicarse
  con la interfaz web React (TERMA Totem).

  Librerías recomendadas:
  - ESPAsyncWebServer (https://github.com/me-no-dev/ESPAsyncWebServer)
  - AsyncTCP (https://github.com/me-no-dev/AsyncTCP)
  - ArduinoJson (v6 o v7)
*/

#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>

// Configuración WiFi
const char* ssid = "TU_WIFI_SSID";
const char* password = "TU_WIFI_PASSWORD";

// Servidor Web y WebSocket
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// Variables de estado del clima
float targetTemperature = 18.0;
float actualTemperature = 20.0;
bool powerEnabled = false;
bool lightEnabled = true;
int fanSpeed = 0;
String systemStatus = "apagado";
String ledMode = "red";

// Pines de actuadores (ejemplo)
const int PIN_HEATER = 18;
const int PIN_COOLER = 19;
const int PIN_FAN_PWM = 21;
const int PIN_GROW_LIGHT = 22;

void broadcastState() {
  StaticJsonDocument<256> doc;
  doc["targetTemperature"] = targetTemperature;
  doc["actualTemperature"] = actualTemperature;
  doc["power"] = powerEnabled;
  doc["light"] = lightEnabled;
  doc["fanSpeed"] = fanSpeed;
  doc["systemStatus"] = systemStatus;
  doc["ledMode"] = ledMode;

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

    if (strcmp(action, "setTarget") == 0) {
      targetTemperature = doc["target"];
      Serial.printf("[ESP32] Nueva temperatura objetivo: %.1f °C\n", targetTemperature);
    } 
    else if (strcmp(action, "setPower") == 0) {
      powerEnabled = doc["enabled"];
      Serial.printf("[ESP32] Estado de encendido: %s\n", powerEnabled ? "ON" : "OFF");
    } 
    else if (strcmp(action, "setLight") == 0) {
      lightEnabled = doc["light"];
      Serial.printf("[ESP32] Luz auxiliar: %s\n", lightEnabled ? "ON" : "OFF");
      digitalWrite(PIN_GROW_LIGHT, lightEnabled ? HIGH : LOW);
    }
    else if (strcmp(action, "getState") == 0) {
      // Envía estado inmediatamente
    }

    broadcastState();
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
  pinMode(PIN_FAN_PWM, OUTPUT);
  pinMode(PIN_GROW_LIGHT, OUTPUT);

  // Conectar WiFi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("");
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());

  // WebSocket
  ws.onEvent(onEvent);
  server.addHandler(&ws);

  // Iniciar servidor
  server.begin();
}

unsigned long lastSensorRead = 0;

void loop() {
  ws.cleanupClients();

  // Bucle de control cada 1 segundo
  if (millis() - lastSensorRead > 1000) {
    lastSensorRead = millis();

    // AQUÍ: Lee tu sensor real (BME280 / DHT22 / DS18B20)
    // actualTemperature = leerSensor();

    // Lógica de control térmico
    if (!powerEnabled) {
      systemStatus = "apagado";
      ledMode = "red";
      fanSpeed = 0;
      digitalWrite(PIN_HEATER, LOW);
      digitalWrite(PIN_COOLER, LOW);
    } else {
      float diff = targetTemperature - actualTemperature;

      if (diff > 0.3) {
        // Necesita calentar
        systemStatus = "calentando";
        ledMode = "blink-green";
        fanSpeed = constrain(map(diff * 10, 3, 50, 35, 100), 35, 100);
        digitalWrite(PIN_HEATER, HIGH);
        digitalWrite(PIN_COOLER, LOW);
      } else if (diff < -0.3) {
        // Necesita enfriar (temperatura actual mayor que consigna)
        systemStatus = "enfriando";
        ledMode = "blink-cyan";
        fanSpeed = constrain(map(abs(diff) * 10, 3, 50, 35, 100), 35, 100);
        digitalWrite(PIN_HEATER, LOW);
        digitalWrite(PIN_COOLER, HIGH);
      } else {
        // Dentro de tolerancia (estable)
        systemStatus = "estable";
        ledMode = "green";
        fanSpeed = 30;
        digitalWrite(PIN_HEATER, LOW);
        digitalWrite(PIN_COOLER, LOW);
      }
    }

    broadcastState();
  }
}
