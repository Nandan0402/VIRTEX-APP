/**
 * ==============================================================================
 * Project: Wi-Fi ESP32 AI Gym Receptionist Robot
 * File: local_servo_test.ino
 * Target Board: ESP32 DevKit V1 (ESP-WROOM-32, 30 or 38 pins)
 * 
 * Purpose:
 *   Local Hardware Calibration & Standalone Servo Test.
 *   Validates wiring, external 5V regulated power supply, and safe travel limits
 *   WITHOUT requiring Wi-Fi or backend connectivity.
 * 
 * Hardware Pinout:
 *   - Head Servo Signal      : GPIO 18 (PWM)
 *   - Left Arm Servo Signal  : GPIO 19 (PWM)
 *   - Right Arm Servo Signal : GPIO 21 (PWM)
 *   - External 5V Supply     : Powers SG90 red (+) and brown/black (GND)
 *   - Common Ground          : Connected between ESP32 GND and External 5V GND
 * ==============================================================================
 */

#include <Arduino.h>
#include <ESP32Servo.h>

// --- Pin Definitions ---
const int PIN_HEAD      = 18;
const int PIN_LEFT_ARM  = 19;
const int PIN_RIGHT_ARM = 21;
const int PIN_LED       = 2;   // Onboard Blue LED

// --- Safe Physical Angular Limits (SG90 Micro Servos) ---
// Prevents horn binding against mechanical chassis and protects nylon gears
const int HEAD_MIN      = 30;
const int HEAD_MAX      = 150;
const int HEAD_NEUTRAL  = 90;

const int LEFT_MIN      = 15;
const int LEFT_MAX      = 160;
const int LEFT_IDLE     = 20;   // Arm resting down at side

const int RIGHT_MIN     = 15;
const int RIGHT_MAX     = 160;
const int RIGHT_IDLE    = 20;   // Arm resting down at side

// --- Servo Objects ---
Servo servoHead;
Servo servoLeftArm;
Servo servoRightArm;

// --- State Tracking ---
int currentHead     = HEAD_NEUTRAL;
int currentLeftArm  = LEFT_IDLE;
int currentRightArm = RIGHT_IDLE;

int targetHead      = HEAD_NEUTRAL;
int targetLeftArm   = LEFT_IDLE;
int targetRightArm  = RIGHT_IDLE;

// --- Non-blocking Motion Timing ---
unsigned long lastStepTime = 0;
const unsigned long STEP_INTERVAL_MS = 15; // 15ms per degree = smooth, controlled speed

// --- Gesture State Machine ---
enum GestureState {
  STATE_IDLE,
  STATE_WAVING,
  STATE_NODDING,
  STATE_CALIBRATING
};

GestureState activeGesture = STATE_IDLE;
int gestureStep = 0;
unsigned long gestureTimer = 0;

// ==============================================================================
// Utility Functions
// ==============================================================================

int clamp(int val, int minVal, int maxVal) {
  if (val < minVal) return minVal;
  if (val > maxVal) return maxVal;
  return val;
}

void printStatus() {
  Serial.printf("[STATUS] Current Angles -> Head: %3d° | Left Arm: %3d° | Right Arm: %3d°\n",
                currentHead, currentLeftArm, currentRightArm);
}

// ==============================================================================
// Non-Blocking Smooth Interpolation Engine
// ==============================================================================
void updateServosSmoothly() {
  unsigned long now = millis();
  if (now - lastStepTime < STEP_INTERVAL_MS) {
    return;
  }
  lastStepTime = now;

  bool moved = false;

  // Step Head Servo
  if (currentHead < targetHead) {
    currentHead++;
    servoHead.write(currentHead);
    moved = true;
  } else if (currentHead > targetHead) {
    currentHead--;
    servoHead.write(currentHead);
    moved = true;
  }

  // Step Left Arm Servo
  if (currentLeftArm < targetLeftArm) {
    currentLeftArm++;
    servoLeftArm.write(currentLeftArm);
    moved = true;
  } else if (currentLeftArm > targetLeftArm) {
    currentLeftArm--;
    servoLeftArm.write(currentLeftArm);
    moved = true;
  }

  // Step Right Arm Servo
  if (currentRightArm < targetRightArm) {
    currentRightArm++;
    servoRightArm.write(currentRightArm);
    moved = true;
  } else if (currentRightArm > targetRightArm) {
    currentRightArm--;
    servoRightArm.write(currentRightArm);
    moved = true;
  }
}

bool hasReachedTarget() {
  return (currentHead == targetHead &&
          currentLeftArm == targetLeftArm &&
          currentRightArm == targetRightArm);
}

// ==============================================================================
// Safe Gesture Implementations
// ==============================================================================

void triggerIdle() {
  activeGesture = STATE_IDLE;
  targetHead     = HEAD_NEUTRAL;
  targetLeftArm  = LEFT_IDLE;
  targetRightArm = RIGHT_IDLE;
  Serial.println("\n[GESTURE] Moving to IDLE Stance (Neutral)...");
}

void triggerWave() {
  activeGesture = STATE_WAVING;
  gestureStep   = 0;
  gestureTimer  = millis();
  Serial.println("\n[GESTURE] Starting WAVE Gesture...");
}

void triggerNod() {
  activeGesture = STATE_NODDING;
  gestureStep   = 0;
  gestureTimer  = millis();
  Serial.println("\n[GESTURE] Starting NOD Gesture...");
}

void triggerCalibration() {
  activeGesture = STATE_CALIBRATING;
  gestureStep   = 0;
  gestureTimer  = millis();
  Serial.println("\n[CALIBRATION] Starting Safe Angle Sweep...");
}

void handleGestureStateMachine() {
  if (activeGesture == STATE_IDLE) {
    return;
  }

  unsigned long now = millis();

  // --- WAVE GESTURE SEQUENCE ---
  if (activeGesture == STATE_WAVING) {
    switch (gestureStep) {
      case 0: // Raise right arm to wave position
        targetRightArm = 120;
        targetHead = 100; // Look slightly toward welcoming arm
        if (hasReachedTarget()) {
          gestureStep = 1;
          gestureTimer = now;
        }
        break;
      case 1: // Wave outward
        if (now - gestureTimer > 150) {
          targetRightArm = 150;
          if (hasReachedTarget()) {
            gestureStep = 2;
            gestureTimer = now;
          }
        }
        break;
      case 2: // Wave inward
        if (now - gestureTimer > 150) {
          targetRightArm = 110;
          if (hasReachedTarget()) {
            gestureStep = 3;
            gestureTimer = now;
          }
        }
        break;
      case 3: // Wave outward second time
        if (now - gestureTimer > 150) {
          targetRightArm = 150;
          if (hasReachedTarget()) {
            gestureStep = 4;
            gestureTimer = now;
          }
        }
        break;
      case 4: // Return to idle
        if (now - gestureTimer > 200) {
          triggerIdle();
          Serial.println("[GESTURE] WAVE Completed.");
        }
        break;
    }
  }

  // --- NOD GESTURE SEQUENCE ---
  else if (activeGesture == STATE_NODDING) {
    switch (gestureStep) {
      case 0: // Tilt down
        targetHead = 65;
        if (hasReachedTarget()) {
          gestureStep = 1;
          gestureTimer = now;
        }
        break;
      case 1: // Tilt up
        if (now - gestureTimer > 150) {
          targetHead = 115;
          if (hasReachedTarget()) {
            gestureStep = 2;
            gestureTimer = now;
          }
        }
        break;
      case 2: // Tilt down again
        if (now - gestureTimer > 150) {
          targetHead = 75;
          if (hasReachedTarget()) {
            gestureStep = 3;
            gestureTimer = now;
          }
        }
        break;
      case 3: // Return to center neutral
        if (now - gestureTimer > 150) {
          targetHead = HEAD_NEUTRAL;
          if (hasReachedTarget()) {
            activeGesture = STATE_IDLE;
            Serial.println("[GESTURE] NOD Completed.");
          }
        }
        break;
    }
  }

  // --- CALIBRATION SWEEP SEQUENCE ---
  else if (activeGesture == STATE_CALIBRATING) {
    switch (gestureStep) {
      case 0: // Sweep Head to Min
        targetHead = HEAD_MIN;
        if (hasReachedTarget()) { gestureStep = 1; gestureTimer = now; }
        break;
      case 1: // Sweep Head to Max
        if (now - gestureTimer > 300) {
          targetHead = HEAD_MAX;
          if (hasReachedTarget()) { gestureStep = 2; gestureTimer = now; }
        }
        break;
      case 2: // Sweep Head back to Neutral
        if (now - gestureTimer > 300) {
          targetHead = HEAD_NEUTRAL;
          if (hasReachedTarget()) { gestureStep = 3; gestureTimer = now; }
        }
        break;
      case 3: // Sweep Left Arm Min -> Max
        targetLeftArm = LEFT_MAX;
        if (hasReachedTarget()) { gestureStep = 4; gestureTimer = now; }
        break;
      case 4: // Sweep Left Arm to Idle
        if (now - gestureTimer > 300) {
          targetLeftArm = LEFT_IDLE;
          if (hasReachedTarget()) { gestureStep = 5; gestureTimer = now; }
        }
        break;
      case 5: // Sweep Right Arm Min -> Max
        targetRightArm = RIGHT_MAX;
        if (hasReachedTarget()) { gestureStep = 6; gestureTimer = now; }
        break;
      case 6: // Return everything to idle
        if (now - gestureTimer > 300) {
          triggerIdle();
          Serial.println("[CALIBRATION] Sweep Verification Complete!");
        }
        break;
    }
  }
}

// ==============================================================================
// Interactive Serial Monitor Command Parser
// ==============================================================================
void handleSerialInput() {
  if (!Serial.available()) return;

  String input = Serial.readStringUntil('\n');
  input.trim();
  if (input.length() == 0) return;

  input.toUpperCase();

  if (input == "W" || input == "WAVE") {
    triggerWave();
  }
  else if (input == "N" || input == "NOD") {
    triggerNod();
  }
  else if (input == "I" || input == "IDLE") {
    triggerIdle();
  }
  else if (input == "S" || input == "SWEEP") {
    triggerCalibration();
  }
  else if (input == "?" || input == "HELP") {
    Serial.println("\n--- Interactive Servo Test Menu ---");
    Serial.println("  W or WAVE   : Trigger Right Arm Waving Gesture");
    Serial.println("  N or NOD    : Trigger Head Nodding Gesture");
    Serial.println("  I or IDLE   : Return all servos to safe idle posture");
    Serial.println("  S or SWEEP  : Run single-servo calibration sweep");
    Serial.println("  H <angle>   : Set Head angle (30 - 150)");
    Serial.println("  L <angle>   : Set Left Arm angle (15 - 160)");
    Serial.println("  R <angle>   : Set Right Arm angle (15 - 160)");
    Serial.println("  STATUS      : Print current servo angles");
    Serial.println("------------------------------------");
  }
  else if (input == "STATUS") {
    printStatus();
  }
  else if (input.startsWith("H ")) {
    int angle = input.substring(2).toInt();
    int safeAngle = clamp(angle, HEAD_MIN, HEAD_MAX);
    targetHead = safeAngle;
    activeGesture = STATE_IDLE;
    Serial.printf("[MANUAL] Head target set to %d° (requested: %d°)\n", safeAngle, angle);
  }
  else if (input.startsWith("L ")) {
    int angle = input.substring(2).toInt();
    int safeAngle = clamp(angle, LEFT_MIN, LEFT_MAX);
    targetLeftArm = safeAngle;
    activeGesture = STATE_IDLE;
    Serial.printf("[MANUAL] Left Arm target set to %d° (requested: %d°)\n", safeAngle, angle);
  }
  else if (input.startsWith("R ")) {
    int angle = input.substring(2).toInt();
    int safeAngle = clamp(angle, RIGHT_MIN, RIGHT_MAX);
    targetRightArm = safeAngle;
    activeGesture = STATE_IDLE;
    Serial.printf("[MANUAL] Right Arm target set to %d° (requested: %d°)\n", safeAngle, angle);
  }
  else {
    Serial.printf("[ERROR] Unrecognized command '%s'. Type 'HELP' or '?' for instructions.\n", input.c_str());
  }
}

// ==============================================================================
// Arduino Setup & Loop
// ==============================================================================

void setup() {
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, HIGH); // LED ON during setup

  Serial.begin(115200);
  delay(1200);

  Serial.println("\n=======================================================");
  Serial.println("  GYM RECEPTIONIST ROBOT - LOCAL SERVO CALIBRATION   ");
  Serial.println("=======================================================");
  Serial.println("[SETUP] ESP32 DevKit V1 Initializing...");
  Serial.println("[SETUP] Pin Assignment:");
  Serial.printf("        Head Servo      : GPIO %d\n", PIN_HEAD);
  Serial.printf("        Left Arm Servo  : GPIO %d\n", PIN_LEFT_ARM);
  Serial.printf("        Right Arm Servo : GPIO %d\n", PIN_RIGHT_ARM);

  // 1. Allocate ESP32 PWM Timers for ESP32Servo
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);

  // 2. Set 50Hz PWM frequency (standard for analog SG90)
  servoHead.setPeriodHertz(50);
  servoLeftArm.setPeriodHertz(50);
  servoRightArm.setPeriodHertz(50);

  // 3. Sequential Safe Attachment
  // Staggering attachment prevents simultaneous current spikes from brownout-resetting the ESP32
  Serial.println("[SETUP] Attaching Head Servo (GPIO 18)...");
  servoHead.attach(PIN_HEAD, 500, 2400);
  servoHead.write(HEAD_NEUTRAL);
  delay(200);

  Serial.println("[SETUP] Attaching Left Arm Servo (GPIO 19)...");
  servoLeftArm.attach(PIN_LEFT_ARM, 500, 2400);
  servoLeftArm.write(LEFT_IDLE);
  delay(200);

  Serial.println("[SETUP] Attaching Right Arm Servo (GPIO 21)...");
  servoRightArm.attach(PIN_RIGHT_ARM, 500, 2400);
  servoRightArm.write(RIGHT_IDLE);
  delay(200);

  digitalWrite(PIN_LED, LOW); // LED OFF = Ready
  Serial.println("[SETUP] All 3 servos attached and initialized to safe positions.");
  Serial.println("[SETUP] Open Serial Monitor (115200 baud, 'Newline' line ending).");
  Serial.println("[SETUP] Type 'W' (Wave), 'N' (Nod), 'I' (Idle), or 'HELP' to begin!\n");
  printStatus();
}

void loop() {
  // 1. Process serial commands from user
  handleSerialInput();

  // 2. Run active gesture state machine (WAVE / NOD / CALIBRATE)
  handleGestureStateMachine();

  // 3. Smooth non-blocking step update towards target angles
  updateServosSmoothly();

  // Short FreeRTOS task yield
  delay(2);
}

