/**
 * app.js - Main Application Coordinator for FitBot Gym Receptionist Kiosk
 */

import { api } from './services/api.js';
import { SpeechService } from './services/speech.js';
import { RobotStatusComponent } from './components/robotStatus.js';
import { VoiceVisualizerComponent } from './components/voiceVisualizer.js';
import { ChatInterfaceComponent } from './components/chatInterface.js';
import { MemberCardComponent } from './components/memberCard.js';
import { RobotAvatarComponent } from './components/robotAvatar.js';
import { MembershipSectionComponent } from './components/membershipSection.js';
import { LOCALIZED_CONTENT, GYM_INFO } from './services/mockData.js';

class GymReceptionistApp {
  constructor() {
    this.currentLanguage = 'en-IN';
    this.speech = new SpeechService();

    // Components
    this.robotAvatar = new RobotAvatarComponent('robot-avatar-container');
    this.robotStatus = new RobotStatusComponent('robot-status-container', (gesture) =>
      this.handleTriggerGesture(gesture)
    );
    this.voiceVisualizer = new VoiceVisualizerComponent('voice-visualizer-container');
    this.memberCard = new MemberCardComponent('member-card-container');

    this.chatInterface = new ChatInterfaceComponent({
      containerId: 'chat-interface-container',
      onSendMessage: (msg) => this.handleSendMessage(msg),
      onSpeakMessage: (text, lang) => this.speakAloud(text, lang),
      onTriggerGesture: (gesture) => this.handleTriggerGesture(gesture),
    });

    this.membershipSection = new MembershipSectionComponent({
      plansContainerId: 'membership-plans-grid',
      hoursContainerId: 'hours-container',
      contactContainerId: 'contact-container',
      enquiryModalId: 'enquiry-modal',
      onEnquirySubmitted: (msg) => this.handleEnquiryFeedback(msg),
    });
  }

  async init() {
    console.log('[App] Bootstrapping PulseCore FitBot UI...');

    // 1. Initial Views Render
    this.membershipSection.init();
    this.voiceVisualizer.setState('idle', LOCALIZED_CONTENT['en-IN'].idleText);
    this.memberCard.renderMember(null);

    // Initial receptionist greeting
    const welcomeText = LOCALIZED_CONTENT['en-IN'].welcome;
    this.chatInterface.addMessage('robot', welcomeText, 'GREET_WAVE', 'en-IN');
    this.robotAvatar.setState('idle', 'GREET_WAVE');

    // 2. Setup Event Listeners
    this.setupLanguageSwitcher();
    this.setupSpeechControls();
    this.setupChatInput();
    this.setupGlobalSpeakButton();
    this.setupCheckInForm();
    this.renderPromptChips();

    // 3. Periodic Telemetry and Health Polls
    await this.refreshSystemHealth();
    await this.refreshRobotStatus();
    await this.refreshRecentCheckIns();

    // Server health every 5s, hardware every 3s, checkins every 10s
    setInterval(() => this.refreshSystemHealth(), 5000);
    setInterval(() => this.refreshRobotStatus(), 3000);
    setInterval(() => this.refreshRecentCheckIns(), 10000);
  }

  setupLanguageSwitcher() {
    const buttons = document.querySelectorAll('.lang-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        buttons.forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });

        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        this.currentLanguage = btn.dataset.lang;
        this.speech.setLanguage(this.currentLanguage);

        console.log('[App] Language changed to:', this.currentLanguage);
        this.applyLanguageChanges();
      });
    });
  }

  applyLanguageChanges() {
    const localized = LOCALIZED_CONTENT[this.currentLanguage] || LOCALIZED_CONTENT['en-IN'];

    // Update input placeholder & prompt chips
    const input = document.getElementById('chat-text-input');
    if (input) input.placeholder = localized.placeholder;
    this.renderPromptChips();

    // Announce language change
    let switchNotice = 'Language switched to English.';
    if (this.currentLanguage === 'kn-IN') switchNotice = 'ಭಾಷೆಯನ್ನು ಕನ್ನಡಕ್ಕೆ ಬದಲಾಯಿಸಲಾಗಿದೆ.';
    if (this.currentLanguage === 'hi-IN') switchNotice = 'भाषा हिंदी में बदल दी गई है।';

    this.chatInterface.addMessage('robot', switchNotice, 'NOD_YES', this.currentLanguage);
    this.speakAloud(switchNotice, this.currentLanguage);
  }

  renderPromptChips() {
    const chipsContainer = document.getElementById('prompt-chips-wrapper');
    if (!chipsContainer) return;

    const localized = LOCALIZED_CONTENT[this.currentLanguage] || LOCALIZED_CONTENT['en-IN'];
    chipsContainer.innerHTML = localized.quickChips
      .map(
        (chipText) => `
        <button class="prompt-chip" role="button" aria-label="Ask: ${chipText}">
          ${chipText}
        </button>
      `
      )
      .join('');

    chipsContainer.querySelectorAll('.prompt-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        this.handleSendMessage(chip.innerText.trim());
      });
    });
  }

  setupSpeechControls() {
    const micButton = document.getElementById('mic-button');
    if (!micButton) return;

    const micText = micButton.querySelector('.mic-button-text');

    if (!SpeechService.isRecognitionSupported()) {
      micButton.classList.add('unsupported');
      micButton.title = 'Speech Recognition is not supported in this browser. Please type your query.';
    }

    micButton.addEventListener('click', () => {
      if (!SpeechService.isRecognitionSupported()) {
        this.voiceVisualizer.setError(
          'Voice recognition is not supported in this browser.',
          'Google Chrome or Edge is recommended. You can type your question in English, ಕನ್ನಡ, or हिन्दी in the box below!'
        );
        return;
      }

      if (this.speech.isListening) {
        this.speech.stopListening();
        this.setIdleState();
        micButton.classList.remove('listening');
        micButton.setAttribute('aria-pressed', 'false');
        if (micText) micText.textContent = 'Tap to Speak';
      } else {
        const localized = LOCALIZED_CONTENT[this.currentLanguage] || LOCALIZED_CONTENT['en-IN'];
        this.voiceVisualizer.clearTranscript();

        this.speech.startListening({
          onStart: () => {
            micButton.classList.add('listening');
            micButton.setAttribute('aria-pressed', 'true');
            if (micText) micText.textContent = 'Listening...';
            this.voiceVisualizer.setState('listening', localized.listeningText);
            this.robotAvatar.setState('listening');
          },
          onInterimResult: (interimText) => {
            this.voiceVisualizer.setLiveTranscript(interimText, true);
          },
          onResult: (transcript) => {
            micButton.classList.remove('listening');
            micButton.setAttribute('aria-pressed', 'false');
            if (micText) micText.textContent = 'Tap to Speak';
            this.voiceVisualizer.setLiveTranscript(transcript, false);
            this.handleSendMessage(transcript);
          },
          onError: (err) => {
            micButton.classList.remove('listening');
            micButton.setAttribute('aria-pressed', 'false');
            if (micText) micText.textContent = 'Tap to Speak';
            const userMsg = typeof err === 'object' ? err.message : err;
            this.voiceVisualizer.setError(userMsg, 'Typing fallback: Type your question in the text box below.');
          },
          onEnd: () => {
            micButton.classList.remove('listening');
            micButton.setAttribute('aria-pressed', 'false');
            if (micText) micText.textContent = 'Tap to Speak';
            setTimeout(() => {
              if (!this.speech.isSpeaking()) {
                this.setIdleState();
              }
            }, 800);
          },
        });
      }
    });
  }

  setupGlobalSpeakButton() {
    const globalSpeakBtn = document.getElementById('global-speak-btn');
    if (!globalSpeakBtn) return;

    globalSpeakBtn.addEventListener('click', () => {
      const latestRobotMsg = this.chatInterface.getLatestRobotMessage();
      if (latestRobotMsg) {
        this.speakAloud(latestRobotMsg.text, latestRobotMsg.language || this.currentLanguage);
      } else {
        const welcome = LOCALIZED_CONTENT[this.currentLanguage].welcome;
        this.speakAloud(welcome, this.currentLanguage);
      }
    });
  }

  setupChatInput() {
    const form = document.getElementById('chat-input-form');
    const input = document.getElementById('chat-text-input');
    if (!form || !input) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      this.handleSendMessage(text);
    });
  }

  setupCheckInForm() {
    const checkInForm = document.getElementById('checkin-form');
    const checkInInput = document.getElementById('checkin-input');
    if (!checkInForm || !checkInInput) return;

    checkInForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const identifier = checkInInput.value.trim();
      if (!identifier) return;

      const submitBtn = checkInForm.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Verifying...';
      }

      try {
        const res = await api.checkInMember(identifier, this.currentLanguage);
        if (res.success) {
          checkInInput.value = '';
          this.memberCard.renderMember(res.data.member, res.data.checkIn);
          this.chatInterface.addMessage('robot', res.data.welcomeSpeech, res.data.gesture, this.currentLanguage);
          this.robotAvatar.setState('speaking', res.data.gesture);
          this.speakAloud(res.data.welcomeSpeech, res.data.voiceMeta?.bcp47 || this.currentLanguage);
          this.refreshRecentCheckIns();
        } else {
          this.chatInterface.addMessage('robot', res.error || 'Member not found. Please verify details.', 'SHAKE_NO');
          this.robotAvatar.setState('idle', 'SHAKE_NO');
          this.speakAloud(res.error || 'Member not found.', this.currentLanguage);
        }
      } catch (err) {
        console.error('[Check-in Error]', err);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Check In';
        }
      }
    });
  }

  async handleSendMessage(text) {
    this.chatInterface.addMessage('user', text);

    try {
      const res = await api.sendChatMessage(text, this.currentLanguage);
      if (res.success) {
        const { reply, gesture, language, voiceMeta } = res.data;
        const targetLang = voiceMeta?.bcp47 || language || this.currentLanguage;

        this.chatInterface.addMessage('robot', reply, gesture, targetLang);
        this.robotAvatar.setState('speaking', gesture);
        this.speakAloud(reply, targetLang);
      }
    } catch (err) {
      console.error('[Chat Error]', err);
      this.chatInterface.addMessage('robot', 'I had trouble processing that request. Please try again.', 'SHAKE_NO');
    }
  }

  async handleTriggerGesture(gesture) {
    try {
      this.robotAvatar.setState('idle', gesture);
      await api.triggerGesture(gesture);
      await this.refreshRobotStatus();
    } catch (err) {
      console.error('[Gesture Trigger Error]', err);
    }
  }

  speakAloud(text, lang = this.currentLanguage) {
    const localized = LOCALIZED_CONTENT[this.currentLanguage] || LOCALIZED_CONTENT['en-IN'];
    this.voiceVisualizer.setState('speaking', localized.speakingText);
    this.robotAvatar.setState('speaking');

    this.speech.speak(text, lang, {
      onStart: () => {
        this.voiceVisualizer.setState('speaking', text);
        this.robotAvatar.setState('speaking');
      },
      onEnd: () => {
        this.setIdleState();
      },
      onError: () => {
        this.setIdleState();
      },
    });
  }

  setIdleState(customCaption = '') {
    const localized = LOCALIZED_CONTENT[this.currentLanguage] || LOCALIZED_CONTENT['en-IN'];
    this.voiceVisualizer.setState('idle', customCaption || localized.idleText);
    this.robotAvatar.setState('idle', 'RESET_IDLE');
  }

  handleEnquiryFeedback(message) {
    this.chatInterface.addMessage('robot', message, 'NOD_YES', this.currentLanguage);
    this.speakAloud(message, this.currentLanguage);
  }

  async refreshSystemHealth() {
    const pill = document.getElementById('system-health-pill');
    const text = document.getElementById('health-status-text');
    if (!pill || !text) return;

    try {
      const data = await api.getHealth();
      pill.className = 'health-pill';

      if (data.status === 'online') {
        const isDbConnected = data.database === 'connected';
        if (isDbConnected) {
          pill.classList.add('health-pill-online');
          text.textContent = 'Server Online • DB Connected';
        } else {
          pill.classList.add('health-pill-mock');
          text.textContent = 'Server Online • DB Mock Mode';
        }
      } else {
        pill.classList.add('health-pill-offline');
        text.textContent = 'Server Offline';
      }
    } catch {
      pill.className = 'health-pill health-pill-offline';
      text.textContent = 'Server Offline';
    }
  }

  async refreshRobotStatus() {
    try {
      const res = await api.getRobotStatus();
      if (res.success && res.data) {
        this.robotStatus.render(res.data);
      }
    } catch (e) {
      this.robotStatus.render({ online: false });
    }
  }

  async refreshRecentCheckIns() {
    try {
      const res = await api.getRecentCheckIns();
      if (res.success && res.data) {
        this.memberCard.renderRecentList(res.data);
      }
    } catch (e) {
      console.warn('[Recent Check-ins] Could not load records.');
    }
  }
}

// Bootstrap once DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const app = new GymReceptionistApp();
  app.init();
});
