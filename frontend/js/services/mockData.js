/**
 * mockData.js - Localized UI Text and Prompts for Voice/Chat (EN, KN, HI)
 * 
 * NOTE: All gym business data (plans, pricing, operating hours, trainers, announcements,
 * and FAQs) has been removed from this file and is loaded dynamically from PostgreSQL 
 * backend APIs via frontend/js/services/api.js.
 */

export const LOCALIZED_CONTENT = {
  'en-IN': {
    welcome: 'Welcome to Virtex Fitness! I am your AI Receptionist. How can I power your workout today?',
    placeholder: 'Ask about plans, timings, trainers, or tap the mic...',
    listeningText: 'Listening... Speak in English',
    speakingText: 'Receptionist is speaking...',
    idleText: 'Ready. Ask a question or use voice control.',
    quickChips: [
      'What are your gym hours?',
      'Tell me about membership plans',
      'Are personal trainers available?',
      'Where is the steam room?',
    ],
    statusOnline: 'ESP32 Base Connected',
    statusOffline: 'ESP32 Base Offline',
  },
  'kn-IN': {
    welcome: 'ವರ್ಟೆಕ್ಸ್ ಫಿಟ್‌ನೆಸ್‌ಗೆ ಸುಸ್ವಾಗತ! ನಾನು ನಿಮ್ಮ ಎಐ ರಿಸೆಪ್ಷನಿಸ್ಟ್. ಇಂದು ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?',
    placeholder: 'ಜಿಮ್ ಸಮಯ, ಶುಲ್ಕ ಅಥವಾ ತರಬೇತುದಾರರ ಬಗ್ಗೆ ಕೇಳಿ...',
    listeningText: 'ಕೇಳಿಸಿಕೊಳ್ಳುತ್ತಿದ್ದೇನೆ... ಕನ್ನಡದಲ್ಲಿ ಮಾತನಾಡಿ',
    speakingText: 'ರಿಸೆಪ್ಷನಿಸ್ಟ್ ಮಾತನಾಡುತ್ತಿದ್ದಾರೆ...',
    idleText: 'ಸಿದ್ಧವಾಗಿದೆ. ಮೈಕ್ ಒತ್ತಿ ಅಥವಾ ಪ್ರಶ್ನೆ ಟೈಪ್ ಮಾಡಿ.',
    quickChips: [
      'ಜಿಮ್ ತೆರೆಯುವ ಸಮಯ ಎಷ್ಟು?',
      'ಸದಸ್ಯತ್ವ ಶುಲ್ಕ ಎಷ್ಟು?',
      'ವೈಯಕ್ತಿಕ ತರಬೇತುದಾರರು ಲಭ್ಯವಿದ್ದಾರೆಯೇ?',
      'ಸ್ಟೀಮ್ ಬಾತ್ ಲಭ್ಯವಿದೆಯೇ?',
    ],
    statusOnline: 'ಇಎಸ್‌ಪಿ32 ಬೇಸ್ ಸಂಪರ್ಕಗೊಂಡಿದೆ',
    statusOffline: 'ಇಎಸ್‌ಪಿ32 ಆಫ್‌ಲೈನ್ ಆಗಿದೆ',
  },
  'hi-IN': {
    welcome: 'वर्टेक्स फिटनेस में आपका स्वागत है! मैं आपका एआई रिसेप्शनिस्ट हूँ। आज मैं आपकी क्या मदद करूँ?',
    placeholder: 'जिम टाइमिंग, फीस या ट्रेनर के बारे में पूछें...',
    listeningText: 'सुन रहा हूँ... हिंदी में बोलें',
    speakingText: 'रिसेप्शनिस्ट बोल रहा है...',
    idleText: 'तैयार है। माइक दबाएं या सवाल टाइप करें।',
    quickChips: [
      'जिम का समय क्या है?',
      'मेंबरशिप फीस कितनी है?',
      'क्या पर्सनल ट्रेनर उपलब्ध हैं?',
      'स्टीम बाथ की सुविधा कहाँ है?',
    ],
    statusOnline: 'ईएसपी32 बेस कनेक्टेड है',
    statusOffline: 'ईएसपी32 ऑफलाइन है',
  },
};
