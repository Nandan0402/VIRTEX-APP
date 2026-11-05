# REST API Reference: Gym Receptionist Robot

Base URL: `http://localhost:3000/api/v1`

---

## 1. System Health
### `GET /health`
Returns the status of the server and PostgreSQL database link.

**Response (200 OK):**
```json
{
  "status": "online",
  "timestamp": "2026-11-04T15:30:00.000Z",
  "uptimeSeconds": 142.5,
  "database": "connected"
}
```

---

## 2. Robot Control & ESP32 Microcontroller Endpoints

### `GET /robot/status`
Fetches current robot state, connection status, and servo angles.

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "online": true,
    "ipAddress": "192.168.1.150",
    "lastHeartbeat": "2026-11-04T15:29:50.000Z",
    "servos": {
      "headPan": 90,
      "headTilt": 90,
      "armWave": 10
    },
    "currentGesture": "GREET_WAVE",
    "queuedCommandsCount": 0
  }
}
```

### `POST /robot/gesture`
Queues a pre-choreographed multi-step servo routine.

**Request Body:**
```json
{
  "gesture": "GREET_WAVE"
}
```
*Available gestures: `GREET_WAVE`, `NOD_YES`, `SHAKE_NO`, `LOOK_LEFT`, `LOOK_RIGHT`, `RESET_IDLE`*

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Gesture GREET_WAVE queued successfully",
  "command": {
    "id": "cmd_1730734200_a81f3",
    "type": "GESTURE",
    "gesture": "GREET_WAVE",
    "steps": [ ... ]
  }
}
```

### `POST /robot/servos`
Direct manual angle positioning for custom movements.

**Request Body:**
```json
{
  "headPan": 120,
  "headTilt": 85,
  "armWave": 45
}
```

### `GET /robot/commands/next` *(Protected)*
**Headers:** `x-robot-api-key: <ROBOT_API_KEY>`  
Polled periodically by the ESP32 to retrieve the next pending servo movement command.

**Response (200 OK):**
```json
{
  "success": true,
  "command": {
    "id": "cmd_1730734200_a81f3",
    "type": "GESTURE",
    "steps": [
      { "headPan": 90, "headTilt": 80, "armWave": 110, "delayMs": 250 },
      { "headPan": 90, "headTilt": 90, "armWave": 10, "delayMs": 300 }
    ]
  }
}
```
*Returns `204 No Content` when no commands are pending in queue.*

### `POST /robot/heartbeat` *(Protected)*
**Headers:** `x-robot-api-key: <ROBOT_API_KEY>`  
Sent periodically by the ESP32 to report network IP and current servo positions.

---

## 3. Conversational AI & Localization Endpoints

### `POST /chat/message`
Processes member speech transcript or typed query.

**Request Body:**
```json
{
  "message": "What are your gym timings?",
  "language": "en-IN"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "reply": "We are open Monday through Saturday from 6:00 AM to 10:00 PM, and Sundays from 7:00 AM to 1:00 PM.",
    "gesture": "NOD_YES",
    "language": "en-IN",
    "voiceMeta": {
      "bcp47": "en-IN",
      "speechRate": 1.0,
      "pitch": 1.0
    }
  }
}
```

### `GET /chat/languages`
Lists supported receptionist languages (English, Kannada, Hindi).

---

## 4. Gym Member Check-In & Management

### `POST /members/check-in`
Verifies member by Member Code or Phone number, records the check-in timestamp in PostgreSQL, and queues a welcome wave on the robot.

**Request Body:**
```json
{
  "identifier": "GYM001",
  "language": "kn-IN"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Check-in successful!",
  "data": {
    "member": {
      "id": 1,
      "member_code": "GYM001",
      "full_name": "Rahul Sharma",
      "plan_name": "Annual Premium",
      "status": "active"
    },
    "checkIn": {
      "id": 14,
      "member_id": 1,
      "check_in_time": "2026-11-04T15:32:00.000Z"
    },
    "welcomeSpeech": "ಸ್ವಾಗತ Rahul Sharma! ನಿಮ್ಮ ಇಂದಿನ ತರಬೇತಿ ಫಲಪ್ರದವಾಗಲಿ!",
    "gesture": "GREET_WAVE"
  }
}
```

### `GET /members/recent-checkins?limit=10`
Returns recent member check-ins for reception dashboard display.

