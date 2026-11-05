/**
 * ==============================================================================
 * NetworkManager.cpp - Wi-Fi Reconnection & Device-Authenticated HTTP Client
 * ==============================================================================
 */

#include "NetworkManager.h"
#include <ArduinoJson.h>

NetworkManager::NetworkManager()
  : lastPollTime(0),
    lastHeartbeatTime(0),
    lastReconnectAttempt(0),
    wasConnected(false),
    lastCommandId(""),
    consecutiveFailures(0) {}

void NetworkManager::begin() {
  pinMode(PIN_STATUS_LED, OUTPUT);
  digitalWrite(PIN_STATUS_LED, LOW);

  Serial.println("\n[Network] Initializing Wi-Fi Station Mode...");
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.printf("[Network] Connecting to SSID: '%s'", WIFI_SSID);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - startAttempt < WIFI_CONNECT_TIMEOUT_MS)) {
    delay(400);
    digitalWrite(PIN_STATUS_LED, !digitalRead(PIN_STATUS_LED)); // Blink while connecting
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    wasConnected = true;
    consecutiveFailures = 0;
    digitalWrite(PIN_STATUS_LED, HIGH); // Solid ON when connected
    Serial.println("\n[Network] >>> Wi-Fi Connected Successfully! <<<");
    Serial.printf("[Network] Assigned LAN IP: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("[Network] Gateway        : %s\n", WiFi.gatewayIP().toString().c_str());
    Serial.printf("[Network] RSSI Signal    : %d dBm\n", WiFi.RSSI());
  } else {
    wasConnected = false;
    digitalWrite(PIN_STATUS_LED, LOW);
    Serial.println("\n[Network] Connection failed or timed out. Non-blocking reconnect loop active.");
  }
}

bool NetworkManager::isConnected() {
  return (WiFi.status() == WL_CONNECTED);
}

void NetworkManager::maintainConnection() {
  bool currentlyConnected = isConnected();

  if (currentlyConnected) {
    if (!wasConnected) {
      wasConnected = true;
      consecutiveFailures = 0;
      digitalWrite(PIN_STATUS_LED, HIGH);
      Serial.println("\n[Network] Reconnected to Wi-Fi network.");
      Serial.printf("[Network] Reconnected LAN IP: %s\n", WiFi.localIP().toString().c_str());
    }
    return;
  }

  wasConnected = false;
  digitalWrite(PIN_STATUS_LED, LOW);

  unsigned long now = millis();
  if (now - lastReconnectAttempt > 5000) {
    lastReconnectAttempt = now;
    Serial.println("[Network] Wi-Fi lost. Attempting auto-reconnect...");
    WiFi.disconnect();
    WiFi.reconnect();
  }
}

bool NetworkManager::pollNextCommand(ServoController& servos) {
  if (!isConnected()) return false;

  unsigned long currentMillis = millis();
  if (currentMillis - lastPollTime < COMMAND_POLL_INTERVAL_MS) {
    return false;
  }
  lastPollTime = currentMillis;

  String url = String(BACKEND_BASE_URL) + "/robot/commands/next";

  int retries = 0;
  int httpCode = -1;
  String payload = "";

  // Retry loop: Up to 2 retries on transient network hiccups
  while (retries <= 2) {
    HTTPClient http;
    http.begin(url);
    http.addHeader("x-robot-device-id", ROBOT_DEVICE_UUID);
    http.addHeader("x-robot-api-key", ROBOT_API_KEY);
    http.setTimeout(3000); // 3-second timeout

    httpCode = http.GET();

    if (httpCode == HTTP_CODE_OK) { // 200 OK
      payload = http.getString();
      http.end();
      consecutiveFailures = 0;
      parseAndExecuteCommand(payload, servos);
      return true;
    } 
    else if (httpCode == 204) { // 204 No Content - Queue is empty
      http.end();
      consecutiveFailures = 0;
      return false;
    } 
    else if (httpCode == 401) { // 401 Unauthorized
      http.end();
      consecutiveFailures++;
      Serial.println("[Network] [ERROR 401] Unauthorized! Check ROBOT_DEVICE_UUID and ROBOT_API_KEY.");
      return false;
    } 
    else {
      retries++;
      if (retries <= 2) {
        delay(150); // brief backoff before retry
      }
      http.end();
    }
  }

  // If all retries failed
  consecutiveFailures++;
  if (consecutiveFailures >= 4) {
    Serial.printf("[Network] Polling failed repeatedly (HTTP %d). Verifying LAN reachability...\n", httpCode);
  }
  return false;
}

void NetworkManager::parseAndExecuteCommand(const String& payload, ServoController& servos) {
#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  StaticJsonDocument<1024> doc;
#endif

  DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    Serial.printf("[Network] JSON parse error: %s\n", error.c_str());
    return;
  }

  JsonObject command = doc["command"];
  if (command.isNull()) return;

  // 1. Deduplication Check
  const char* cmdId = command["id"] | "";
  if (strlen(cmdId) > 0 && lastCommandId == cmdId) {
    Serial.printf("[Robot] Duplicate command ignored (ID: %s)\n", cmdId);
    return;
  }
  if (strlen(cmdId) > 0) {
    lastCommandId = cmdId;
  }

  // 2. Strict Gesture Validation: Only accept WAVE, NOD, IDLE
  String gestureName = command["gesture"] | command["gestureName"] | "";
  gestureName.trim();
  gestureName.toUpperCase();

  if (gestureName.length() > 0) {
    if (gestureName == "WAVE" || gestureName == "GREET_WAVE") {
      Serial.printf("[Command] [VALID] Executing WAVE (ID: %s)\n", cmdId);
      servos.triggerGesture(GESTURE_WAVE);
    } else if (gestureName == "NOD" || gestureName == "NOD_YES") {
      Serial.printf("[Command] [VALID] Executing NOD (ID: %s)\n", cmdId);
      servos.triggerGesture(GESTURE_NOD);
    } else if (gestureName == "IDLE" || gestureName == "RESET_IDLE") {
      Serial.printf("[Command] [VALID] Executing IDLE (ID: %s)\n", cmdId);
      servos.triggerGesture(GESTURE_IDLE);
    } else {
      Serial.printf("[Command] [REJECTED] Unknown gesture '%s'. Only WAVE, NOD, and IDLE are accepted.\n",
                    gestureName.c_str());
    }
    return;
  }

  // 3. Fallback: Multi-step direct angle execution (if direct angles were queued)
  JsonArray steps = command["steps"];
  if (!steps.isNull() && steps.size() > 0) {
    for (JsonObject step : steps) {
      int head = step["head"] | step["headPan"] | servos.getHeadAngle();
      int left = step["leftArm"] | step["headTilt"] | servos.getLeftArmAngle();
      int right = step["rightArm"] | step["armWave"] | servos.getRightArmAngle();

      servos.setTargetAngles(head, left, right);
    }
  }
}

void NetworkManager::sendHeartbeat(const ServoController& servos) {
  if (!isConnected()) return;

  unsigned long currentMillis = millis();
  if (currentMillis - lastHeartbeatTime < HEARTBEAT_INTERVAL_MS) {
    return;
  }
  lastHeartbeatTime = currentMillis;

  HTTPClient http;
  String url = String(BACKEND_BASE_URL) + "/robot/heartbeat";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-robot-device-id", ROBOT_DEVICE_UUID);
  http.addHeader("x-robot-api-key", ROBOT_API_KEY);
  http.setTimeout(3000);

#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  StaticJsonDocument<256> doc;
#endif

  doc["deviceUuid"] = ROBOT_DEVICE_UUID;
  doc["ipAddress"] = WiFi.localIP().toString();
  doc["rssi"] = WiFi.RSSI();
  doc["status"] = "online";
  
  JsonObject s = doc["servos"].to<JsonObject>();
  s["head"] = servos.getHeadAngle();
  s["leftArm"] = servos.getLeftArmAngle();
  s["rightArm"] = servos.getRightArmAngle();

  String requestBody;
  serializeJson(doc, requestBody);

  int httpCode = http.POST(requestBody);
  if (httpCode == HTTP_CODE_OK || httpCode == 201) {
    // Heartbeat acknowledged
  } else if (httpCode > 0) {
    Serial.printf("[Heartbeat] Server returned status %d\n", httpCode);
  }
  http.end();
}

void NetworkManager::update(ServoController& servos) {
  maintainConnection();
  pollNextCommand(servos);
  sendHeartbeat(servos);
}
