# PulseCore AI Gym Receptionist Robot — ESP32 Firmware & Hardware Guide

This directory contains the production-grade Arduino C++ firmware and calibration tools for the **ESP32 DevKit V1** controlling the 3x SG90 servo motor assembly.

---

## 1. Hardware Pin Assignment

| Actuator / Component | ESP32 Pin | Signal Type | Function & Motion Range |
| :--- | :--- | :--- | :--- |
| **Head Servo** | **GPIO 18** | PWM (50 Hz) | Head nod / pan (Safe limits: **30° to 150°**, Neutral: **90°**) |
| **Left Arm Servo** | **GPIO 19** | PWM (50 Hz) | Welcoming / guide arm (Safe limits: **15° to 160°**, Idle: **20°**) |
| **Right Arm Servo** | **GPIO 21** | PWM (50 Hz) | Primary waving arm (Safe limits: **15° to 160°**, Idle: **20°**) |
| **Status Indicator** | **GPIO 2** | Digital Output | Built-in Blue LED (Blinks on Wi-Fi connection, Solid when online) |

---

## 2. Power Architecture: Single-Cell Battery & Regulated 5V Supply

SG90 micro-servos draw up to **650 mA each when stalling or starting rapidly**. Running 3 servos simultaneously can draw spikes exceeding **1.8 A**. 

> [!CAUTION]
> **NEVER power servos from the ESP32's onboard 3.3V pin or USB 5V pin!** 
> Drawing motor current through the ESP32 board will instantly trigger the hardware brownout detector (`Brownout detector was triggered`) or permanently burn out the AMS1117-3.3 voltage regulator.

### Recommended Power Delivery Schematic

```
[1S 3.7V Li-Ion / 18650 Battery] (2500–3500 mAh)
               │
               ▼
[TP4056 Charger & Protection Module] (Over-charge / Over-discharge safety)
               │
               ▼
   [MT3608 DC-DC Step-Up Boost Converter]
               │
               ├───────> Regulated 5.0V (Adjust trimmer with multimeter to 5.00V)
               │            │
               │            ├────> [+] 470µF–1000µF 16V Electrolytic Capacitor
               │            │
               │            ├────> Servos 5V (Red wires for Head, Left Arm, Right Arm)
               │            │
               │            └────> ESP32 VIN Pin (powers onboard ESP32 3.3V regulator)
               │
               └───────> Common Ground (GND) Rail
                            │
                            ├────> [-] Capacitor Negative
                            ├────> Servos GND (Brown / Black wires)
                            └────> ESP32 GND Pin
```

### Essential Wiring Rules:
1. **Common Ground (GND)**: The battery negative, boost converter `OUT-`, ESP32 `GND`, and all three SG90 `GND` lines must be tied together. Without a common ground reference, the 3.3V PWM control signals from GPIO 18/19/21 will float, causing violent servo twitching.
2. **Buffer Capacitor**: Solder or insert a **470 µF to 1000 µF (10V–16V)** electrolytic capacitor directly across the +5V and GND rail right next to the servos. This reservoir capacitor absorbs the instantaneous inductive inrush current whenever a servo begins moving.
3. **Logic Levels**: SG90 servos comfortably accept 3.3V logic pulses from the ESP32 GPIOs when powered with 5V on their supply rail.

---

## 3. Two-Stage Testing Workflow

### Stage 1: Local Servo Standalone Test (`local_servo_test/`)
*Validates mechanics, servo horn alignment, and safe angles without Wi-Fi or backend dependencies.*

1. Open `esp32/local_servo_test/local_servo_test.ino` in Arduino IDE.
2. Connect ESP32 via USB and upload.
3. Open **Serial Monitor** at **115200 baud** (line ending set to *Newline*).
4. Send interactive single-letter commands:
   - `W` or `WAVE` — Runs the non-blocking waving sequence.
   - `N` or `NOD` — Runs the head nodding sequence.
   - `I` or `IDLE` — Resets all servos smoothly to neutral resting posture.
   - `S` or `SWEEP` — Runs a safe sequential calibration sweep of each servo.
   - `H 90` — Manually sets the head angle to 90°.
   - `STATUS` — Displays current angle readings.

### Stage 2: Full Networked Firmware (`gym_receptionist_firmware/`)
*Connects to 2.4 GHz Wi-Fi, authenticates with Node.js backend using custom headers, polls commands, and reports telemetry.*

1. Copy `config.h.example` to `config.h` in `gym_receptionist_firmware/`.
2. Edit `config.h`:
   - Set `WIFI_SSID` and `WIFI_PASSWORD` (2.4 GHz only).
   - Set `BACKEND_BASE_URL` to your computer's local LAN IP (e.g. `http://192.168.1.100:3000/api`).
   - Verify `ROBOT_DEVICE_UUID` (`ESP32_RECEPTION_01`) and `ROBOT_API_KEY`.
3. Open `esp32/gym_receptionist_firmware/gym_receptionist_firmware.ino` and click **Upload**.
4. Open **Serial Monitor** at **115200 baud** to view real-time Wi-Fi handshake, command retrieval, and heartbeat telemetry.

---

## 4. Arduino IDE 2.x Installation & Upload Guide

### Required Libraries:
1. **ESP32Servo** by *Kevin Harrington* (install via Library Manager `Ctrl+Shift+I`).
2. **ArduinoJson** by *Benoit Blanchon* (version 6.x or 7.x).

### Board Settings in Arduino IDE:
- **Board**: `DOIT ESP32 DEVKIT V1` (or `ESP32 Dev Module`)
- **Upload Speed**: `921600` (or `115200` if connection drops)
- **CPU Frequency**: `240MHz (WiFi/BT)`
- **Flash Frequency**: `80MHz`
- **Flash Mode**: `QIO`
- **Port**: Select the active COM port (e.g., `COM3`, `COM4` shown under Windows Device Manager -> Ports).

> [!TIP]
> If Arduino IDE gets stuck on `Connecting........_____....._____`:
> Press and hold the physical **BOOT** button on the ESP32 board until the upload percentage starts counting up, then release it.

---

## 5. Troubleshooting Matrix

| Issue / Symptom | Root Cause | Solution |
| :--- | :--- | :--- |
| **`Brownout detector was triggered`** | SG90 motor inrush current dropped the ESP32 input voltage below 2.7V. | Add a 470µF–1000µF capacitor across the 5V servo rail. Ensure external boost converter can supply >= 2A peak. |
| **Servos violently twitch or chatter** | Missing common ground or noisy power supply. | Connect ESP32 GND and External 5V GND together. Verify boost converter output is exactly 5.0V. |
| **Wi-Fi will not connect (stuck on dots)** | Attempting to connect to 5 GHz Wi-Fi network, or incorrect password. | ESP32 only supports 2.4 GHz Wi-Fi. Check your router to verify separate 2.4 GHz SSID is active. |
| **`HTTP GET failed, code: -1`** | ESP32 cannot reach the backend server IP. | Verify your PC firewall is allowing incoming connections on port 3000. Ensure you used your PC's LAN IP (run `ipconfig` in PowerShell) instead of `localhost`. |
| **`[ERROR 401] Unauthorized`** | Device authentication header mismatch. | Ensure `ROBOT_DEVICE_UUID` and `ROBOT_API_KEY` in `config.h` match the backend `.env` file. |
| **Servo arm buzzes at extreme angles** | Horn is binding mechanically against the physical end-stop. | Re-seat the horn at 90° center, or adjust safe boundaries in `config.h` (`SERVO_HEAD_MIN`, `SERVO_LEFT_MIN`, etc.). |
