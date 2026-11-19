# 🤝 Client Handover Guide: Virtex Gym Receptionist Robot

This guide explains how to hand over the complete gym receptionist robot system to the **Gym Owner** so that **all billing, API keys, database credentials, and admin accounts belong entirely to the gym owner**, not the developer.

---

## 🎯 Separation of Ownership

| Component | Owner / Account | Why It Must Belong to the Gym Owner |
| :--- | :--- | :--- |
| **Google Gemini API Key** | **Gym Owner's Google Account** | AI question-answering quota and any API billing is tied to the gym owner's card, not yours. |
| **PostgreSQL Database** | **Gym Owner's Local PC / Server** | Member privacy, check-in records, and trainer phone numbers stay solely on the gym's computer. |
| **Admin Web Console (`/admin`)** | **Gym Owner's Superadmin Login** | Gym managers can update membership fees, add trainers, and post notices without needing the developer. |
| **ESP32 Robot Hardware Key** | **Gym's Local `.env` & Firmware** | Dedicated pre-shared secret ensures only the gym's physical robot can execute motor commands. |

---

## 📋 Step-by-Step Delivery Checklist

### Step 1: Create the Gym Owner's Google Gemini API Key

> [!IMPORTANT]
> The gym owner must perform this step using **their own gym Google account** (e.g. `virtexgym@gmail.com`).

1. Ask the gym owner to open a browser and visit: **[https://aistudio.google.com/](https://aistudio.google.com/)**
2. Sign in with the **Gym's official Google Account**.
3. Click on the blue button: **"Get API key"** (or **"Create API key"**).
4. Select **"Create API key in new project"** and name the project `Virtex-Receptionist-AI`.
5. Copy the generated API key (it starts with `AIzaSy...`).
6. Paste this key into the gym's production `.env` file:
   ```env
   GEMINI_API_KEY=AIzaSyYourGymOwnersSecretKeyHere
   ```
*Free tier covers standard gym receptionist query volumes; if upgraded to pay-as-you-go, billing is charged directly to the gym owner.*

---

### Step 2: Configure the Gym's Local Database Credentials

On the computer running at the gym reception desk:
1. Open PowerShell and install or verify PostgreSQL 18:
   ```powershell
   psql -U postgres
   ```
2. Set a strong password known only to the gym owner/IT administrator:
   ```sql
   ALTER USER postgres WITH PASSWORD 'GymOwner_Secret2026!';
   ```
3. Create the gym database:
   ```sql
   CREATE DATABASE gym_robot_db;
   \q
   ```
4. Run the schema and seed files:
   ```powershell
   psql -U postgres -d gym_robot_db -f database\schema.sql
   psql -U postgres -d gym_robot_db -f database\admin_schema.sql
   psql -U postgres -d gym_robot_db -f database\seed.sql
   ```

---

### Step 3: Set Up the Gym Owner's `.env` File

Copy `.env.example` to `.env` on the delivery computer:
```powershell
Copy-Item .env.example .env
```

Open `.env` and fill in the gym owner's details:

```env
# Server Settings
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Generate a unique random JWT secret for the gym owner's sessions
JWT_SECRET=gym_jwt_random_secret_string_change_this_987654321
JWT_EXPIRES_IN=8h

# Robot Hardware Authentication (Unique to this gym)
ROBOT_DEVICE_UUID=ESP32_RECEPTION_01
ROBOT_API_KEY=gym_specific_secret_key_778899

# Gym's PostgreSQL Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gym_robot_db
DB_USER=postgres
DB_PASSWORD=GymOwner_Secret2026!

# Gym Owner's Gemini API Key (From Step 1)
GEMINI_API_KEY=AIzaSyGymOwnersActualKeyHere
GEMINI_MODEL=gemini-1.5-flash
GEMINI_TIMEOUT_MS=8000

# Language settings
DEFAULT_LANGUAGE=en-IN
SUPPORTED_LANGUAGES=en-IN,kn-IN,hi-IN
```

---

### Step 4: Flash the Physical ESP32 Robot for the Gym's Wi-Fi

Before handing over the robot base, program the gym's Wi-Fi and device key into `esp32/gym_receptionist_firmware/config.h`:

```cpp
// Wi-Fi Credentials for the Gym's Network
#define WIFI_SSID           "Virtex_Reception_WiFi"
#define WIFI_PASSWORD       "GymWifiPassword123"

// The LAN IP address of the gym's computer running Node.js
#define BACKEND_BASE_URL    "http://192.168.1.100:3000/api/v1"

// Matching device credentials from Step 3:
#define ROBOT_DEVICE_UUID   "ESP32_RECEPTION_01"
#define ROBOT_API_KEY       "gym_specific_secret_key_778899"
```

Upload the sketch via Arduino IDE. Once uploaded, the ESP32 will automatically connect to the gym's Wi-Fi whenever powered on.

---

### Step 5: Create the Gym Owner's First Admin Account

Create an initial `superadmin` login in PostgreSQL for the gym owner:

```powershell
psql -U postgres -d gym_robot_db
```

```sql
-- Insert the Gym Owner's superadmin account (password is hashed using pgcrypto):
INSERT INTO admin_users (username, email, password_hash, full_name, role, is_active)
VALUES (
  'gymowner',
  'owner@virtexgym.com',
  crypt('OwnerInitialPass2026!', gen_salt('bf', 10)),
  'Gym General Manager',
  'superadmin',
  true
);
\q
```

---

### Step 6: Handover Verification

1. Start the backend:
   ```powershell
   npm start
   ```
2. Have the gym owner open a browser to:
   - **Kiosk UI:** `http://localhost:3000/`
   - **Admin Console:** `http://localhost:3000/admin`
3. Have the gym owner log into `/admin` using their new credentials (`gymowner` / `OwnerInitialPass2026!`).
4. Turn on the ESP32 robot and confirm the status pill at the top right turns **🟢 ESP32 Online**.
5. Test asking a voice question at the kiosk (e.g. *"What are your opening hours?"*) to confirm their Gemini key is working.

---

### 🛡️ Post-Delivery Developer Removal

Once the system is tested and running:
1. Delete any personal developer `.env` files or test keys from the machine.
2. Confirm the gym owner has changed their PostgreSQL password and admin password.
3. Hand over the physical robot and power adapter.
4. Your personal accounts and cards are now 100% disconnected from the gym's ongoing usage.

