/**
 * robotAvatar.js - Animated Visual Robot Indicator (FitBot Avatar)
 * Reflects physical ESP32 status, listening/speaking states, and gestures
 */

export class RobotAvatarComponent {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.state = 'idle'; // 'idle' | 'listening' | 'speaking'
    this.currentGesture = 'RESET_IDLE';
    this.blinkInterval = null;
    this.init();
  }

  init() {
    this.render();
    this.startRandomBlinking();
  }

  setState(state, gesture = null) {
    this.state = state;
    if (gesture) {
      this.currentGesture = gesture;
    }
    this.render();
  }

  startRandomBlinking() {
    if (this.blinkInterval) clearInterval(this.blinkInterval);
    this.blinkInterval = setInterval(() => {
      const face = this.container?.querySelector('.robot-face');
      if (face && this.state !== 'speaking') {
        face.classList.add('blink');
        setTimeout(() => face.classList.remove('blink'), 220);
      }
    }, 3500 + Math.random() * 2000);
  }

  render() {
    if (!this.container) return;

    let gestureLabel = 'Neutral Idle';
    if (this.currentGesture === 'GREET_WAVE') gestureLabel = 'Waving Arm 👋';
    else if (this.currentGesture === 'NOD_YES') gestureLabel = 'Affirmative Nod ✅';
    else if (this.currentGesture === 'SHAKE_NO') gestureLabel = 'Head Shake ❌';
    else if (this.currentGesture === 'LOOK_LEFT') gestureLabel = 'Looking Left ⬅️';
    else if (this.currentGesture === 'LOOK_RIGHT') gestureLabel = 'Looking Right ➡️';

    let stateClass = `robot-state-${this.state}`;
    let gestureClass = `gesture-${this.currentGesture.toLowerCase()}`;

    this.container.innerHTML = `
      <div class="robot-avatar-wrapper ${stateClass} ${gestureClass}" role="img" aria-label="Animated Robot Receptionist Avatar">
        <div class="antenna">
          <div class="antenna-bulb"></div>
          <div class="antenna-rod"></div>
        </div>

        <div class="robot-head">
          <div class="ear ear-left"></div>
          <div class="ear ear-right"></div>
          
          <div class="robot-face">
            <div class="visor-screen">
              <div class="eye eye-left">
                <span class="eye-pupil"></span>
              </div>
              <div class="eye eye-right">
                <span class="eye-pupil"></span>
              </div>
              <div class="mouth-display">
                <span class="mouth-bar"></span>
                <span class="mouth-bar"></span>
                <span class="mouth-bar"></span>
                <span class="mouth-bar"></span>
                <span class="mouth-bar"></span>
              </div>
            </div>
          </div>
        </div>

        <div class="robot-torso-hint">
          <div class="chest-plate">
            <span class="chest-light"></span>
            <span class="chest-label">FITBOT AI</span>
          </div>
        </div>

        <div class="avatar-status-pill">
          <span class="avatar-pulse-dot"></span>
          <span class="avatar-status-text">${gestureLabel}</span>
        </div>
      </div>
    `;
  }
}

