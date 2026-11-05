# Hardware Schematic & Wiring Guide: ESP32 DevKit V1 & 3x SG90 Servos

This document provides embedded systems specifications for wiring the **ESP32 DevKit V1** to the **3x SG90 micro-servos**.

---

## ⚠️ Critical Embedded Engineering Notice (Power Safety)

> **DO NOT power the SG90 servos from the ESP32 3.3V pin or directly from the ESP32 VIN pin via USB!**
> 
> - Each SG90 micro-servo can draw **up to 500mA - 650mA when stalling or starting motion**.
> - Three servos moving simultaneously can draw **1.5A to 1.8A peak current**.
> - Powering them directly from the ESP32 board causes severe voltage dips, triggering the ESP32 internal brown-out detector and causing infinite restart loops.
> - **Requirement**: Use an external **5V 2A DC power supply** (e.g., 5V/2A wall adapter or regulated buck converter).
> - **COMMON GROUND (MANDATORY)**: Connect the **Negative (-) GND** of the external 5V power supply to one of the **GND pins** on the ESP32. Without a shared common ground, PWM control signals will float and servos will jitter erratically.

---

## Pinout Map

| Component | SG90 Wire Color | Connects To | Pin Type | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Servo 1 (Head Pan)** | Brown / Black | External Supply GND & ESP32 GND | Power (-) | Common Ground |
| | Red | External Supply 5V (+) | Power (+) | Regulated 5V |
| | Orange / Yellow | **ESP32 GPIO 18** | Output (PWM) | 50 Hz PWM Signal |
| **Servo 2 (Head Tilt)**| Brown / Black | External Supply GND & ESP32 GND | Power (-) | Common Ground |
| | Red | External Supply 5V (+) | Power (+) | Regulated 5V |
| | Orange / Yellow | **ESP32 GPIO 19** | Output (PWM) | 50 Hz PWM Signal |
| **Servo 3 (Arm Wave)** | Brown / Black | External Supply GND & ESP32 GND | Power (-) | Common Ground |
| | Red | External Supply 5V (+) | Power (+) | Regulated 5V |
| | Orange / Yellow | **ESP32 GPIO 21** | Output (PWM) | 50 Hz PWM Signal |
| **Status LED** | Onboard | **ESP32 GPIO 2** | Built-in | Blinks on Wi-Fi connect, Solid when ready |

---

## Wiring Diagram

```
       +---------------------------------------------+
       |         External 5V 2A DC Power Supply      |
       +---------------------------------------------+
              | (+) 5V                    | (-) GND
              |                           |
              |                           +-----------------------+
              |                                                   |
              |===========================================+       |
              |                     |                     |       |
              | (Red)               | (Red)               | (Red) |
       +---------------+     +---------------+     +---------------+
       | SG90 Servo #1 |     | SG90 Servo #2 |     | SG90 Servo #3 |
       |  (Head Pan)   |     |  (Head Tilt)  |     |  (Arm Wave)   |
       +---------------+     +---------------+     +---------------+
          | (Brown)             | (Brown)             | (Brown)   |
          +----------+----------+----------+----------+-----------+
                     |                     |
                     |                     | Common GND
                     |           +-----------------------+
                     |           |                       |
                     |           |    ESP32 DevKit V1    |
                     |           |                       |
                     +-----------+--> GND                |
                                 |                       |
          (Orange) Signal        |                       |
          +----------------------+--> GPIO 18            |
                                 |                       |
          (Orange) Signal        |                       |
          +----------------------+--> GPIO 19            |
                                 |                       |
          (Orange) Signal        |                       |
          +----------------------+--> GPIO 21            |
                                 +-----------------------+
```

---

## Pro-Tips for Mechanical & Electrical Assembly

1. **Decoupling Capacitor**:
   - Place a **100µF to 470µF electrolytic capacitor** (rated 10V or higher) across the +5V and GND rails right near the servos. This absorbs inductive current spikes when servos reverse direction.
2. **Servo Horn Calibration**:
   - Before screwing the mechanical robot head or arm horns onto the servo splines, power up the ESP32 and run the initial setup routine. This brings all 3 servos to their software neutral angles (Pan 90°, Tilt 90°, Arm 10°). Then press-fit the mechanical horns at their physical centers.
3. **Wire Gauge**:
   - Use minimum 24 AWG or 22 AWG hookup wire for the +5V and GND power rails to minimize resistance and voltage drops.

