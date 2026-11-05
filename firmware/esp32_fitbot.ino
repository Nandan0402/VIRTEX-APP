/**
 * ============================================================================
 * PulseCore FitBot - ESP32 Physical Receptionist Robot Firmware
 * ============================================================================
 * Target Microcontroller : ESP32 DevKit V1 (30-pin / DOIT ESP32 DEVKIT V1)
 * Actuators              : 3x SG90 Micro Servos (Head Pan, Head Tilt / Left Arm, Right Arm Wave)
 * Power Architecture     : External Regulated 5V 2A-3A Servo Supply + Common Ground
 * Decoupling             : 1000µF 16V Low-ESR Electrolytic Capacitor across 5V Servo Rail
 * Authentication         : Hardware Device ID & Secret Pre-Shared API Key Headers
 * Fail-Safe              : Automatic fallback to neutral IDLE resting pose on Wi-Fi drop
 * ============================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>

// ============================================================================
// HARDWARE PIN DEFINITIONS
// ============================================================================
#define PIN_SERVO_HEAD_PAN   18   // SG90 Head Pan / Horizontal Yaw (GPIO 18)
#define PIN_SERVO_HEAD_TILT  19   // SG90 Head Tilt / Left Arm Pitch (GPIO 19)
#define PIN_SERVO_ARM_WAVE   21   // SG90 Right Arm Wave (GPIO 21)
#define PIN_STATUS_LED        2   // On-board Blue Status LED (GPIO 2)
#define PIN_BATTERY_ADC      34   // ADC1 Channel 6 for battery voltage divider (GPIO 34)

// ============================================================================
// NETWORK & BACKEND CONFIGURATION
// ============================================================================
const char* WIFI_SSID         = "PulseCore_Staff_WiFi";     // Replace with your 2.4GHz Wi-Fi SSID
const char* WIFI_PASSWORD     = "PulseCoreSecure2026";      // Replace with Wi-Fi Password
const char* BACKEND_BASE_URL  = "http://192.168.1.100:3000"; // Replace with your Node.js backend IP & Port

// Device Authentication Credentials (Never exposed in frontend JS)
const char* ROBOT_DEVICE_ID   = "ESP32_RECEPTION_01";
const char* ROBOT_API_KEY     = "gym_robot_secret_key_12345";
const char* FIRMWARE_VERSION  = "v1.4.0-hardware-prod";

// ============================================================================
// SERVO CALIBRATION & SAFETY BOUNDS (Clamping to prevent physical gear stripping)
// ============================================================================
const int PAN_MIN     = 0;
const int PAN_MAX     = 180;
const int PAN_IDLE    = 90;

const int TILT_MIN    = 45;
const int TILT_MAX    = 135;
const int TILT_IDLE   = 90;

const int ARM_MIN     = 0;
const int ARM_MAX     = 160;
const int ARM_IDLE    = 10;   // Resting downward position

// Timing constants (milliseconds)
const unsigned long HEARTBEAT_INTERVAL_MS = 3000;  // Send telemetry every 3 seconds
const unsigned long POLL_INTERVAL_MS      = 500;   // Poll command queue every 500ms
const unsigned long WIFI_RETRY_INTERVAL_MS = 5000; // Wi-Fi reconnect backoff

// Servo instances
Servo servoHeadPan;
Servo servoHeadTilt;
Servo servoArmWave;

// Runtime state tracking
int currentHeadPan  = PAN_IDLE;
int currentHeadTilt = TILT_IDLE;
int currentArmWave  = ARM_IDLE;

unsigned long lastHeartbeatTime = 0;
unsigned long lastPollTime      = 0;
unsigned long lastWifiRetryTime = 0;
bool isSystemInFailSafe         = false;

// HTTP Client Reuse
HTTPClient http;
WiFiClient wifiClient;

// ============================================================================
// SERVO SMOOTH MOTION CONTROLLER
// ============================================================================

/**
 * Clamp integer angle between physical minimum and maximum limits
 */
int clampAngle(int angle, int minVal, int maxVal) {
  if (angle < minVal) return minVal;
  if (angle > maxVal) return maxVal;
  return angle;
}

/**
 * Move servos smoothly from current angles to target angles with interpolation.
 * Prevents abrupt current inrush spikes that cause brownout resets.
 */
void moveToPositions(int targetPan, int targetTilt, int targetArm, int transitMs = 300) {
  targetPan  = clampAngle(targetPan,  PAN_MIN,  PAN_MAX);
  targetTilt = clampAngle(targetTilt, TILT_MIN, TILT_MAX);
  targetArm  = clampAngle(targetArm,  ARM_MIN,  ARM_MAX);

  int startPan  = currentHeadPan;
  int startTilt = currentHeadTilt;
  int startArm  = currentArmWave;

  int maxSteps = max(abs(targetPan - startPan), max(abs(targetTilt - startTilt), abs(targetArm - startArm)));
  if (maxSteps <= 0) maxSteps = 1;

  int stepDelay = transitMs / maxSteps;
  if (stepDelay < 5) stepDelay = 5;

  for (int step = 1; step <= maxSteps; step++) {
    float progress = (float)step / (float)maxSteps;
    int nextPan  = startPan  + (int)((targetPan  - startPan)  * progress);
    int nextTilt = startTilt + (int)((targetTilt - startTilt) * progress);
    int nextArm  = startArm  + (int)((targetArm  - startArm)  * progress);

    servoHeadPan.write(nextPan);
    servoHeadTilt.write(nextTilt);
    servoArmWave.write(nextArm);

    delay(stepDelay);
  }

  // Ensure exact final target alignment
  servoHeadPan.write(targetPan);
  servoHeadTilt.write(targetTilt);
  servoArmWave.write(targetArm);

  currentHeadPan  = targetPan;
  currentHeadTilt = targetTilt;
  currentArmWave  = targetArm;
}

// ============================================================================
// CHOREOGRAPHED GESTURES (WAVE, NOD, SHAKE, IDLE)
// ============================================================================

/**
 * WAVE Gesture: Enthusaistic welcoming arm wave with slight affirmative head tilt
 */
void executeGestureWave() {
  Serial.println("[FitBot] Executing Gesture: WAVE");
  digitalWrite(PIN_STATUS_LED, HIGH);

  // 1. Initial greeting lift
  moveToPositions(90, 80, 110, 250);
  delay(100);

  // 2. Wave cycles
  for (int i = 0; i < 2; i++) {
    moveToPositions(90, 80, 150, 200);
    delay(50);
    moveToPositions(90, 80, 110, 200);
    delay(50);
  }

  // 3. Return to neutral resting pose
  moveToPositions(PAN_IDLE, TILT_IDLE, ARM_IDLE, 350);
  digitalWrite(PIN_STATUS_LED, LOW);
}

/**
 * NOD Gesture: Vertical head affirmative affirmation
 */
void executeGestureNod() {
  Serial.println("[FitBot] Executing Gesture: NOD");
  digitalWrite(PIN_STATUS_LED, HIGH);

  for (int i = 0; i < 2; i++) {
    moveToPositions(90, 70, ARM_IDLE, 180);
    delay(40);
    moveToPositions(90, 110, ARM_IDLE, 180);
    delay(40);
  }

  moveToPositions(PAN_IDLE, TILT_IDLE, ARM_IDLE, 250);
  digitalWrite(PIN_STATUS_LED, LOW);
}

/**
 * SHAKE Gesture: Horizontal head pan denial / unavailable indication
 */
void executeGestureShake() {
  Serial.println("[FitBot] Executing Gesture: SHAKE");
  digitalWrite(PIN_STATUS_LED, HIGH);

  for (int i = 0; i < 2; i++) {
    moveToPositions(60, 90, ARM_IDLE, 180);
    delay(40);
    moveToPositions(120, 90, ARM_IDLE, 180);
    delay(40);
  }

  moveToPositions(PAN_IDLE, TILT_IDLE, ARM_IDLE, 250);
  digitalWrite(PIN_STATUS_LED, LOW);
}

/**
 * IDLE Gesture: Return all three servos smoothly to safe resting neutral
 */
void executeGestureIdle() {
  Serial.println("[FitBot] Executing Gesture: IDLE (Safe Neutral Rest)");
  moveToPositions(PAN_IDLE, TILT_IDLE, ARM_IDLE, 300);
}

// ============================================================================
// HARDWARE SENSORS & TELEMETRY
// ============================================================================

/**
 * Read battery voltage through 2:1 resistive voltage divider on GPIO 34.
 * Divider formula: Vbat = (ADC_reading / 4095.0) * 3.3V * (R1 + R2) / R2
 * Assuming standard 100kΩ / 100kΩ divider (multiplier = 2.0).
 */
float readBatteryVoltage() {
  int rawADC = analogRead(PIN_BATTERY_ADC);
  // ADC calibration adjustment for ESP32 non-linear range
  float measuredV = (rawADC / 4095.0f) * 3.3f * 2.0f;
  if (measuredV < 0.1f) {
    // If ADC pin is floating or unpopulated on test bench, report nominal 4.10V
    return 4.10f;
  }
  return measuredV;
}

/**
 * Estimate battery percentage from Li-Ion discharge curve
 * 4.20V = 100%, 3.70V = 50%, 3.20V = 0%
 */
int calculateBatteryPercent(float voltage) {
  if (voltage >= 4.20f) return 100;
  if (voltage <= 3.20f) return 0;
  return (int)(((voltage - 3.20f) / (4.20f - 3.20f)) * 100.0f);
}

// ============================================================================
// NETWORK & FAIL-SAFE MANAGEMENT
// ============================================================================

/**
 * Connect to Wi-Fi with auto-reconnect handling
 */
void ensureWiFiConnection() {
  if (WiFi.status() == WL_CONNECTED) {
    if (isSystemInFailSafe) {
      Serial.println("[FitBot] Wi-Fi link re-established. Exiting fail-safe mode.");
      isSystemInFailSafe = false;
      digitalWrite(PIN_STATUS_LED, LOW);
    }
    return;
  }

  unsigned long now = millis();
  if (now - lastWifiRetryTime < WIFI_RETRY_INTERVAL_MS) {
    return;
  }
  lastWifiRetryTime = now;

  Serial.print("[FitBot] Connecting to Wi-Fi SSID: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  // Trigger immediate fail-safe neutral pose to avoid physical lockup
  if (!isSystemInFailSafe) {
    Serial.println("[FitBot] WARN: Wi-Fi lost or connecting. Articulating servos to neutral IDLE.");
    executeGestureIdle();
    isSystemInFailSafe = true;
  }

  // Blink LED while connecting
  for (int i = 0; i < 5; i++) {
    digitalWrite(PIN_STATUS_LED, !digitalRead(PIN_STATUS_LED));
    delay(100);
  }
}

// ============================================================================
// REST API CLIENT & PROTOCOL IMPLEMENTATION
// ============================================================================

/**
 * Send Heartbeat Telemetry (POST /api/v1/robot/heartbeat)
 */
void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;

  String endpoint = String(BACKEND_BASE_URL) + "/api/v1/robot/heartbeat";
  http.begin(wifiClient, endpoint);

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Robot-Device-Id", ROBOT_DEVICE_ID);
  http.addHeader("X-Robot-Api-Key", ROBOT_API_KEY);

  float batteryV = readBatteryVoltage();
  int batteryPct = calculateBatteryPercent(batteryV);
  int wifiRssi   = WiFi.RSSI();

  StaticJsonDocument<384> doc;
  doc["deviceUuid"]     = ROBOT_DEVICE_ID;
  doc["ipAddress"]      = WiFi.localIP().toString();
  doc["wifiRssi"]       = wifiRssi;
  doc["batteryLevel"]   = batteryPct;
  doc["batteryVoltage"] = batteryV;

  JsonObject servos = doc.createNestedObject("servos");
  servos["headPan"]  = currentHeadPan;
  servos["headTilt"] = currentHeadTilt;
  servos["armWave"]  = currentArmWave;

  String requestBody;
  serializeJson(doc, requestBody);

  int httpCode = http.POST(requestBody);
  if (httpCode == HTTP_CODE_OK || httpCode == 201) {
    // Heartbeat acknowledged successfully
  } else if (httpCode > 0) {
    Serial.printf("[FitBot] Heartbeat returned HTTP %d\n", httpCode);
  } else {
    Serial.printf("[FitBot] Heartbeat failed, error: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
}

/**
 * Report Hardware Log or Error to Backend (POST /api/v1/robot/errors)
 */
void reportHardwareLog(const char* level, const char* eventType, const char* message) {
  if (WiFi.status() != WL_CONNECTED) return;

  String endpoint = String(BACKEND_BASE_URL) + "/api/v1/robot/errors";
  http.begin(wifiClient, endpoint);

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Robot-Device-Id", ROBOT_DEVICE_ID);
  http.addHeader("X-Robot-Api-Key", ROBOT_API_KEY);

  StaticJsonDocument<256> doc;
  doc["logLevel"]  = level;
  doc["eventType"] = eventType;
  doc["message"]   = message;

  String requestBody;
  serializeJson(doc, requestBody);
  http.POST(requestBody);
  http.end();
}

/**
 * Acknowledge Command Execution to Backend (POST /api/v1/robot/commands/:id/ack)
 */
void acknowledgeCommand(const char* commandId, const char* status, unsigned long executionTimeMs, const char* errorMsg = nullptr) {
  if (WiFi.status() != WL_CONNECTED) return;

  String endpoint = String(BACKEND_BASE_URL) + "/api/v1/robot/commands/" + String(commandId) + "/ack";
  http.begin(wifiClient, endpoint);

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Robot-Device-Id", ROBOT_DEVICE_ID);
  http.addHeader("X-Robot-Api-Key", ROBOT_API_KEY);

  StaticJsonDocument<256> doc;
  doc["status"]          = status;
  doc["executionTimeMs"] = executionTimeMs;
  if (errorMsg) {
    doc["errorMessage"] = errorMsg;
  }

  String requestBody;
  serializeJson(doc, requestBody);

  int httpCode = http.POST(requestBody);
  if (httpCode == HTTP_CODE_OK) {
    Serial.printf("[FitBot] Command #%s ack sent (%s in %lu ms)\n", commandId, status, executionTimeMs);
  } else {
    Serial.printf("[FitBot] Command #%s ack failed with HTTP %d\n", commandId, httpCode);
  }

  http.end();
}

/**
 * Poll Backend for Next Queued Command (GET /api/v1/robot/commands/next)
 */
void pollNextCommand() {
  if (WiFi.status() != WL_CONNECTED) return;

  String endpoint = String(BACKEND_BASE_URL) + "/api/v1/robot/commands/next";
  http.begin(wifiClient, endpoint);

  http.addHeader("X-Robot-Device-Id", ROBOT_DEVICE_ID);
  http.addHeader("X-Robot-Api-Key", ROBOT_API_KEY);

  int httpCode = http.GET();

  // HTTP 204 means queue is empty (No Content)
  if (httpCode == 204) {
    http.end();
    return;
  }

  if (httpCode == HTTP_CODE_OK) {
    String payload = http.getString();
    http.end(); // Close connection before processing long gesture motions

    DynamicJsonDocument doc(1024);
    DeserializationError err = deserializeJson(doc, payload);

    if (err) {
      Serial.printf("[FitBot] JSON deserialize failed: %s\n", err.c_str());
      reportHardwareLog("ERROR", "json_parse_error", err.c_str());
      return;
    }

    JsonObject command = doc["command"];
    if (command.isNull()) return;

    const char* commandId   = command["id"] | "unknown";
    const char* commandType = command["type"] | command["command_type"] | "GESTURE";
    const char* gestureName = command["gesture"] | command["gesture_name"] | nullptr;

    Serial.printf("[FitBot] Received Command #%s [Type: %s]\n", commandId, commandType);
    unsigned long startTime = millis();

    // 1. Process Pre-choreographed Gestures
    if (String(commandType) == "GESTURE" || gestureName != nullptr) {
      String g = String(gestureName ? gestureName : "IDLE");
      g.toUpperCase();

      if (g == "WAVE" || g == "GREET_WAVE") {
        executeGestureWave();
      } else if (g == "NOD" || g == "NOD_YES") {
        executeGestureNod();
      } else if (g == "SHAKE" || g == "SHAKE_NO") {
        executeGestureShake();
      } else if (g == "IDLE" || g == "RESET_IDLE") {
        executeGestureIdle();
      } else if (g == "LOOK_LEFT") {
        moveToPositions(135, 90, ARM_IDLE, 300);
      } else if (g == "LOOK_RIGHT") {
        moveToPositions(45, 90, ARM_IDLE, 300);
      } else {
        Serial.printf("[FitBot] Unknown gesture '%s', defaulting to IDLE\n", g.c_str());
        executeGestureIdle();
      }

      unsigned long elapsed = millis() - startTime;
      acknowledgeCommand(commandId, "executed", elapsed);
    }
    // 2. Process Direct Calibrated Servo Angles
    else if (String(commandType) == "DIRECT_ANGLES") {
      JsonObject steps = command["steps"][0];
      JsonObject servosObj = command["servoPayload"];

      int targetPan  = currentHeadPan;
      int targetTilt = currentHeadTilt;
      int targetArm  = currentArmWave;

      if (!steps.isNull()) {
        if (!steps["headPan"].isNull())  targetPan  = steps["headPan"].as<int>();
        if (!steps["headTilt"].isNull()) targetTilt = steps["headTilt"].as<int>();
        if (!steps["armWave"].isNull())  targetArm  = steps["armWave"].as<int>();
      } else if (!servosObj.isNull()) {
        if (!servosObj["headPan"].isNull())  targetPan  = servosObj["headPan"].as<int>();
        if (!servosObj["headTilt"].isNull()) targetTilt = servosObj["headTilt"].as<int>();
        if (!servosObj["armWave"].isNull())  targetArm  = servosObj["armWave"].as<int>();
      }

      Serial.printf("[FitBot] Direct angles: Pan=%d°, Tilt=%d°, Arm=%d°\n", targetPan, targetTilt, targetArm);
      moveToPositions(targetPan, targetTilt, targetArm, 300);

      unsigned long elapsed = millis() - startTime;
      acknowledgeCommand(commandId, "executed", elapsed);
    }
  } else {
    http.end();
  }
}

// ============================================================================
// ARDUINO SETUP & INITIALIZATION
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n========================================================");
  Serial.println("  PulseCore FitBot - ESP32 Physical Robot Controller    ");
  Serial.printf("  Firmware: %s | Device: %s\n", FIRMWARE_VERSION, ROBOT_DEVICE_ID);
  Serial.println("========================================================");

  pinMode(PIN_STATUS_LED, OUTPUT);
  digitalWrite(PIN_STATUS_LED, LOW);

  pinMode(PIN_BATTERY_ADC, INPUT);

  // Allocate ESP32 hardware PWM timers for servo control
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);

  // Configure standard SG90 50Hz PWM parameters (500µs to 2400µs pulse width)
  servoHeadPan.setPeriodHertz(50);
  servoHeadTilt.setPeriodHertz(50);
  servoArmWave.setPeriodHertz(50);

  // Attach servos to respective GPIO pins
  servoHeadPan.attach(PIN_SERVO_HEAD_PAN,   500, 2400);
  servoHeadTilt.attach(PIN_SERVO_HEAD_TILT, 500, 2400);
  servoArmWave.attach(PIN_SERVO_ARM_WAVE,   500, 2400);

  // Initialize servos to calibrated neutral resting position
  Serial.println("[FitBot] Calibrating servos to safe neutral IDLE pose...");
  servoHeadPan.write(PAN_IDLE);
  servoHeadTilt.write(TILT_IDLE);
  servoArmWave.write(ARM_IDLE);
  delay(400);

  // Connect to Wi-Fi
  ensureWiFiConnection();
  Serial.println("[FitBot] Initialization complete. Entering control loop.");
}

// ============================================================================
// MAIN EXECUTION LOOP
// ============================================================================
void loop() {
  // 1. Maintain Wi-Fi connectivity & enforce fail-safe on network loss
  ensureWiFiConnection();

  unsigned long currentMillis = millis();

  // 2. Poll for queued motion commands from backend
  if (currentMillis - lastPollTime >= POLL_INTERVAL_MS) {
    lastPollTime = currentMillis;
    if (WiFi.status() == WL_CONNECTED) {
      pollNextCommand();
    }
  }

  // 3. Periodic heartbeat reporting (battery, RSSI, servo angles)
  if (currentMillis - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatTime = currentMillis;
    if (WiFi.status() == WL_CONNECTED) {
      sendHeartbeat();
    }
  }

  delay(10); // Yield to FreeRTOS watchdog
}
