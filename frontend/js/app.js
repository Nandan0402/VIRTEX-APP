/**
 * app.js - Main Application Coordinator for FitBot Gym Receptionist Kiosk
 * Connects all kiosk features to the PostgreSQL backend APIs.
 */

import { api } from './services/api.js';
import { SpeechService } from './services/speech.js';
import { RobotStatusComponent } from './components/robotStatus.js';
import { VoiceVisualizerComponent } from './components/voiceVisualizer.js';
import { ChatInterfaceComponent } from './components/chatInterface.js';
import { MemberCardComponent } from './components/memberCard.js';
import { RobotAvatarComponent } from './components/robotAvatar.js';
import { MembershipSectionComponent } from './components/membershipSection.js';
import { TrainerSectionComponent } from './components/trainerSection.js';
import { AnnouncementsSectionComponent } from './components/announcementsSection.js';
import { FaqSectionComponent } from './components/faqSection.js';
import { RealtimeClient } from './services/realtimeClient.js';
import { LOCALIZED_CONTENT } from './services/mockData.js';

class GymReceptionistApp {
  constructor() {
    this.currentLanguage = 'en-IN';
    this.speech = new SpeechService();
    this.gymProfile = null;

    // Components
    this.robotAvatar = new RobotAvatarComponent('robot-avatar-container');
    this.robotStatus = new RobotStatusComponent('robot-status-container', (gesture) =>
      this.handleTriggerGesture(gesture)
    );
    this.voiceVisualizer = new VoiceVisualizerComponent('voice-visualizer-container');

    this.memberCard = new MemberCardComponent('member-card-container', {
      onEnquireClick: (planName) => this.membershipSection.openEnquiryModal(planName),
    });

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

    this.trainerSection = new TrainerSectionComponent({
      containerId: 'trainers-container',
      onTrainerConsult: (trainerName) => this.handleTrainerConsult(trainerName),
    });

    this.announcementsSection = new AnnouncementsSectionComponent({
      containerId: 'announcements-container',
      onSpeakAnnouncement: (text) => this.speakAloud(text),
    });

    this.faqSection = new FaqSectionComponent({
      containerId: 'faqs-container',
      onAskQuestion: (question) => this.handleSendMessage(question),
      onSpeakAnswer: (text, lang) => this.speakAloud(text, lang),
    });

    // Real-Time WebSocket Synchronization Client
    this.realtime = new RealtimeClient({
      channel: 'kiosk',
      onStatusChange: (status) => this.handleRealtimeStatusChange(status),
    });
  }

  async init() {
    console.log('[App] Bootstrapping PulseCore FitBot Receptionist Kiosk...');

    // 1. Initial State
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
    this.setupRealtimeListeners();

    // 3. Load Live PostgreSQL Backend Data
    await this.loadGymBranding();
    await Promise.allSettled([
      this.membershipSection.init(),
      this.trainerSection.init(),
      this.announcementsSection.init(),
      this.faqSection.init(this.currentLanguage),
    ]);

    // 4. Periodic Telemetry and Health Polls
    await this.refreshSystemHealth();
    await this.refreshRobotStatus();
    await this.refreshRecentCheckIns();

    // Server health every 5s, hardware every 3s, checkins every 10s
    setInterval(() => this.refreshSystemHealth(), 5000);
    setInterval(() => this.refreshRobotStatus(), 3000);
    setInterval(() => this.refreshRecentCheckIns(), 10000);
  }

  async loadGymBranding() {
    try {
      const res = await api.getGymInfo();
      if (res.data) {
        this.gymProfile = res.data;
        const brandTitle = document.getElementById('gym-brand-title');
        const brandSubtitle = document.getElementById('gym-brand-subtitle');
        const footerCopy = document.getElementById('footer-copy-text');

        if (brandTitle && res.data.gym_name) {
          const nameParts = res.data.gym_name.split(' ');
          if (nameParts.length > 1) {
            brandTitle.innerHTML = `${nameParts[0]} <span class="text-green">${nameParts.slice(1).join(' ')}</span>`;
          } else {
            brandTitle.textContent = res.data.gym_name;
          }
        }

        if (brandSubtitle && res.data.tagline) {
          brandSubtitle.textContent = res.data.tagline;
        }

        if (footerCopy && res.data.gym_name) {
          footerCopy.textContent = `© 2026 ${res.data.gym_name} • AI Gym Receptionist Robot Base (ESP32 DevKit V1 + 3x SG90 Servos)`;
        }
      }
    } catch (err) {
      console.warn('[App] Could not synchronize gym branding:', err);
    }
  }

  setupRealtimeListeners() {
    // 1. Membership Plan Updates from Admin
    const handlePlansChange = () => {
      console.log('[Realtime] Plans changed on server, refreshing live tiers...');
      this.membershipSection.loadData();
    };
    this.realtime.on('PLAN_CREATED', handlePlansChange);
    this.realtime.on('PLAN_UPDATED', handlePlansChange);
    this.realtime.on('PLAN_DELETED', handlePlansChange);
    this.realtime.on('PLAN_STATUS_CHANGED', handlePlansChange);

    // 2. Gym Profile & Operating Hours from Admin
    this.realtime.on('GYM_INFO_UPDATED', (data) => {
      console.log('[Realtime] Gym profile/hours updated on server, refreshing...');
      this.loadGymBranding();
      this.membershipSection.loadData();
    });

    // 3. Trainer Availability & Shifts from Admin/Trainer Console
    const handleTrainerChange = () => {
      console.log('[Realtime] Trainer status updated on server, refreshing floor board...');
      this.trainerSection.loadTrainers();
    };
    this.realtime.on('TRAINER_STATUS_UPDATED', handleTrainerChange);
    this.realtime.on('TRAINER_CREATED', handleTrainerChange);
    this.realtime.on('TRAINER_UPDATED', handleTrainerChange);
    this.realtime.on('TRAINER_DELETED', handleTrainerChange);

    // 4. Announcements Noticeboard from Admin
    const handleAnnouncementChange = () => {
      console.log('[Realtime] Noticeboard updated on server, refreshing announcements...');
      this.announcementsSection.loadAnnouncements();
    };
    this.realtime.on('ANNOUNCEMENT_CREATED', handleAnnouncementChange);
    this.realtime.on('ANNOUNCEMENT_UPDATED', handleAnnouncementChange);
    this.realtime.on('ANNOUNCEMENT_DELETED', handleAnnouncementChange);

    // 5. FAQs Knowledge Base from Admin
    const handleFaqChange = () => {
      console.log('[Realtime] FAQs updated on server, refreshing knowledge base...');
      this.faqSection.loadFaqs();
    };
    this.realtime.on('FAQ_CREATED', handleFaqChange);
    this.realtime.on('FAQ_UPDATED', handleFaqChange);
    this.realtime.on('FAQ_DELETED', handleFaqChange);

    // 6. Robot Hardware Telemetry & Command Dispatches
    this.realtime.on('ROBOT_STATUS_CHANGED', (state) => {
      if (state) {
        this.robotStatus.render(state);
      }
    });

    // 7. Member Check-ins (Feed Update)
    this.realtime.on('MEMBER_CHECKED_IN', () => {
      this.refreshRecentCheckIns();
    });

    // 8. Reconnection State: Re-sync state with PostgreSQL
    this.realtime.on('RECONNECTED', () => {
      console.log('[Realtime] WebSocket reconnected. Re-synchronizing all state with PostgreSQL...');
      this.refreshSystemHealth();
      this.refreshRobotStatus();
      this.refreshRecentCheckIns();
      this.membershipSection.loadData();
      this.trainerSection.loadTrainers();
      this.announcementsSection.loadAnnouncements();
      this.faqSection.loadFaqs();
    });
  }

  handleRealtimeStatusChange(status) {
    const text = document.getElementById('health-status-text');
    if (!text) return;
    if (status === 'connected') {
      text.textContent = 'Server Online • DB Connected • Live Sync ⚡';
    } else if (status === 'reconnecting') {
      text.textContent = 'Server Online • Reconnecting Sync...';
    }
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

    // Reload FAQs in the selected language
    this.faqSection.setLanguage(this.currentLanguage);

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

        if (res.success && res.data) {
          // 1. Success (HTTP 200 - Active Member)
          checkInInput.value = '';
          const member = res.data.member;
          const targetLang = res.data.voiceMeta?.bcp47 || member?.preferred_language || this.currentLanguage;

          this.memberCard.renderMember(member, res.data.checkIn);
          this.chatInterface.addMessage('robot', res.data.welcomeSpeech, res.data.gesture || 'GREET_WAVE', targetLang);
          this.robotAvatar.setState('speaking', res.data.gesture || 'GREET_WAVE');
          this.speakAloud(res.data.welcomeSpeech, targetLang);
          this.refreshRecentCheckIns();
        } else if (res.duplicate) {
          // 2. Duplicate Check-in (HTTP 409)
          const msg = res.error || 'You have already checked in recently. Please proceed to the workout floor!';
          this.memberCard.renderMember(null, null, { errorState: 'duplicate', message: msg });
          this.chatInterface.addMessage('robot', msg, 'NOD_YES', this.currentLanguage);
          this.robotAvatar.setState('idle', 'NOD_YES');
          this.speakAloud(msg, this.currentLanguage);
        } else if (res.member) {
          // 3. Inactive / Frozen / Expired Member (HTTP 403)
          this.memberCard.renderMember(res.member, null);
          const msg = res.error || `Your membership is currently ${res.member.status}. Please visit the front desk manager.`;
          this.chatInterface.addMessage('robot', msg, 'SHAKE_NO', this.currentLanguage);
          this.robotAvatar.setState('idle', 'SHAKE_NO');
          this.speakAloud(msg, this.currentLanguage);
        } else {
          // 4. Invalid ID / Unregistered Visitor (HTTP 404)
          this.memberCard.renderMember(null, null, { errorState: 'not_found', identifier });
          const msg = res.error || 'Member not found. Please verify your phone number or Member ID, or submit a visitor enquiry.';
          this.chatInterface.addMessage('robot', msg, 'SHAKE_NO', this.currentLanguage);
          this.robotAvatar.setState('idle', 'SHAKE_NO');
          this.speakAloud(msg, this.currentLanguage);
        }
      } catch (err) {
        console.error('[Check-in Error]', err);
        this.memberCard.renderMember(null, null, { errorState: 'not_found', identifier });
        this.chatInterface.addMessage('robot', 'System error verifying member. Please consult the front desk.', 'SHAKE_NO');
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
      if (res.success && res.data) {
        const { reply, gesture, language, voiceMeta } = res.data;
        const targetLang = voiceMeta?.bcp47 || language || this.currentLanguage;

        this.chatInterface.addMessage('robot', reply, gesture || 'NOD', targetLang);
        this.robotAvatar.setState('speaking', gesture || 'NOD');
        this.speakAloud(reply, targetLang);
      }
    } catch (err) {
      console.error('[Chat Error]', err);
      this.chatInterface.addMessage('robot', 'I had trouble processing that request. Please try again.', 'SHAKE_NO');
    }
  }

  handleTrainerConsult(trainerName) {
    const question = `Is trainer ${trainerName} available right now?`;
    this.handleSendMessage(question);
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
