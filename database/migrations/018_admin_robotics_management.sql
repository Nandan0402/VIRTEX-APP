-- Migration 018: Admin Robotics Management Expansion
-- Expands existing FitBot AI and ESP32 integration with device registration, health monitoring,
-- battery monitoring, Wi-Fi RSSI monitoring, ultrasonic/PIR/thermal sensor telemetry,
-- robot activity logs, hardware event logs, connection alerts, analytics, maintenance history,
-- and safety monitoring while strictly preserving all existing ESP32/WebSocket/servo/RFID endpoints.

-- 1. Ensure robot_devices has all telemetry columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'robot_devices' AND column_name = 'battery_voltage') THEN
    ALTER TABLE robot_devices ADD COLUMN battery_voltage NUMERIC(4,2) DEFAULT 8.40;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'robot_devices' AND column_name = 'charging_status') THEN
    ALTER TABLE robot_devices ADD COLUMN charging_status VARCHAR(30) DEFAULT 'discharging'; -- 'charging', 'discharging', 'full'
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'robot_devices' AND column_name = 'location_zone') THEN
    ALTER TABLE robot_devices ADD COLUMN location_zone VARCHAR(100) DEFAULT 'Front Desk Kiosk';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'robot_devices' AND column_name = 'device_model') THEN
    ALTER TABLE robot_devices ADD COLUMN device_model VARCHAR(100) DEFAULT 'FitBot Receptionist MK-II';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'robot_devices' AND column_name = 'serial_number') THEN
    ALTER TABLE robot_devices ADD COLUMN serial_number VARCHAR(100) DEFAULT 'FB-ESP32-8821';
  END IF;
END $$;

-- 2. Sensor Monitoring & Telemetry
CREATE TABLE IF NOT EXISTS robot_sensor_telemetry (
  id BIGSERIAL PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES robot_devices(id) ON DELETE CASCADE,
  sensor_type VARCHAR(50) NOT NULL, -- 'Ultrasonic Distance', 'PIR Motion', 'Servo Head Temperature', 'RFID Reader RC522', 'Ambient Light LUX', 'IMU Tilt Angle'
  sensor_name VARCHAR(100) NOT NULL,
  reading_value NUMERIC(10,2) NOT NULL,
  unit VARCHAR(20) NOT NULL, -- 'cm', 'deg_C', 'state', 'lux', 'degrees'
  threshold_min NUMERIC(10,2),
  threshold_max NUMERIC(10,2),
  status VARCHAR(20) NOT NULL DEFAULT 'normal', -- 'normal', 'warning', 'critical'
  recorded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sensor_telemetry_dev ON robot_sensor_telemetry(device_id);
CREATE INDEX IF NOT EXISTS idx_sensor_telemetry_type ON robot_sensor_telemetry(sensor_type);
CREATE INDEX IF NOT EXISTS idx_sensor_telemetry_date ON robot_sensor_telemetry(recorded_at);

-- 3. Device Connection & Operational Alerts
CREATE TABLE IF NOT EXISTS robot_device_alerts (
  id SERIAL PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES robot_devices(id) ON DELETE CASCADE,
  alert_type VARCHAR(50) NOT NULL, -- 'connection_lost', 'low_battery', 'weak_wifi', 'sensor_fault', 'safety_e_stop', 'high_temperature', 'servo_stall'
  severity VARCHAR(20) NOT NULL DEFAULT 'medium', -- 'info', 'warning', 'critical', 'emergency'
  message TEXT NOT NULL,
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_by VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_robot_alerts_dev ON robot_device_alerts(device_id);
CREATE INDEX IF NOT EXISTS idx_robot_alerts_severity ON robot_device_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_robot_alerts_resolved ON robot_device_alerts(is_resolved);

-- 4. Device Maintenance History
CREATE TABLE IF NOT EXISTS robot_device_maintenance (
  id SERIAL PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES robot_devices(id) ON DELETE CASCADE,
  maintenance_type VARCHAR(100) NOT NULL, -- 'Servo Gear Inspection & Grease', 'Firmware Flash & OTA Upgrade', 'Battery Pack Cell Balancing', 'Ultrasonic Transducer Calibration', 'Emergency Stop Button Recalibration', 'Wiring Harness Stress Check'
  scheduled_date DATE NOT NULL,
  completed_date DATE,
  technician_name VARCHAR(100) NOT NULL,
  cost NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  status VARCHAR(30) NOT NULL DEFAULT 'scheduled', -- 'scheduled', 'in_progress', 'completed'
  work_summary TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_robot_maint_dev ON robot_device_maintenance(device_id);

-- 5. Safety Monitoring & Safeguard Events
CREATE TABLE IF NOT EXISTS robot_safety_monitoring (
  id SERIAL PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES robot_devices(id) ON DELETE CASCADE,
  safety_event_type VARCHAR(100) NOT NULL, -- 'Obstacle Proximity Threshold (< 25cm)', 'Servo Torque Limit Reached', 'Human Interaction Collision Avoidance', 'Emergency Stop Latched', 'Thermal Throttle Safeguard'
  severity VARCHAR(20) NOT NULL DEFAULT 'warning', -- 'info', 'warning', 'critical'
  safety_action_taken VARCHAR(100) NOT NULL, -- 'Halt Servo Sweep', 'Slow Down Speed by 50%', 'Autonomous Re-center to Neutral 90 deg', 'Audible Voice Warning Issued', 'System Lockout'
  zone_location VARCHAR(100) DEFAULT 'Reception Kiosk Zone',
  notes TEXT,
  occurred_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_robot_safety_dev ON robot_safety_monitoring(device_id);
CREATE INDEX IF NOT EXISTS idx_robot_safety_date ON robot_safety_monitoring(occurred_at);

-- Seed Additional Robot Devices and Comprehensive Telemetry
DO $$
DECLARE
  v_dev_reception INTEGER;
  v_dev_roaming INTEGER;
BEGIN
  -- 1. Update Existing Reception FitBot
  SELECT id INTO v_dev_reception FROM robot_devices WHERE device_uuid = 'ESP32_RECEPTION_01' LIMIT 1;
  IF v_dev_reception IS NOT NULL THEN
    UPDATE robot_devices
    SET 
      battery_level = 88,
      battery_voltage = 8.15,
      charging_status = 'discharging',
      wifi_rssi = -54, -- Excellent signal (-54 dBm)
      status = 'online',
      location_zone = 'Main Reception Desk Kiosk',
      last_heartbeat = CURRENT_TIMESTAMP
    WHERE id = v_dev_reception;
  ELSE
    INSERT INTO robot_devices (
      device_uuid, device_name, mac_address, ip_address, status, firmware_version,
      head_pan_pin, head_tilt_pin, arm_wave_pin, battery_level, battery_voltage,
      charging_status, wifi_rssi, is_enabled, location_zone, last_heartbeat
    )
    VALUES (
      'ESP32_RECEPTION_01', 'FitBot Receptionist Station', '24:6F:28:B1:C4:80', '192.168.1.155',
      'online', '1.2.0', 18, 19, 21, 88, 8.15, 'discharging', -54, true,
      'Main Reception Desk Kiosk', CURRENT_TIMESTAMP
    )
    RETURNING id INTO v_dev_reception;
  END IF;

  -- 2. Seed a Secondary Rover Robot Device
  INSERT INTO robot_devices (
    device_uuid, device_name, mac_address, ip_address, api_key_hash, status, firmware_version,
    head_pan_pin, head_tilt_pin, arm_wave_pin, battery_level, battery_voltage,
    charging_status, wifi_rssi, is_enabled, location_zone, last_heartbeat
  )
  VALUES (
    'ESP32_FLOOR_ROVER_02', 'FitBot Floor Patrol & Hydration Rover', '24:6F:28:C2:E5:91', '192.168.1.158',
    '$2a$08$jQSRB5bleCplfslKB86B9.O.9gKfwT5G2Jy2g37g0lGFO40WQy0U.',
    'online', '1.2.4', 12, 13, 14, 74, 7.85, 'charging', -62, true,
    'Gym Arena Main Floor', CURRENT_TIMESTAMP - INTERVAL '3 minutes'
  )
  ON CONFLICT (device_uuid) DO UPDATE SET
    battery_level = 74,
    wifi_rssi = -62,
    status = 'online'
  RETURNING id INTO v_dev_roaming;

  -- 3. Seed Sensor Telemetry for Reception Unit
  INSERT INTO robot_sensor_telemetry (device_id, sensor_type, sensor_name, reading_value, unit, threshold_min, threshold_max, status, recorded_at)
  VALUES 
    (v_dev_reception, 'Ultrasonic Distance', 'HC-SR04 Proximity Sensor (Front Chest)', 68.50, 'cm', 25.00, 300.00, 'normal', CURRENT_TIMESTAMP - INTERVAL '2 minutes'),
    (v_dev_reception, 'PIR Motion', 'HC-SR501 Passive Infrared Motion Detector', 1.00, 'state', 0.00, 1.00, 'normal', CURRENT_TIMESTAMP - INTERVAL '2 minutes'),
    (v_dev_reception, 'Servo Head Temperature', 'MG996R Head Pan Thermal Probe', 38.20, 'deg_C', 10.00, 65.00, 'normal', CURRENT_TIMESTAMP - INTERVAL '5 minutes'),
    (v_dev_reception, 'RFID Reader RC522', 'MFRC522 Smart Card Scanner (Antenna Coil)', 13.56, 'MHz', 13.00, 14.00, 'normal', CURRENT_TIMESTAMP - INTERVAL '10 minutes'),
    (v_dev_reception, 'Ambient Light LUX', 'BH1750 Digital Illuminance Sensor', 480.00, 'lux', 100.00, 1200.00, 'normal', CURRENT_TIMESTAMP - INTERVAL '15 minutes');

  -- 4. Seed Alerts
  INSERT INTO robot_device_alerts (device_id, alert_type, severity, message, is_resolved, created_at)
  VALUES 
    (v_dev_reception, 'weak_wifi', 'warning', 'Wi-Fi RSSI dropped to -78 dBm momentarily during peak visitor influx.', true, CURRENT_TIMESTAMP - INTERVAL '1 day'),
    (v_dev_reception, 'high_temperature', 'warning', 'Servo Head Pan temperature reached 58.4°C during high-frequency greeting cycle.', false, CURRENT_TIMESTAMP - INTERVAL '4 hours');

  -- 5. Seed Maintenance History
  INSERT INTO robot_device_maintenance (device_id, maintenance_type, scheduled_date, completed_date, technician_name, cost, status, work_summary)
  VALUES 
    (v_dev_reception, 'Servo Gear Inspection & Grease', CURRENT_DATE - INTERVAL '15 days', CURRENT_DATE - INTERVAL '15 days', 'Deepak Verma (Robotics Lead)', 1500.00, 'completed', 'Inspected metal gear meshes on MG996R servos, applied white lithium grease, calibrated 90-degree center trim.'),
    (v_dev_reception, 'Firmware Flash & OTA Upgrade v1.2.0', CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE - INTERVAL '5 days', 'Antigravity Embedded Team', 0.00, 'completed', 'Flashed v1.2.0 firmware with improved non-blocking FreeRTOS queues and ultrasonic noise debouncing.');

  -- 6. Seed Safety Monitoring Events
  INSERT INTO robot_safety_monitoring (device_id, safety_event_type, severity, safety_action_taken, zone_location, notes, occurred_at)
  VALUES 
    (v_dev_reception, 'Obstacle Proximity Threshold (< 25cm)', 'warning', 'Halt Servo Sweep', 'Reception Kiosk Zone', 'Member leaned across kiosk counter while scanning QR code. Servo movement paused automatically until distance > 45cm.', CURRENT_TIMESTAMP - INTERVAL '2 hours'),
    (v_dev_reception, 'Servo Torque Limit Reached', 'info', 'Slow Down Speed by 50%', 'Reception Kiosk Zone', 'Gentle mechanical resistance detected on right arm wave. Safely yielded servo position.', CURRENT_TIMESTAMP - INTERVAL '1 day');

END $$;
