# 🐘 PostgreSQL Database Architecture: Virtex AI Gym Receptionist Robot

This directory contains the complete database schema, security rules, seed records, and example production SQL queries for the Gym Receptionist Robot.

---

## 🏗️ Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    gym_settings {
        smallint id PK "Singleton (id=1)"
        varchar gym_name
        varchar phone
        varchar email
        text address
        jsonb operating_hours
        varchar default_language
        text_array supported_languages
        numeric speech_rate
        numeric speech_pitch
    }

    admin_users {
        serial id PK
        varchar username UK
        varchar email UK
        varchar password_hash "Never plaintext (bcrypt)"
        varchar full_name
        varchar role "superadmin | manager | trainer"
        boolean is_active
        timestamptz last_login_at
    }

    membership_plans {
        serial id PK
        varchar plan_code UK
        varchar name
        smallint duration_months
        numeric price_inr
        varchar badge_label
        boolean is_featured
        boolean is_active
        text_array perks
    }

    trainers {
        serial id PK
        varchar trainer_code UK
        integer user_id FK
        varchar full_name
        varchar specialty
        varchar phone UK
        varchar email UK
        text bio
        text_array certifications
        varchar status "on_floor | in_session | off_duty"
    }

    trainer_schedules {
        serial id PK
        integer trainer_id FK
        smallint day_of_week "0=Sun, 1=Mon...6=Sat"
        time shift_start
        time shift_end
        boolean is_available
        varchar notes
    }

    faqs {
        serial id PK
        text question
        text answer
        varchar language "en-IN | kn-IN | hi-IN"
        varchar category
        varchar suggested_gesture
        text_array keywords
        smallint display_order
        boolean is_active
    }

    announcements {
        serial id PK
        varchar title
        text message
        varchar priority "normal | urgent | event | maintenance"
        varchar target_language
        date start_date
        date end_date
        boolean is_active
    }

    robot_devices {
        serial id PK
        varchar device_uuid UK "e.g. ESP32_RECEPTION_01"
        varchar device_name
        varchar mac_address UK
        varchar ip_address
        varchar api_key_hash "Hashed pre-shared secret"
        varchar status "online | offline | error"
        varchar firmware_version
        smallint head_pan_pin "GPIO 18"
        smallint head_tilt_pin "GPIO 19"
        smallint arm_wave_pin "GPIO 21"
        timestamptz last_heartbeat
    }

    robot_command_logs {
        bigserial id PK
        integer device_id FK
        varchar command_type "GESTURE | DIRECT_ANGLES"
        varchar gesture_name
        jsonb servo_payload
        varchar status "pending | delivered | executed | failed"
        varchar triggered_by
        integer execution_time_ms
        timestamptz created_at
    }

    members {
        serial id PK
        varchar member_code UK
        varchar full_name
        varchar phone UK
        varchar email UK
        integer plan_id FK
        varchar status "active | inactive | expired"
        varchar preferred_language
    }

    check_ins {
        bigserial id PK
        integer member_id FK
        timestamptz check_in_time
        varchar check_in_method "kiosk_voice | kiosk_manual"
    }

    interaction_logs {
        bigserial id PK
        integer member_id FK
        integer device_id FK
        text user_query
        text robot_response
        varchar language
        varchar input_method
        varchar intent_detected
        bigint gesture_command_id FK
        integer latency_ms
        timestamptz created_at
    }

    admin_users ||--o| trainers : "links login"
    trainers ||--o{ trainer_schedules : "has shifts"
    membership_plans ||--o{ members : "enrolled in"
    members ||--o{ check_ins : "records visit"
    robot_devices ||--o{ robot_command_logs : "executes"
    robot_devices ||--o{ interaction_logs : "processes"
    members ||--o{ interaction_logs : "speaks to"
    robot_command_logs ||--o| interaction_logs : "triggers motor"
```

---

## ⚡ Windows Quickstart Commands

### Step 1: Ensure `psql` is in your Windows PATH
If `psql` is not recognized, run this in PowerShell to locate PostgreSQL 18:
```powershell
# Temporarily add PostgreSQL 18 bin to current session:
$env:Path += ";C:\Program Files\PostgreSQL\18\bin"

# Verify psql
psql --version
```

### Step 2: Create the Database
```powershell
# Connect as postgres user and create the database
psql -U postgres -c "CREATE DATABASE gym_robot_db;"
```

### Step 3: Apply the Schema
```powershell
cd C:\Users\user\Desktop\gym-receptionist-robot-starter
psql -U postgres -d gym_robot_db -f database/schema.sql
```

### Step 4: Populate Development Seed Data
```powershell
psql -U postgres -d gym_robot_db -f database/seed.sql
```

### Step 5: Test Example Queries
```powershell
psql -U postgres -d gym_robot_db -f database/queries.sql
```

---

## 🔐 Security Architecture: Strictly No Plaintext Passwords

This database enforces strong credential hashing via PostgreSQL's native **`pgcrypto`** extension:

1. **Password Storage**: Passwords are saved into `admin_users.password_hash` using salted Blowfish (bcrypt):
   ```sql
   crypt('AdminPassword123!', gen_salt('bf', 10))
   ```
2. **Password Verification**: Authentication is evaluated cryptographically in SQL without ever decrypting or storing plaintext:
   ```sql
   SELECT id, username, role 
   FROM admin_users 
   WHERE username = 'admin' 
     AND password_hash = crypt('UserSuppliedPassword', password_hash);
   ```
3. **ESP32 API Key Storage**: The pre-shared robot secret key (`gym_robot_secret_key_12345`) in `robot_devices.api_key_hash` is also salted and hashed, protecting against token leaks if a database backup is compromised.
