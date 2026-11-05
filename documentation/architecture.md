# System Architecture: Wi-Fi ESP32 AI Gym Receptionist Robot

## High-Level System Architecture

```mermaid
flowchart TD
    subgraph ClientLayer["Frontend Kiosk / Tablet / Browser"]
        UI["Vanilla JS + HTML5 UI"]
        STT["Web Speech API (STT)<br/>EN / KN / HI"]
        TTS["Web Speech API (TTS)<br/>EN / KN / HI"]
    end

    subgraph BackendLayer["Node.js & Express Backend"]
        Router["Express Router (/api/v1)"]
        ChatCtrl["Chat Controller"]
        RobotCtrl["Robot Controller"]
        MemberCtrl["Member Controller"]
        GeminiSvc["Gemini AI Service<br/>(FitBot Persona)"]
        VoiceSvc["Voice & Localization Service"]
        RobotSvc["Robot Choreography Service"]
        MemberSvc["Member Service (Parameterized SQL)"]
    end

    subgraph DataLayer["Persistence"]
        Postgres[(PostgreSQL 14+<br/>gym_robot_db)]
    end

    subgraph HardwareLayer["Embedded IoT Layer"]
        ESP32["ESP32 DevKit V1<br/>(Arduino C++)"]
        Servo1["SG90 #1: Head Pan (GPIO 18)"]
        Servo2["SG90 #2: Head Tilt (GPIO 19)"]
        Servo3["SG90 #3: Arm Wave (GPIO 21)"]
        Power["External 5V 2A DC Supply"]
    end

    UI -->|REST / JSON| Router
    STT --> UI
    UI --> TTS

    Router --> ChatCtrl
    Router --> RobotCtrl
    Router --> MemberCtrl

    ChatCtrl --> GeminiSvc
    ChatCtrl --> VoiceSvc
    ChatCtrl --> RobotSvc

    MemberCtrl --> MemberSvc
    MemberCtrl --> RobotSvc
    MemberSvc --> Postgres

    ESP32 -->|Wi-Fi HTTP Polling<br/>x-robot-api-key| Router
    ESP32 -->|PWM Signals| Servo1
    ESP32 -->|PWM Signals| Servo2
    ESP32 -->|PWM Signals| Servo3
    Power -->|5V + Common GND| ESP32
    Power -->|5V + Common GND| Servo1
    Power -->|5V + Common GND| Servo2
    Power -->|5V + Common GND| Servo3
```

## Core Subsystems

### 1. Embedded Hardware Subsystem (ESP32)
- **Controller**: DOIT ESP32 DevKit V1 running an asynchronous-friendly Arduino C++ firmware loop.
- **Actuators**: 3x SG90 micro servos handling Head Pan (Yaw), Head Tilt (Pitch), and Right Arm (Greeting Wave).
- **Network Link**: Dedicated 2.4 GHz 802.11 b/g/n Wi-Fi with automatic reconnection logic.
- **Communication Protocol**: HTTP polling of pending queued motion steps with an authorization header (`x-robot-api-key`) and periodic heartbeat reporting.

### 2. Backend Orchestration Layer (Node.js & Express)
- **Modular ES Modules**: Clean separation of Routes, Controllers, Services, Middlewares, and Configuration.
- **Security**: Pre-shared API Key header validation for IoT endpoints; parameterized queries for database protection.
- **Robot Choreography Engine**: Maintains queued gestures (`GREET_WAVE`, `NOD_YES`, `SHAKE_NO`, etc.) with angle limits to protect SG90 gears.
- **Multi-Language Support**: Handles English (`en-IN`), Kannada (`kn-IN`), and Hindi (`hi-IN`).

### 3. Database Layer (PostgreSQL)
- Relational schema modeling gym members, visit check-ins, robot movement telemetry logs, and conversational dialogue audit logs.
- Automatic failover to an in-memory mock store if PostgreSQL is temporarily unavailable during initial local frontend/firmware development.

### 4. Frontend Receptionist Interface
- Zero-dependency Vanilla JavaScript (ES modules), HTML5, and CSS3.
- Integrated Web Speech API for bi-directional voice conversation.
- Live hardware telemetry panel showing ESP32 IP and servo angle meters.

