/**
 * mockData.js - Public Gym Information, Membership Plans, and Localized Content
 * Note: No private member data is hardcoded here.
 */

export const GYM_INFO = {
  name: 'PULSECORE FITNESS',
  tagline: 'AI-Powered Smart Fitness Reception',
  phone: '+91 98765 43210',
  email: 'reception@pulsecorefitness.in',
  address: '42, 100 Feet Road, Indiranagar, Bengaluru, Karnataka 560038',
  hours: [
    { days: 'Monday – Friday', timing: '06:00 AM – 10:00 PM', status: 'Open' },
    { days: 'Saturday', timing: '06:00 AM – 09:00 PM', status: 'Open' },
    { days: 'Sunday', timing: '07:00 AM – 01:00 PM', status: 'Half Day' },
  ],
};

export const MEMBERSHIP_PLANS = [
  {
    id: 'plan_silver',
    name: 'Silver Monthly',
    duration: '1 Month',
    price: '₹2,499',
    period: '/month',
    badge: 'Popular',
    featured: false,
    perks: [
      'Full Gym Floor & Cardio Access',
      'Locker & Shower Facilities',
      'Free Fitness Assessment',
      'Standard Mobile App Access',
    ],
  },
  {
    id: 'plan_gold',
    name: 'Gold Quarterly',
    duration: '3 Months',
    price: '₹5,999',
    period: '/quarter',
    badge: 'Best Value',
    featured: true,
    perks: [
      'Everything in Silver Monthly',
      '2 Personal Trainer Consultations',
      'Nutrition & Macro Guidance',
      'Steam & Sauna Access (2x/wk)',
      '1 Free Guest Pass per month',
    ],
  },
  {
    id: 'plan_platinum',
    name: 'Platinum Annual',
    duration: '12 Months',
    price: '₹18,999',
    period: '/year',
    badge: 'VIP Elite',
    featured: false,
    perks: [
      'Unlimited 24/7 Access',
      'Monthly 1-on-1 Trainer Session',
      'Full Steam, Sauna & Recovery Lounge',
      'Complimentary Gym Merchandise Kit',
      'Free Locker Rental for 1 Year',
    ],
  },
];

export const LOCALIZED_CONTENT = {
  'en-IN': {
    welcome: 'Welcome to PulseCore Fitness! I am FitBot, your AI Receptionist. How can I power your workout today?',
    placeholder: 'Ask about plans, timings, trainers, or tap the mic...',
    listeningText: 'Listening... Speak in English',
    speakingText: 'FitBot is speaking...',
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
    welcome: 'ಪಲ್ಸ್‌ಕೋರ್ ಫಿಟ್‌ನೆಸ್‌ಗೆ ಸುಸ್ವಾಗತ! ನಾನು ನಿಮ್ಮ ಎಐ ರಿಸೆಪ್ಷನಿಸ್ಟ್ ಫಿಟ್‌ಬಾಟ್. ಇಂದು ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?',
    placeholder: 'ಜಿಮ್ ಸಮಯ, ಶುಲ್ಕ ಅಥವಾ ತರಬೇತುದಾರರ ಬಗ್ಗೆ ಕೇಳಿ...',
    listeningText: 'ಕೇಳಿಸಿಕೊಳ್ಳುತ್ತಿದ್ದೇನೆ... ಕನ್ನಡದಲ್ಲಿ ಮಾತನಾಡಿ',
    speakingText: 'ಫಿಟ್‌ಬಾಟ್ ಮಾತನಾಡುತ್ತಿದೆ...',
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
    welcome: 'पल्सकोर फिटनेस में आपका स्वागत है! मैं आपका एआई रिसेप्शनिस्ट फिटबॉट हूँ। आज मैं आपकी क्या मदद करूँ?',
    placeholder: 'जिम टाइमिंग, फीस या ट्रेनर के बारे में पूछें...',
    listeningText: 'सुन रहा हूँ... हिंदी में बोलें',
    speakingText: 'फिटबॉट बोल रहा है...',
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

