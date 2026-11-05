/**
 * ==============================================================================
 * ServoController.cpp - Non-blocking SG90 Motion Implementation
 * ==============================================================================
 */

#include "ServoController.h"

ServoController::ServoController()
  : currentHead(SERVO_HEAD_NEUTRAL),
    currentLeftArm(SERVO_LEFT_IDLE),
    currentRightArm(SERVO_RIGHT_IDLE),
    targetHead(SERVO_HEAD_NEUTRAL),
    targetLeftArm(SERVO_LEFT_IDLE),
    targetRightArm(SERVO_RIGHT_IDLE),
    lastStepTime(0),
    stepIntervalMs(14),
    currentGesture(GESTURE_NONE),
    gestureStep(0),
    gestureTimer(0) {}

int ServoController::clampAngle(int value, int minVal, int maxVal) {
  if (value < minVal) return minVal;
  if (value > maxVal) return maxVal;
  return value;
}

void ServoController::begin() {
  Serial.println("[Servos] Initializing ESP32 PWM Timers for SG90 micro-servos...");

  // ESP32 timer allocation
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);

  // Set 50Hz standard servo frequency
  servoHead.setPeriodHertz(50);
  servoLeftArm.setPeriodHertz(50);
  servoRightArm.setPeriodHertz(50);

  // Staggered sequential attachment prevents brownout from 3 motors energizing at once
  Serial.printf("[Servos] Attaching Head Servo (GPIO %d)...\n", PIN_SERVO_HEAD);
  servoHead.attach(PIN_SERVO_HEAD, 500, 2400);
  servoHead.write(SERVO_HEAD_NEUTRAL);
  delay(200);

  Serial.printf("[Servos] Attaching Left Arm Servo (GPIO %d)...\n", PIN_SERVO_LEFT_ARM);
  servoLeftArm.attach(PIN_SERVO_LEFT_ARM, 500, 2400);
  servoLeftArm.write(SERVO_LEFT_IDLE);
  delay(200);

  Serial.printf("[Servos] Attaching Right Arm Servo (GPIO %d)...\n", PIN_SERVO_RIGHT_ARM);
  servoRightArm.attach(PIN_SERVO_RIGHT_ARM, 500, 2400);
  servoRightArm.write(SERVO_RIGHT_IDLE);
  delay(200);

  setNeutral();
  Serial.println("[Servos] Initialization complete: Neutral safe resting stance set.");
}

void ServoController::setNeutral() {
  currentGesture = GESTURE_NONE;
  targetHead = SERVO_HEAD_NEUTRAL;
  targetLeftArm = SERVO_LEFT_IDLE;
  targetRightArm = SERVO_RIGHT_IDLE;
}

bool ServoController::setTargetAngles(int head, int leftArm, int rightArm) {
  currentGesture = GESTURE_NONE; // Cancel active automated gesture

  int clampedHead = clampAngle(head, SERVO_HEAD_MIN, SERVO_HEAD_MAX);
  int clampedLeft = clampAngle(leftArm, SERVO_LEFT_MIN, SERVO_LEFT_MAX);
  int clampedRight = clampAngle(rightArm, SERVO_RIGHT_MIN, SERVO_RIGHT_MAX);

  if (clampedHead != head || clampedLeft != leftArm || clampedRight != rightArm) {
    Serial.printf("[Servos] Clamped out-of-bound angles: Head(%d->%d), Left(%d->%d), Right(%d->%d)\n",
                  head, clampedHead, leftArm, clampedLeft, rightArm, clampedRight);
  }

  targetHead = clampedHead;
  targetLeftArm = clampedLeft;
  targetRightArm = clampedRight;
  return true;
}

void ServoController::triggerGesture(RobotGesture gesture) {
  currentGesture = gesture;
  gestureStep = 0;
  gestureTimer = millis();

  Serial.printf("[Servos] Gesture triggered: %s\n", getCurrentGestureName());
}

void ServoController::triggerGestureByName(const String& name) {
  String upper = name;
  upper.toUpperCase();
  upper.trim();

  if (upper == "WAVE" || upper == "GREET_WAVE") {
    triggerGesture(GESTURE_WAVE);
  } else if (upper == "NOD" || upper == "NOD_YES") {
    triggerGesture(GESTURE_NOD);
  } else if (upper == "IDLE" || upper == "RESET_IDLE") {
    triggerGesture(GESTURE_IDLE);
  } else {
    Serial.printf("[Servos] Warning: Unknown gesture name '%s'\n", name.c_str());
  }
}

const char* ServoController::getCurrentGestureName() const {
  switch (currentGesture) {
    case GESTURE_WAVE: return "WAVE";
    case GESTURE_NOD:  return "NOD";
    case GESTURE_IDLE: return "IDLE";
    default:           return "NONE";
  }
}

bool ServoController::isMoving() const {
  return (currentHead != targetHead ||
          currentLeftArm != targetLeftArm ||
          currentRightArm != targetRightArm ||
          currentGesture != GESTURE_NONE);
}

void ServoController::stepTowardsTargets() {
  unsigned long now = millis();
  if (now - lastStepTime < stepIntervalMs) {
    return;
  }
  lastStepTime = now;

  // Head step
  if (currentHead < targetHead) {
    currentHead++;
    servoHead.write(currentHead);
  } else if (currentHead > targetHead) {
    currentHead--;
    servoHead.write(currentHead);
  }

  // Left Arm step
  if (currentLeftArm < targetLeftArm) {
    currentLeftArm++;
    servoLeftArm.write(currentLeftArm);
  } else if (currentLeftArm > targetLeftArm) {
    currentLeftArm--;
    servoLeftArm.write(currentLeftArm);
  }

  // Right Arm step
  if (currentRightArm < targetRightArm) {
    currentRightArm++;
    servoRightArm.write(currentRightArm);
  } else if (currentRightArm > targetRightArm) {
    currentRightArm--;
    servoRightArm.write(currentRightArm);
  }
}

void ServoController::handleActiveGesture() {
  if (currentGesture == GESTURE_NONE) return;

  unsigned long now = millis();
  bool reached = (currentHead == targetHead &&
                  currentLeftArm == targetLeftArm &&
                  currentRightArm == targetRightArm);

  if (currentGesture == GESTURE_WAVE) {
    switch (gestureStep) {
      case 0: // Lift right arm to waving height
        targetRightArm = 120;
        targetHead = 100;
        if (reached) { gestureStep = 1; gestureTimer = now; }
        break;
      case 1: // Wave outwards
        if (now - gestureTimer > 150) {
          targetRightArm = 150;
          if (reached) { gestureStep = 2; gestureTimer = now; }
        }
        break;
      case 2: // Wave inwards
        if (now - gestureTimer > 150) {
          targetRightArm = 110;
          if (reached) { gestureStep = 3; gestureTimer = now; }
        }
        break;
      case 3: // Wave outwards again
        if (now - gestureTimer > 150) {
          targetRightArm = 150;
          if (reached) { gestureStep = 4; gestureTimer = now; }
        }
        break;
      case 4: // Return to resting idle
        if (now - gestureTimer > 200) {
          targetRightArm = SERVO_RIGHT_IDLE;
          targetHead = SERVO_HEAD_NEUTRAL;
          if (reached) {
            currentGesture = GESTURE_NONE;
            Serial.println("[Servos] WAVE sequence completed.");
          }
        }
        break;
    }
  }
  else if (currentGesture == GESTURE_NOD) {
    switch (gestureStep) {
      case 0: // Tilt down
        targetHead = 65;
        if (reached) { gestureStep = 1; gestureTimer = now; }
        break;
      case 1: // Tilt up
        if (now - gestureTimer > 150) {
          targetHead = 115;
          if (reached) { gestureStep = 2; gestureTimer = now; }
        }
        break;
      case 2: // Tilt down again
        if (now - gestureTimer > 150) {
          targetHead = 75;
          if (reached) { gestureStep = 3; gestureTimer = now; }
        }
        break;
      case 3: // Return to center neutral
        if (now - gestureTimer > 150) {
          targetHead = SERVO_HEAD_NEUTRAL;
          if (reached) {
            currentGesture = GESTURE_NONE;
            Serial.println("[Servos] NOD sequence completed.");
          }
        }
        break;
    }
  }
  else if (currentGesture == GESTURE_IDLE) {
    targetHead = SERVO_HEAD_NEUTRAL;
    targetLeftArm = SERVO_LEFT_IDLE;
    targetRightArm = SERVO_RIGHT_IDLE;
    if (reached) {
      currentGesture = GESTURE_NONE;
      Serial.println("[Servos] IDLE position reached.");
    }
  }
}

void ServoController::update() {
  handleActiveGesture();
  stepTowardsTargets();
}
