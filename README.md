# 🤖 IronCore FitBot: Wi-Fi ESP32 AI Gym Receptionist Robot

A full-stack, embedded AI Receptionist Robot designed for gym front desks. Combines a Vanilla JavaScript/HTML5/CSS3 frontend, a secure Node.js & Express backend, PostgreSQL database, and an ESP32 DevKit V1 driving 3x SG90 micro-servos (Head Pan, Head Tilt, Arm Wave) with multilingual voice interaction in **English**, **Kannada (ಕನ್ನಡ)**, and **Hindi (हिन्दी)**.

---

## 🏗️ Architecture & Technology Stack

| Layer | Technologies Used |
| :--- | :--- |
| **Frontend** | HTML5, CSS3, Vanilla JavaScript (ES Modules, Web Speech API) |
| **Backend** | Node.js (v18+), Express (v4), ES Modules (`import`/`export`) |
| **Database** | PostgreSQL 14+ (Connection pool, Parameterized queries) |
| **Microcontroller** | ESP32 DevKit V1 (ESP-WROOM-32) |
| **Firmware** | Arduino C++ (`ESP32Servo`, `ArduinoJson`, `HTTPClient`) |
| **Actuators** | 3x TowerPro SG90 Micro Servos (Head Pan, Head Tilt, Right Arm Wave) |
| **AI Integration** | Google Gemini API (Service stub ready for API key) |
| **Voice Engine** | Multilingual STT & TTS (English `en-IN`, Kannada `kn-IN`, Hindi `hi-IN`) |

---

## 📁 Project Directory Structure Explained

```
gym-receptionist-robot/
├── backend/                   # Node.js Express Backend Service
│   └── src/
│       ├── server.js          # Server entry point & graceful shutdown
│       ├── app.js             # Express app setup, CORS, static files & routes
│       ├── config/
│       │   ├── env.js         # Environment configuration & validation
│       │   └── database.js    # PostgreSQL pool & parameterized query runner
│       ├── middlewares/
│       │   ├── apiKeyAuth.js   # Pre-shared header authentication for ESP32
│       │   └── errorHandler.js# Centralized API error handler
│       ├── routes/
│       │   ├── index.js       # Root router mounted at /api/v1 with health check
│       │   ├── robot.routes.js# Servo gesture triggers & ESP32 polling routes
│       │   ├── chat.routes.js # Conversational AI dialog & language routes
│       │   └── member.routes.js# Member check-in & lookup routes
│       ├── controllers/
│       │   ├── robot.controller.js  # Handlers for robot gestures & telemetry
│       │   ├── chat.controller.js   # Handlers for user speech & AI responses
│       │   └── member.controller.js # Handlers for check-in & verification
│       └── services/
│           ├── gemini.service.js    # Gemini AI integration stub & prompts
│           ├── voice.service.js     # Multilingual voice configs (EN, KN, HI)
│           ├── robot.service.js     # Servo queue & choreography engine
│           └── member.service.js    # Parameterized SQL database operations
│
├── frontend/                  # Zero-Dependency Web Kiosk & Dashboard
│   ├── index.html             # Receptionist Kiosk UI layout
│   ├── css/
│   │   └── styles.css         # Modern dark theme responsive styling
│   └── js/
│       ├── app.js             # Frontend controller & lifecycle coordinator
│       ├── services/
│       │   ├── api.js         # Fetch wrapper for /api/v1 endpoints
│       │   └── speech.js      # Web Speech API (STT & TTS) wrapper
│       └── components/
│           ├── robotStatus.js     # Live ESP32 connection & servo gauges
│           ├── voiceVisualizer.js # Animated listening/speaking audio wave
│           ├── chatInterface.js   # Conversation history & suggestion chips
│           └── memberCard.js      # Check-in card & recent check-ins table
│
├── database/                  # Database Schemas & Migrations
│   ├── schema.sql             # PostgreSQL tables (members, check-ins, logs)
│   ├── seed.sql               # Starter sample members and check-ins
│   └── README.md              # Database installation & management notes
│
├── esp32/                     # Microcontroller Firmware
│   ├── README.md              # Wiring instructions & library dependencies
│   └── gym_receptionist_firmware/
│       ├── gym_receptionist_firmware.ino # Main Arduino setup & loop
│       ├── config.h           # Wi-Fi credentials, backend URL, pinouts
│       ├── ServoController.h  # 3-servo class header
│       ├── ServoController.cpp# Smooth servo movement implementation
│       ├── NetworkManager.h   # Wi-Fi & HTTP client header
│       └── NetworkManager.cpp # Command polling & heartbeat reporting
│
├── documentation/             # Engineering Specs & Guides
│   ├── architecture.md        # System architecture diagram & flows
│   ├── hardware_schematic.md  # Detailed ESP32 & SG90 wiring schematic
│   └── api_reference.md       # Complete REST API documentation
│
├── tests/                     # Automated Test Suites
│   ├── unit/
│   │   ├── voice.service.test.js # Language normalization & speech configs
│   │   └── robot.service.test.js # Gesture validation & angle clamping
│   └── integration/
│       └── health.test.js     # API health, languages & chat tests
│
├── .env.example               # Environment variable template
├── .gitignore                 # Git ignore rules
├── package.json               # Project manifest, dependencies, scripts
└── README.md                  # Master setup & operation guide
```

---

## ⚡ Windows Quickstart & Setup Guide

### Step 1: Clone or Navigate to the Workspace
Open Windows PowerShell:
```powershell
cd C:\Users\user\Desktop\gym-receptionist-robot-starter
```

### Step 2: Install Node.js Dependencies
Ensure Node.js 18+ is installed (`node -v`). Then install dependencies:
```powershell
npm install
```

### Step 3: Configure Environment Variables
Copy the template to `.env`:
```powershell
Copy-Item .env.example .env
```
Open `.env` in any text editor and adjust your PostgreSQL credentials if applicable.

> **Development Mode Note**: If you don't have PostgreSQL installed right now, the backend will automatically use an internal mock database so you can start developing and testing immediately!

### Step 4 (Optional): Initialize PostgreSQL Database
If you have PostgreSQL installed:
```powershell
# Create database
psql -U postgres -c "CREATE DATABASE gym_robot_db;"

# Apply schema and initial seed data
psql -U postgres -d gym_robot_db -f database/schema.sql
psql -U postgres -d gym_robot_db -f database/seed.sql
```

### Step 5: Start the Backend Server
```powershell
npm start
```
Or for auto-reload during development:
```powershell
npm run dev
```

The server will display:
```
====================================================
🤖 Gym Receptionist Robot Backend Online
🌐 Local Web UI & API: http://localhost:3000
📡 Network Host:       http://0.0.0.0:3000
🩺 Health Endpoint:    http://localhost:3000/api/v1/health
====================================================
```

Open **`http://localhost:3000`** in your browser (Google Chrome is recommended for the Web Speech API).

---

## 🧪 Running Automated Tests
Run the built-in test suite:
```powershell
npm test
```

---

## 🔌 Hardware Setup (ESP32 DevKit V1 + 3x SG90 Servos)

### Hardware Connections
1. **Servo 1 (Head Pan / Yaw)**: Signal -> **GPIO 18**
2. **Servo 2 (Head Tilt / Pitch)**: Signal -> **GPIO 19**
3. **Servo 3 (Right Arm Wave)**: Signal -> **GPIO 21**
4. **Power**: Connect all 3 Red (+) servo wires to an **External 5V 2A Power Supply**.
5. **Common Ground**: Tie all Brown/Black (-) servo wires, the Power Supply GND, and the ESP32 GND together.

### Flash Firmware to ESP32
1. Install [Arduino IDE 2.x](https://www.arduino.cc/en/software).
2. Install the **ESP32** board package in Arduino IDE.
3. Install libraries: `ESP32Servo` and `ArduinoJson` via Library Manager.
4. Open `esp32/gym_receptionist_firmware/gym_receptionist_firmware.ino`.
5. In `config.h`, update:
   - `WIFI_SSID` and `WIFI_PASSWORD`
   - `BACKEND_BASE_URL` with your computer's local IP (e.g. `http://192.168.1.100:3000/api/v1`).
6. Select Board **DOIT ESP32 DEVKIT V1**, select your COM port, and click **Upload**.

---

## 🗣️ Multi-Language Voice Features

FitBot provides native support for 3 languages:
1. **English (`en-IN`)**: Full speech recognition, TTS greetings, and answers.
2. **Kannada (`kn-IN`)**: Localized greetings (e.g., *ನಮಸ್ಕಾರ! ನಮ್ಮ ಜಿಮ್‌ಗೆ ಸ್ವಾಗತ!*).
3. **Hindi (`hi-IN`)**: Localized greetings (e.g., *नमस्ते! आयरनकोर फिटनेस में आपका स्वागत है!*).

Click the language buttons on the top right of the Web UI to toggle languages on the fly.

---

## 🧠 Future Gemini AI Integration

To activate live generative answers from Google Gemini:
1. Obtain an API key from [Google AI Studio](https://aistudio.google.com/).
2. Add your key to `.env`:
   ```env
   GEMINI_API_KEY=AIzaSy...
   GEMINI_MODEL=gemini-1.5-flash
   ```
3. The hook in `backend/src/services/gemini.service.js` is pre-structured with the gym receptionist persona and will immediately utilize your Gemini key!

