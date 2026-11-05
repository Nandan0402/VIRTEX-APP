/**
 * Voice Service: Handles language definitions, text templates, and voice metadata
 * Supported Languages: English (en-IN), Kannada (kn-IN), Hindi (hi-IN)
 */

export const SUPPORTED_LANGUAGES = {
  'en-IN': {
    code: 'en-IN',
    name: 'English (India)',
    nativeName: 'English',
    bcp47: 'en-IN',
    speechRate: 1.0,
    pitch: 1.0,
    sampleGreetings: [
      'Welcome to IronCore Fitness! How can I help your workout journey today?',
      'Hello! Please tell me your membership ID or phone number to check in.',
      'Great job finishing your session today! Stay hydrated!',
    ],
  },
  'kn-IN': {
    code: 'kn-IN',
    name: 'Kannada',
    nativeName: 'ಕನ್ನಡ',
    bcp47: 'kn-IN',
    speechRate: 0.95,
    pitch: 1.0,
    sampleGreetings: [
      'ನಮ್ಮ ಜಿಮ್‌ಗೆ ಸ್ವಾಗತ! ಇಂದು ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?',
      'ನಮಸ್ಕಾರ! ಚೆಕ್-ಇನ್ ಮಾಡಲು ದಯವಿಟ್ಟು ನಿಮ್ಮ ಸದಸ್ಯತ್ವ ಐಡಿ ಅಥವಾ ಫೋನ್ ಸಂಖ್ಯೆಯನ್ನು ತಿಳಿಸಿ.',
      'ಉತ್ತಮ ವ್ಯಾಯಾಮ ಮುಗಿಸಿದ್ದೀರಿ! ಧನ್ಯವಾದಗಳು!',
    ],
  },
  'hi-IN': {
    code: 'hi-IN',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    bcp47: 'hi-IN',
    speechRate: 0.95,
    pitch: 1.0,
    sampleGreetings: [
      'आयरनकोर फिटनेस में आपका स्वागत है! आज मैं आपकी क्या मदद कर सकता हूँ?',
      'नमस्ते! चेक-इन करने के लिए कृपया अपनी सदस्यता आईडी या फ़ोन नंबर बताएं।',
      'आज का वर्कआउट शानदार रहा! खूब पानी पिएं और स्वस्थ रहें!',
    ],
  },
};

/**
 * Validate and normalize a requested language code or name
 * @param {string} langCode
 * @returns {string} Normalized code (defaults to en-IN)
 */
export function normalizeLanguage(langCode) {
  if (!langCode) return 'en-IN';
  const clean = langCode.trim().toLowerCase();
  
  if (SUPPORTED_LANGUAGES[langCode]) return langCode;
  if (clean.startsWith('kn') || clean.includes('kannada')) return 'kn-IN';
  if (clean.startsWith('hi') || clean.includes('hindi')) return 'hi-IN';
  if (clean.startsWith('en') || clean.includes('english')) return 'en-IN';
  return 'en-IN';
}

/**
 * Get language metadata
 * @param {string} langCode
 */
export function getLanguageMetadata(langCode) {
  const norm = normalizeLanguage(langCode);
  return SUPPORTED_LANGUAGES[norm];
}

/**
 * Get standard localized welcome message
 * @param {string} langCode
 * @param {string} [memberName]
 */
export function getWelcomeMessage(langCode, memberName) {
  const norm = normalizeLanguage(langCode);
  if (memberName) {
    switch (norm) {
      case 'kn-IN':
        return `ಸ್ವಾಗತ ${memberName}! ನಿಮ್ಮ ಇಂದಿನ ತರಬೇತಿ ಫಲಪ್ರದವಾಗಲಿ!`;
      case 'hi-IN':
        return `स्वागत है ${memberName}! आपका आज का वर्कआउट बेहतरीन रहे!`;
      case 'en-IN':
      default:
        return `Welcome back, ${memberName}! Have an energizing workout session today!`;
    }
  }
  return SUPPORTED_LANGUAGES[norm].sampleGreetings[0];
}
