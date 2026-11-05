/**
 * ==============================================================================
 * speech.js - Web Speech API Modular Service for Multilingual Receptionist
 * Supports: English India (en-IN), Kannada (kn-IN), and Hindi (hi-IN)
 *
 * Privacy Note:
 *   Operates entirely using client-side Web Speech API events.
 *   NO raw audio recordings or binary audio blobs are stored locally or transmitted.
 * ==============================================================================
 */

export class SpeechService {
  constructor() {
    this.currentLanguage = 'en-IN';
    this.isListening = false;
    this.recognition = null;
    this.synthesis = typeof window !== 'undefined' ? window.speechSynthesis || null : null;
    this.voices = [];
    this.voicesLoaded = false;

    this.initVoices();
    this.initSpeechRecognition();
  }

  /**
   * Check browser support for Speech Recognition (STT)
   */
  static isRecognitionSupported() {
    if (typeof window === 'undefined') return false;
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  /**
   * Check browser support for Speech Synthesis (TTS)
   */
  static isSynthesisSupported() {
    if (typeof window === 'undefined') return false;
    return !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
  }

  /**
   * Initialize speech synthesis voices with dynamic event listener
   */
  initVoices() {
    if (!this.synthesis) return;

    const loadVoices = () => {
      this.voices = this.synthesis.getVoices() || [];
      if (this.voices.length > 0) {
        this.voicesLoaded = true;
      }
    };

    loadVoices();
    if (this.synthesis.onvoiceschanged !== undefined) {
      this.synthesis.onvoiceschanged = loadVoices;
    }
  }

  /**
   * Switch the active speech recognition language
   * @param {string} langCode - 'en-IN' | 'kn-IN' | 'hi-IN'
   */
  setLanguage(langCode) {
    this.currentLanguage = langCode || 'en-IN';
    if (this.recognition) {
      this.recognition.lang = this.currentLanguage;
    }
  }

  /**
   * Initialize browser SpeechRecognition instance
   */
  initSpeechRecognition() {
    const SpeechRecognition = typeof window !== 'undefined'
      ? (window.SpeechRecognition || window.webkitSpeechRecognition)
      : null;

    if (!SpeechRecognition) {
      console.warn('[SpeechService] Web Speech Recognition not supported in this browser.');
      return;
    }

    try {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = false;     // Stops after completing sentence
      this.recognition.interimResults = true;  // Emits real-time live preview of words
      this.recognition.maxAlternatives = 1;
      this.recognition.lang = this.currentLanguage;
    } catch (err) {
      console.error('[SpeechService] Failed to instantiate SpeechRecognition:', err);
    }
  }

  /**
   * Start listening to voice input from microphone
   * @param {object} options
   * @param {Function} [options.onStart] - Triggered when microphone starts capturing
   * @param {Function} [options.onInterimResult] - Triggered as words are spoken (live preview)
   * @param {Function} [options.onResult] - Triggered on final recognized query
   * @param {Function} [options.onError] - Triggered on permission denial or recognition error
   * @param {Function} [options.onEnd] - Triggered when listening session completes
   */
  startListening({ onStart, onInterimResult, onResult, onError, onEnd } = {}) {
    if (!SpeechService.isRecognitionSupported()) {
      if (onError) {
        onError({
          code: 'not-supported',
          message: 'Speech Recognition is not supported in this browser (Chrome / Edge recommended). Please type your query.',
        });
      }
      return;
    }

    if (!this.recognition) {
      this.initSpeechRecognition();
    }

    if (this.isListening) {
      this.stopListening();
      return;
    }

    this.recognition.lang = this.currentLanguage;
    let finalTranscript = '';

    this.recognition.onstart = () => {
      this.isListening = true;
      if (onStart) onStart();
    };

    this.recognition.onresult = (event) => {
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      // Live real-time recognized text preview
      if (onInterimResult && interimTranscript) {
        onInterimResult(interimTranscript);
      }

      if (finalTranscript && onResult) {
        onResult(finalTranscript.trim());
      }
    };

    this.recognition.onerror = (event) => {
      this.isListening = false;
      let userMessage = event.error;

      switch (event.error) {
        case 'not-allowed':
        case 'permission-denied':
          userMessage = 'Microphone permission blocked. Please click the lock or camera icon in your address bar to allow microphone access.';
          break;
        case 'no-speech':
          userMessage = 'No speech detected. Please speak closer to your microphone or try typing your question.';
          break;
        case 'audio-capture':
          userMessage = 'No microphone was found on this device. Please connect an audio input device.';
          break;
        case 'network':
          userMessage = 'Network error during cloud speech recognition. Please verify your internet connection or use text input.';
          break;
        case 'aborted':
          userMessage = 'Voice listening was canceled.';
          break;
        default:
          userMessage = `Voice recognition error: ${event.error}. Please type your question.`;
          break;
      }

      if (onError) {
        onError({ code: event.error, message: userMessage });
      }
    };

    this.recognition.onend = () => {
      this.isListening = false;
      if (onEnd) onEnd();
    };

    try {
      this.recognition.start();
    } catch (e) {
      console.warn('[SpeechService] Recognition start exception:', e);
      this.isListening = false;
    }
  }

  /**
   * Stop active listening
   */
  stopListening() {
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch (e) {
        // Ignored
      }
      this.isListening = false;
    }
  }

  /**
   * Find best synthesized voice matching target language
   * @param {string} langCode - 'en-IN' | 'kn-IN' | 'hi-IN'
   * @returns {SpeechSynthesisVoice|null}
   */
  findVoiceForLanguage(langCode) {
    if (!this.voices || this.voices.length === 0) {
      if (this.synthesis) {
        this.voices = this.synthesis.getVoices() || [];
      }
    }

    const target = (langCode || this.currentLanguage).toLowerCase();
    const prefix = target.split('-')[0]; // 'kn', 'hi', 'en'

    // 1. Exact match (e.g. 'kn-IN' or 'hi-IN')
    let match = this.voices.find((v) => v.lang.toLowerCase() === target || v.lang.replace('_', '-').toLowerCase() === target);
    if (match) return match;

    // 2. Prefix match (e.g. 'kn' or 'hi')
    match = this.voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
    if (match) return match;

    // 3. Name substring match (e.g. 'Kannada', 'Hindi', 'Indian')
    if (prefix === 'kn') {
      match = this.voices.find((v) => v.name.toLowerCase().includes('kannada'));
      if (match) return match;
    } else if (prefix === 'hi') {
      match = this.voices.find((v) => v.name.toLowerCase().includes('hindi') || v.name.toLowerCase().includes('hemant') || v.name.toLowerCase().includes('kalpana'));
      if (match) return match;
    } else if (prefix === 'en') {
      match = this.voices.find((v) => v.name.toLowerCase().includes('india') || v.lang.toLowerCase().includes('en-in'));
      if (match) return match;
    }

    // 4. Default system fallback
    return this.voices.find((v) => v.default) || (this.voices.length > 0 ? this.voices[0] : null);
  }

  /**
   * Speak receptionist answer aloud via SpeechSynthesis (TTS)
   * @param {string} text - Message to read aloud
   * @param {string} [langCode] - 'en-IN' | 'kn-IN' | 'hi-IN'
   * @param {object} [callbacks] - { onStart, onEnd, onError }
   */
  speak(text, langCode = this.currentLanguage, { onStart, onEnd, onError } = {}) {
    if (!SpeechService.isSynthesisSupported()) {
      console.warn('[SpeechService] SpeechSynthesis is not supported in this browser.');
      if (onEnd) onEnd();
      return;
    }

    if (!text || text.trim().length === 0) {
      if (onEnd) onEnd();
      return;
    }

    // Cancel any active speech before starting new sentence
    this.synthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = langCode;

    // Native cadence adjustment
    utterance.rate = langCode === 'en-IN' ? 1.0 : 0.95;
    utterance.pitch = 1.0;

    const matchedVoice = this.findVoiceForLanguage(langCode);
    if (matchedVoice) {
      utterance.voice = matchedVoice;
    }

    utterance.onstart = () => {
      if (onStart) onStart();
    };

    utterance.onend = () => {
      if (onEnd) onEnd();
    };

    utterance.onerror = (err) => {
      console.warn('[SpeechService] TTS playback notice:', err.error);
      if (onError) onError(err);
      if (onEnd) onEnd();
    };

    this.synthesis.speak(utterance);
  }

  /**
   * Stop active speech synthesis playback
   */
  stopSpeaking() {
    if (this.synthesis) {
      this.synthesis.cancel();
    }
  }

  /**
   * Whether TTS is currently speaking
   */
  isSpeaking() {
    return this.synthesis ? this.synthesis.speaking : false;
  }
}
