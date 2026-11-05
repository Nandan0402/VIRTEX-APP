/**
 * ==============================================================================
 * ServoController.h - Safe 3-Servo Actuation & Non-Blocking Gesture Engine
 * Target: ESP32 DevKit V1 with 3x SG90 Servos
 * ==============================================================================
 */

#ifndef SERVO_CONTROLLER_H
#define SERVO_CONTROLLER_H

#include <Arduino.h>
#include <ESP32Servo.h>
#include "config.h"

enum RobotGesture {
  GESTURE_NONE,
  GESTURE_WAVE,
  GESTURE_NOD,
  GESTURE_IDLE
};

class ServoController {
public:
  ServoController();
  
  // Safe initialization (sequential power-on and gentle homing)
  void begin();

  // Non-blocking motion tick — called every loop()
  void update();

  // Gesture Triggers
  void triggerGesture(RobotGesture gesture);
  void triggerGestureByName(const String& name);
  void setNeutral();

  // Direct angle positioning (with boundary validation and clamping)
  bool setTargetAngles(int head, int leftArm, int rightArm);

  // Telemetry accessors
  int getHeadAngle() const { return currentHead; }
  int getLeftArmAngle() const { return currentLeftArm; }
  int getRightArmAngle() const { return currentRightArm; }
  bool isMoving() const;
  const char* getCurrentGestureName() const;

private:
  Servo servoHead;
  Servo servoLeftArm;
  Servo servoRightArm;

  int currentHead;
  int currentLeftArm;
  int currentRightArm;

  int targetHead;
  int targetLeftArm;
  int targetRightArm;

  unsigned long lastStepTime;
  unsigned long stepIntervalMs;

  RobotGesture currentGesture;
  int gestureStep;
  unsigned long gestureTimer;

  int clampAngle(int value, int minVal, int maxVal);
  void handleActiveGesture();
  void stepTowardsTargets();
};

#endif // SERVO_CONTROLLER_H
