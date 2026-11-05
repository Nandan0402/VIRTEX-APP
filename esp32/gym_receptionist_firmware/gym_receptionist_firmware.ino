/**
 * ==============================================================================
 * Project: Wi-Fi ESP32 AI Gym Receptionist Robot
 * File: gym_receptionist_firmware.ino
 * Target Board: ESP32 DevKit V1 (ESP-WROOM-32)
 *
 * Actuators:
 *   - Head Servo      : GPIO 18 (PWM)
 *   - Left Arm Servo  : GPIO 19 (PWM)
 *   - Right Arm Servo : GPIO 21 (PWM)
 *
 * Power System:
 *   - 1S 3.7V Li-Ion / LiPo (e.g. 18650 cell)
 *   - MT3608 or XL6009 Boost Converter stepping 3.7V -> 5.0V regulated
 *   - Common Ground (GND) shared between ESP32 and Boost Converter
 *   - 470uF - 1000uF electrolytic capacitor on 5V servo rail
 *
 * Capabilities:
 *   - Automatic Wi-Fi reconnection (non-blocking)
 *   - Safe servo soft-start & clamped physical travel (Head 30-150°, Arms 15-160°)
 *   - Predefined gestures: WAVE, NOD, IDLE
 *   - Device-authenticated HTTP polling against Node.js / Express backend
 *   - Periodic telemetry heartbeat & real-time Serial Monitor diagnostic logs
 * ==============================================================================
 */

#include <Arduino.h>
#include "config.h"
#include "ServoController.h"
#include "NetworkManager.h"

// Instantiate core subsystems
ServoController servoController;
NetworkManager networkManager;

// Optional: Local serial override during live operations
void handleDiagnosticSerial() {
  if (!Serial.available()) return;

  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  cmd.toUpperCase();

  if (cmd == "W" || cmd == "WAVE") {
    Serial.println("[Manual Override] Triggering WAVE gesture...");
    servoController.triggerGesture(GESTURE_WAVE);
  } else if (cmd == "N" || cmd == "NOD") {
    Serial.println("[Manual Override] Triggering NOD gesture...");
    servoController.triggerGesture(GESTURE_NOD);
  } else if (cmd == "I" || cmd == "IDLE") {
    Serial.println("[Manual Override] Returning to IDLE stance...");
    servoController.triggerGesture(GESTURE_IDLE);
  } else if (cmd == "STATUS") {
    Serial.printf("[Telemetry] Head: %d° | Left Arm: %d° | Right Arm: %d° | Wi-Fi: %s (IP: %s)\n",
                  servoController.getHeadAngle(),
                  servoController.getLeftArmAngle(),
                  servoController.getRightArmAngle(),
                  networkManager.isConnected() ? "ONLINE" : "OFFLINE",
                  networkManager.isConnected() ? WiFi.localIP().toString().c_str() : "N/A");
  } else if (cmd == "HELP" || cmd == "?") {
    Serial.println("\n--- Serial Diagnostics Menu ---");
    Serial.println("  W / WAVE   : Force wave gesture");
    Serial.println("  N / NOD    : Force nod gesture");
    Serial.println("  I / IDLE   : Force idle posture");
    Serial.println("  STATUS     : Show current angles and network state");
    Serial.println("--------------------------------");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n=======================================================");
  Serial.println("🤖 PulseCore AI Gym Receptionist Robot - ESP32 Firmware ");
  Serial.println("=======================================================");
  Serial.println("[Boot] Target: ESP32 DevKit V1 (ESP-WROOM-32)");
  Serial.printf("[Boot] Head Servo      : GPIO %d\n", PIN_SERVO_HEAD);
  Serial.printf("[Boot] Left Arm Servo  : GPIO %d\n", PIN_SERVO_LEFT_ARM);
  Serial.printf("[Boot] Right Arm Servo : GPIO %d\n", PIN_SERVO_RIGHT_ARM);
  Serial.printf("[Boot] Device UUID     : %s\n", ROBOT_DEVICE_UUID);

  // 1. Initialize servos safely (sequential soft attachment)
  servoController.begin();

  // 2. Connect to Wi-Fi network
  networkManager.begin();

  Serial.println("\n[Ready] System operational. Polling backend for motion commands.");
  Serial.println("[Ready] Type 'HELP' or '?' in Serial Monitor for manual test commands.\n");
}

void loop() {
  // 1. Check for manual developer commands via Serial
  handleDiagnosticSerial();

  // 2. Step servo motion engine (non-blocking easing & gesture state machine)
  servoController.update();

  // 3. Update network client (reconnection check, poll command queue, telemetry heartbeat)
  networkManager.update(servoController);

  // Yield 2ms to prevent FreeRTOS watchdog starvation
  delay(2);
}
