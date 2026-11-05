/**
 * robotStatus.js - ESP32 Hardware Status & 3x SG90 Servo Visualizer Component
 */

export class RobotStatusComponent {
  constructor(containerId, onTriggerGesture) {
    this.container = document.getElementById(containerId);
    this.onTriggerGesture = onTriggerGesture;
  }

  render(robotState) {
    if (!this.container) return;

    const isOnline = Boolean(robotState?.online);
    const ip = robotState?.ipAddress || 'Waiting for Wi-Fi...';
    const servos = robotState?.servos || { headPan: 90, headTilt: 90, armWave: 10 };
    const gesture = robotState?.currentGesture || 'RESET_IDLE';

    this.container.innerHTML = `
      <section class="card hardware-card" aria-label="ESP32 Robot Hardware Status">
        <div class="card-header">
          <div class="header-title">
            <span class="status-indicator ${isOnline ? 'online' : 'offline'}" aria-hidden="true"></span>
            <h3>ESP32 Robot Hardware</h3>
          </div>
          <span class="badge ${isOnline ? 'badge-green' : 'badge-danger'}">
            ${isOnline ? '● Online' : '○ Offline'}
          </span>
        </div>

        <div class="hardware-meta-grid">
          <div class="meta-item">
            <span class="meta-label">Wi-Fi IP Address</span>
            <span class="meta-val font-mono">${ip}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Active Motor Gesture</span>
            <span class="meta-val text-green font-semibold">${gesture}</span>
          </div>
        </div>

        <!-- 3 SG90 Servo Positions -->
        <div class="servos-dashboard" role="group" aria-label="SG90 Servo Angles">
          <!-- Servo 1: Head Pan -->
          <div class="servo-card">
            <div class="servo-top">
              <span class="servo-name">Head Pan (Yaw)</span>
              <span class="servo-pin">GPIO 18</span>
            </div>
            <div class="servo-gauge-bg" role="progressbar" aria-valuenow="${servos.headPan}" aria-valuemin="0" aria-valuemax="180">
              <div class="servo-gauge-fill" style="width: ${(servos.headPan / 180) * 100}%"></div>
            </div>
            <div class="servo-bottom">
              <span class="servo-val font-mono">${servos.headPan}°</span>
              <small class="servo-range">0° - 180°</small>
            </div>
          </div>

          <!-- Servo 2: Head Tilt -->
          <div class="servo-card">
            <div class="servo-top">
              <span class="servo-name">Head Tilt (Pitch)</span>
              <span class="servo-pin">GPIO 19</span>
            </div>
            <div class="servo-gauge-bg" role="progressbar" aria-valuenow="${servos.headTilt}" aria-valuemin="45" aria-valuemax="135">
              <div class="servo-gauge-fill" style="width: ${((servos.headTilt - 45) / 90) * 100}%"></div>
            </div>
            <div class="servo-bottom">
              <span class="servo-val font-mono">${servos.headTilt}°</span>
              <small class="servo-range">45° - 135°</small>
            </div>
          </div>

          <!-- Servo 3: Arm Wave -->
          <div class="servo-card">
            <div class="servo-top">
              <span class="servo-name">Right Arm (Wave)</span>
              <span class="servo-pin">GPIO 21</span>
            </div>
            <div class="servo-gauge-bg" role="progressbar" aria-valuenow="${servos.armWave}" aria-valuemin="0" aria-valuemax="160">
              <div class="servo-gauge-fill" style="width: ${(servos.armWave / 160) * 100}%"></div>
            </div>
            <div class="servo-bottom">
              <span class="servo-val font-mono">${servos.armWave}°</span>
              <small class="servo-range">0° - 160°</small>
            </div>
          </div>
        </div>

        <!-- Manual Servo Test Triggers -->
        <div class="hardware-actions">
          <span class="actions-heading">Manual Hardware Triggers:</span>
          <div class="gesture-btn-group">
            <button class="btn btn-outline-green btn-sm gesture-trigger-btn" data-gesture="GREET_WAVE">👋 Wave</button>
            <button class="btn btn-outline-green btn-sm gesture-trigger-btn" data-gesture="NOD_YES">✅ Nod</button>
            <button class="btn btn-outline-green btn-sm gesture-trigger-btn" data-gesture="SHAKE_NO">❌ Shake</button>
            <button class="btn btn-outline-green btn-sm gesture-trigger-btn" data-gesture="LOOK_LEFT">⬅️ Look Left</button>
            <button class="btn btn-outline-green btn-sm gesture-trigger-btn" data-gesture="LOOK_RIGHT">➡️ Look Right</button>
            <button class="btn btn-outline-green btn-sm gesture-trigger-btn" data-gesture="RESET_IDLE">🔄 Neutral</button>
          </div>
        </div>
      </section>
    `;

    // Bind manual gesture trigger clicks
    this.container.querySelectorAll('.gesture-trigger-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const gestureName = btn.dataset.gesture;
        if (this.onTriggerGesture) {
          this.onTriggerGesture(gestureName);
        }
      });
    });
  }
}
