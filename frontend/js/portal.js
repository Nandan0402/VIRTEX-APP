/**
 * portal.js - Landing Page Controller & Telemetry Poller
 * Live health monitoring for Node.js API, PostgreSQL Database, and ESP32 Robot Hardware
 */

class PortalController {
  constructor() {
    this.healthEndpoint = '/api/v1/health';
    this.robotEndpoint = '/api/v1/robot/status';
  }

  init() {
    console.log('[Portal] Initializing Virtex Gateway Telemetry...');
    this.pollAll();
    setInterval(() => this.pollAll(), 4000);
  }

  async pollAll() {
    await Promise.all([this.pollSystemHealth(), this.pollRobotTelemetry()]);
  }

  async pollSystemHealth() {
    try {
      const res = await fetch(this.healthEndpoint);
      const data = await res.json();

      const serverPill = document.getElementById('stat-server');
      const dbPill = document.getElementById('stat-db');

      if (data.status === 'online') {
        if (serverPill) {
          serverPill.innerHTML = '<span class="status-indicator online"></span>Online (Port 3000)';
          serverPill.className = 'telemetry-badge badge-online';
        }
      } else {
        if (serverPill) {
          serverPill.innerHTML = '<span class="status-indicator offline"></span>Offline';
          serverPill.className = 'telemetry-badge badge-offline';
        }
      }

      if (data.database && data.database.includes('connected') && !data.database.includes('disconnected')) {
        if (dbPill) {
          dbPill.innerHTML = '<span class="status-indicator online"></span>Connected (PostgreSQL 18)';
          dbPill.className = 'telemetry-badge badge-online';
        }
      } else {
        if (dbPill) {
          dbPill.innerHTML = '<span class="status-indicator offline"></span>Mock Fallback Mode';
          dbPill.className = 'telemetry-badge badge-warning';
        }
      }
    } catch {
      const serverPill = document.getElementById('stat-server');
      const dbPill = document.getElementById('stat-db');
      if (serverPill) {
        serverPill.innerHTML = '<span class="status-indicator offline"></span>Unreachable';
        serverPill.className = 'telemetry-badge badge-offline';
      }
      if (dbPill) {
        dbPill.innerHTML = '<span class="status-indicator offline"></span>Disconnected';
        dbPill.className = 'telemetry-badge badge-offline';
      }
    }
  }

  async pollRobotTelemetry() {
    try {
      const res = await fetch(this.robotEndpoint);
      const data = await res.json();
      const robotPill = document.getElementById('stat-robot');
      const robotServoMeta = document.getElementById('robot-servo-meta');

      if (data.success && data.data?.online) {
        if (robotPill) {
          robotPill.innerHTML = `<span class="status-indicator online"></span>ESP32 Online (${data.data.ipAddress})`;
          robotPill.className = 'telemetry-badge badge-online';
        }
        if (robotServoMeta) {
          robotServoMeta.textContent = `Head: ${data.data.servos.headPan}° • Arm: ${data.data.servos.armWave}°`;
        }
      } else {
        if (robotPill) {
          robotPill.innerHTML = '<span class="status-indicator offline"></span>ESP32 Base Standby';
          robotPill.className = 'telemetry-badge badge-offline';
        }
        if (robotServoMeta) {
          robotServoMeta.textContent = 'Awaiting Wi-Fi link';
        }
      }
    } catch {
      const robotPill = document.getElementById('stat-robot');
      if (robotPill) {
        robotPill.innerHTML = '<span class="status-indicator offline"></span>ESP32 Offline';
        robotPill.className = 'telemetry-badge badge-offline';
      }
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const portal = new PortalController();
  portal.init();
});

