/**
 * ==============================================================================
 * voiceVisualizer.js - Dynamic Audio Waveform & Recognized-Text Live Preview
 * Renders real-time equalizer animation and live speech preview as user speaks
 * ==============================================================================
 */

export class VoiceVisualizerComponent {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.state = 'idle'; // 'idle' | 'listening' | 'speaking' | 'error'
    this.liveTranscript = '';
  }

  setState(state, statusText = '', isInterim = false) {
    this.state = state;
    if (!this.container) return;

    let subText = statusText;
    if (!subText) {
      if (state === 'listening') subText = 'Listening... Speak in English, ಕನ್ನಡ, or हिन्दी';
      else if (state === 'speaking') subText = 'Receptionist is speaking the answer aloud...';
      else subText = 'Ready. Tap the microphone or type a question below.';
    }

    this.container.innerHTML = `
      <div class="visualizer-wrapper ${state}" role="status" aria-live="polite">
        <div class="sound-wave" aria-hidden="true">
          <span class="bar bar-1"></span>
          <span class="bar bar-2"></span>
          <span class="bar bar-3"></span>
          <span class="bar bar-4"></span>
          <span class="bar bar-5"></span>
        </div>
        <p class="visualizer-caption">${this.escapeHtml(subText)}</p>
        
        ${
          this.liveTranscript
            ? `
          <div class="live-transcript-box ${isInterim ? 'interim' : 'final'}" aria-label="Speech recognition preview">
            <span class="transcript-tag">🎙️ Live Preview:</span>
            <span class="transcript-text">"${this.escapeHtml(this.liveTranscript)}"</span>
          </div>
        `
            : ''
        }
      </div>
    `;
  }

  /**
   * Update live recognized-text preview as user speaks
   * @param {string} text
   * @param {boolean} isInterim
   */
  setLiveTranscript(text, isInterim = true) {
    this.liveTranscript = text || '';
    if (this.liveTranscript) {
      this.setState('listening', isInterim ? 'Hearing words in real time...' : 'Processing your query...', isInterim);
    } else {
      this.setState('listening', 'Listening... Speak now');
    }
  }

  /**
   * Clear recognized-text preview
   */
  clearTranscript() {
    this.liveTranscript = '';
  }

  /**
   * Display an actionable error alert (e.g. Permission Denied / Browser Unsupported)
   */
  setError(message, instruction = '') {
    this.state = 'error';
    this.liveTranscript = '';
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="visualizer-wrapper error" role="alert">
        <div class="voice-alert-badge">⚠️ Notice</div>
        <p class="visualizer-caption font-bold text-danger">${this.escapeHtml(message)}</p>
        ${instruction ? `<p class="visualizer-hint text-muted">${this.escapeHtml(instruction)}</p>` : ''}
      </div>
    `;
  }

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
