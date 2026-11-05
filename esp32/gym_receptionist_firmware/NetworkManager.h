/**
 * ==============================================================================
 * NetworkManager.h - Wi-Fi Reconnection & Device-Authenticated HTTP Client
 * Target: ESP32 DevKit V1
 * ==============================================================================
 */

#ifndef NETWORK_MANAGER_H
#define NETWORK_MANAGER_H

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include "config.h"
#include "ServoController.h"

class NetworkManager {
public:
  NetworkManager();

  void begin();
  void update(ServoController& servos);

  bool isConnected();
  void maintainConnection();

  bool pollNextCommand(ServoController& servos);
  void sendHeartbeat(const ServoController& servos);

  int getConsecutiveFailures() const { return consecutiveFailures; }
  const String& getLastCommandId() const { return lastCommandId; }

private:
  unsigned long lastPollTime;
  unsigned long lastHeartbeatTime;
  unsigned long lastReconnectAttempt;
  bool wasConnected;

  String lastCommandId;
  int consecutiveFailures;

  void parseAndExecuteCommand(const String& payload, ServoController& servos);
};

#endif // NETWORK_MANAGER_H
