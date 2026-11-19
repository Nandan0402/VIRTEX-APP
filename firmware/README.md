# Virtex FitBot - ESP32 Physical Robot Integration Guide

This guide details the hardware specifications, electrical schematics, pinout mapping, power architecture, brownout protection, and Arduino C++ firmware deployment for the **Virtex FitBot** physical receptionist robot.

---

## 1. Hardware Bill of Materials (BOM)

| Component | Specification | Quantity | Role |
| :--- | :--- | :---: | :--- |
| **Microcontroller** | ESP32 DevKit V1 (30-pin, dual-core Tensilica Xtensa 32-bit LX6 @ 240MHz) | 1 | Motion controller & Wi-Fi client |
| **Actuator (Head Pan)** | TowerPro SG90 9g Micro Servo (PWM 50Hz, 1.8 kg·cm torque) | 1 | Horizontal head yaw (GPIO 18) |
| **Actuator (Head Tilt / Left Arm)** | TowerPro SG90 9g Micro Servo (PWM 50Hz, 1.8 kg·cm torque) | 1 | Pitch nod & tilt / Left arm (GPIO 19) |
| **Actuator (Right Arm Wave)** | TowerPro SG90 9g Micro Servo (PWM 50Hz, 1.8 kg·cm torque) | 1 | Welcoming wave gesture (GPIO 21) |
| **External Power Supply** | Regulated 5V DC 2.5A–3.0A Switch-Mode Buck Converter (LM2596 / MP1584) | 1 | Dedicated servo high-current power |
| **Rechargeable Battery** | 2S 7.4V Li-Ion / LiPo Pack (18650 2200mAh+) or 5V Power Bank | 1 | System power source |
| **Decoupling Capacitor** | 1000µF 16V Low-ESR Radial Electrolytic Capacitor | 1 | Inrush filter across servo 5V rail |
| **Resistive Divider** | 100kΩ (1%) & 100kΩ (1%) Metal Film Resistors | 2 | Battery voltage sensing on GPIO 34 |
| **Decoupling Ceramic Cap** | 100nF (0.1µF) Ceramic Disc Capacitor | 1 | High-frequency noise suppression |

---

## 2. GPIO Pinout Mapping

```
+--------------------------------------------------------------------------+
|                       ESP32 DevKit V1 (30-Pin)                           |
+-------------------+----------------+------------------+------------------+
| Signal / Function | ESP32 GPIO Pin | Wire Color Code  | Destination      |
+-------------------+----------------+------------------+------------------+
| Head Pan (Yaw)    | GPIO 18 (PWM)  | Orange (PWM)     | Servo 1 Signal   |
| Head Tilt / Pitch | GPIO 19 (PWM)  | Orange (PWM)     | Servo 2 Signal   |
| Right Arm Wave    | GPIO 21 (PWM)  | Orange (PWM)     | Servo 3 Signal   |
| On-Board Status   | GPIO 2         | Internal (Blue)  | Connection / Act |
| Battery Voltage   | GPIO 34 (ADC1) | Green            | 2:1 Divider Mid  |
| Ground Reference  | GND            | Black            | Common Ground    |
+-------------------+----------------+------------------+------------------+
```

---

## 3. Power Architecture & Brownout Prevention

> [!CAUTION]
> **NEVER power SG90 servos directly from the ESP32 3.3V or VIN pins.**
> A single SG90 servo draws between 500mA and 800mA stall current under mechanical resistance. Three servos operating simultaneously can demand up to 2.4A peak. Drawing this current through the onboard ESP32 linear regulator will cause instantaneous voltage sag below 2.7V, triggering brownout resets (`rst:0x10 (RTCWDT_RTC_RST)`).

### Wiring Schematic

```
  [ 7.4V Li-Ion Battery ]
       │          │
       │ (+)      │ (-)
       ▼          ▼
  ┌───────────────────────┐
  │  Step-Down Converter  │
  │   (LM2596 / MP1584)   │
  │   Output: 5.0V @ 3A   │
  └───────────┬───────────┘
              │ 5.0V (+)
              ├───────────────────────────────┐
              │                               │
              ▼                               ▼
       [ + Rail: Servos ]              [ 1000µF Cap (+) ]
       ├── Servo 1 VCC (Red)                  │
       ├── Servo 2 VCC (Red)                  │
       └── Servo 3 VCC (Red)                  │
                                              │
              ▲                               ▼
              │ GND (-)                       │
              ├───────────────────────────────┴─ [ 1000µF Cap (-) ]
              │
              ├── Common Ground Point ────────┬── Servo 1 GND (Brown)
              │                               ├── Servo 2 GND (Brown)
              ▼                               └── Servo 3 GND (Brown)
       [ ESP32 GND ]
              │
              ▼
       [ ESP32 VIN ] <── Powered from regulated 5.0V or separate USB-C
```

### Critical Electrical Requirements:
1. **Common Ground**: The ESP32 `GND` pin and the external power supply `GND` **MUST** be physically tied together. Without a common ground reference, the 3.3V PWM control signals on GPIO 18, 19, and 21 will float, causing erratic motor jitter and twitching.
2. **Bulk Decoupling**: Solder a 1000µF 16V electrolytic capacitor directly across the +5V and GND rail on your servo power distribution strip to buffer instantaneous torque spikes.

---

## 4. Battery Voltage Sensing Circuit (GPIO 34)

To monitor battery level safely using ESP32's 3.3V ADC:

```
  Battery (+) [Up to 8.4V for 2S, or 4.2V for 1S]
       │
      ┌┴┐
      │ │ R1 (100kΩ, 1%)
      └┬┘
       ├──────────> To ESP32 GPIO 34 (ADC1_CH6)
      ┌┴┐
      │ │ R2 (100kΩ, 1%)
      └┬┘
       │
      GND (Common Ground)
```

The firmware converts the 12-bit ADC reading (`0–4095`) to voltage and computes remaining capacity against a Li-Ion discharge curve.

---

## 5. Servo Angle Limits & Calibration Matrix

| Actuator | Function | Physical Min | Physical Max | Safe Resting Neutral |
| :--- | :--- | :---: | :---: | :---: |
| **Head Pan** | Look Left/Right | `0°` (Full Right) | `180°` (Full Left) | `90°` (Center) |
| **Head Tilt / Left Arm** | Nod / Tilt | `45°` (Upward) | `135°` (Downward) | `90°` (Center) |
| **Right Arm** | Welcoming Wave | `0°` (Back) | `160°` (High Wave) | `10°` (Resting Down) |

> [!NOTE]
> All software endpoints clamp input angles before dispatching pulses to hardware. Even if an out-of-bounds command is requested, the firmware clamps it to the physical limits table above to prevent mechanical gear stripping.

---

## 6. Supported Gestures

| Gesture Name | Description | Servo Motion Steps |
| :--- | :--- | :--- |
| `WAVE` / `GREET_WAVE` | Enthusiastic arm wave with slight head nod | Arm lifts to 110°, oscillates between 110° and 150° twice, head tilts to 80°, returns to 10° |
| `NOD` / `NOD_YES` | Affirmative nod for confirmed actions | Head tilts 70° → 110° → 70° → 90° twice, arm stays at 10° |
| `SHAKE` / `SHAKE_NO` | Denial / negative response | Head pans 60° → 120° → 60° → 90° twice, arm stays at 10° |
| `IDLE` / `RESET_IDLE` | Safe neutral resting pose | Pan 90°, Tilt 90°, Arm 10° |
| `DIRECT_ANGLES` | Custom motor positioning | Pan `0–180°`, Tilt `45–135°`, Arm `0–160°` with smooth transit |

---

## 7. Security & Authentication Architecture

1. **Header-Based Authentication**:
   - Every request from the ESP32 includes `X-Robot-Device-Id: ESP32_RECEPTION_01` and `X-Robot-Api-Key: gym_robot_secret_key_12345`.
2. **Timing-Safe Comparison**:
   - The backend validates the hardware secret in constant time (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.
3. **No Frontend Exposure**:
   - The hardware secret key is configured exclusively in `backend/.env` and the ESP32 firmware source. It is never transmitted over WebSocket, stored in LocalStorage, or rendered in frontend HTML/JS.

---

## 8. Network Fail-Safe Behavior

If the local Wi-Fi router reboots, signal drops, or the Node.js backend restarts:
1. The firmware detects `WiFi.status() != WL_CONNECTED` or HTTP timeout.
2. The robot **immediately articulates all servos to the neutral `IDLE` resting position** (`Pan=90°, Tilt=90°, Arm=10°`).
3. The status LED blinks to signify connection seeking.
4. An exponential backoff reconnection loop retries without freezing or causing watchdog panics.
5. Once Wi-Fi reconnects, heartbeat telemetry resumes automatically.

---

## 9. Flashing Instructions (Arduino IDE)

### Prerequisites:
1. Install [Arduino IDE v2.x](https://www.arduino.cc/en/software).
2. Add ESP32 Board URL in **Preferences**:
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. Install **esp32 by Espressif Systems** via Board Manager.
4. Install Required Libraries via Library Manager:
   - `ESP32Servo` by Kevin Harrington / John K. Bennett
   - `ArduinoJson` (v6.21.x or v7.x) by Benoit Blanchon

### Flash Steps:
1. Open `firmware/esp32_fitbot.ino`.
2. Update `WIFI_SSID`, `WIFI_PASSWORD`, and `BACKEND_BASE_URL` with your gym network details.
3. Connect the ESP32 to your PC via micro-USB.
4. Select Board: **DOIT ESP32 DEVKIT V1** (or ESP32 Dev Module).
5. Select Port: **COMx** (Windows) or `/dev/ttyUSBx` (Linux/Mac).
6. Upload Speed: `921600` or `115200`.
7. Click **Upload**. If required by your board, hold the `BOOT` button until flashing starts.
8. Open Serial Monitor at **115200 baud** to view real-time diagnostics.

