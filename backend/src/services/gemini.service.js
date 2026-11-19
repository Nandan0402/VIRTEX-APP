import { config } from '../config/env.js';
import { normalizeLanguage } from './voice.service.js';
import { getGymProfile } from './gym.service.js';
import { getMembershipPlans } from './membership.service.js';
import { getTrainers } from './trainer.service.js';
import { getFaqs } from './faq.service.js';
import { getAnnouncements } from './announcement.service.js';

/**
 * System prompt definition for the Gym Receptionist Robot AI
 */
export const GYM_RECEPTIONIST_SYSTEM_PROMPT = `
You are "FitBot", a friendly, energetic, and professional AI Gym Receptionist robot at Virtex Fitness.
You speak aloud to members and visitors via Text-to-Speech (TTS) and trigger safe physical robot movements.

CRITICAL OPERATIONAL RULES:
1. STRICT GROUNDING: Use ONLY the provided Authoritative Gym Data. NEVER invent or hallucinate prices, schedules, discounts, trainer availability, facilities, rules, or policies.
2. MISSING DATA DIRECTIVE: If the requested information is not in the authoritative data, state clearly in 1 to 2 polite sentences that you do not have that specific detail and refer the user to the front desk reception staff (+91 98765 43210).
3. APPROVED TOPICS ONLY:
   - Membership plans & prices (use exact INR figures from the data)
   - Timings / operating hours
   - Trainer availability and profiles
   - Facilities and amenities (lockers, showers, steam room, Wi-Fi)
   - Gym rules and etiquette (clean shoes, workout towels, re-racking weights)
   - Active announcements, bootcamps, and maintenance notices
   - Enquiries, free trials, and how to join
   - Safe general workout guidance (warm-up, hydration, progressive overload; direct personalized/medical plans to trainers)
4. CONCISE FOR SPEECH: Spoken replies must be 1 to 3 sentences maximum. Keep them punchy, polite, and natural for text-to-speech. Never use markdown, asterisks, bullet points, or tables.
5. MULTILINGUAL ACCURACY: You must answer in the requested language:
   - 'kn-IN': Reply in natural, conversational Kannada (ಕನ್ನಡ ಲಿಪಿಯಲ್ಲಿ).
   - 'hi-IN': Reply in natural, conversational Hindi (देवनागरी लिपि में).
   - 'en-IN': Reply in natural, professional Indian English.
6. GESTURE SEPARATION: Return your response strictly as a JSON object with:
   - "reply": the concise spoken answer
   - "gesture": one of "WAVE", "NOD", "IDLE"
     * "WAVE" for greetings, hellos, welcomes, and goodbyes.
     * "NOD" for answering questions, confirmations, explaining hours/plans/trainers/rules/announcements.
     * "IDLE" for neutral statements, uncertain queries, or when directing to reception.
`;

/**
 * Build authoritative grounding context dynamically from PostgreSQL (Truth Source)
 * @param {string} langCode - Language code for FAQ selection
 * @returns {Promise<string>} Grounding context string
 */
export async function buildGroundingContext(langCode = 'en-IN') {
  try {
    const [profile, plans, trainers, faqs, announcements] = await Promise.all([
      getGymProfile().catch(() => null),
      getMembershipPlans({ activeOnly: true }).catch(() => []),
      getTrainers().catch(() => []),
      getFaqs({ language: langCode }).catch(() => []),
      getAnnouncements({ activeOnly: true }).catch(() => []),
    ]);

    let hoursText = '';
    if (profile?.operating_hours && Array.isArray(profile.operating_hours)) {
      hoursText = profile.operating_hours
        .map((h) => {
          if (h.is_closed) return `${h.day}: Closed`;
          if (Array.isArray(h.shifts) && h.shifts.length > 0) {
            const slotsStr = h.shifts
              .map((s, idx) => {
                let sText = `Slot ${idx + 1}: ${s.open} to ${s.close} [Class: ${s.class_type || 'General Gym'}]`;
                if (s.note) sText += ` (${s.note})`;
                return sText;
              })
              .join(' & ');
            return `${h.day}: ${slotsStr}`;
          }
          let time = `${h.open} to ${h.close}`;
          if (h.class_type) time += ` [Class: ${h.class_type}]`;
          if (h.note) time += ` (${h.note})`;
          if (h.shift2_open && h.shift2_close) {
            time += ` & Evening Shift: ${h.shift2_open} to ${h.shift2_close}`;
            if (h.shift2_class_type) time += ` [Class: ${h.shift2_class_type}]`;
            if (h.shift2_note) time += ` (${h.shift2_note})`;
          }
          return `${h.day}: ${time}`;
        })
        .join(', ');
    } else {
      hoursText = 'Monday - Saturday: 05:30 to 22:30, Sunday: 07:00 to 13:00';
    }

    const plansText = (plans || [])
      .map((p) => `- ${p.name}: ₹${Number(p.price_inr).toLocaleString('en-IN')} (${p.duration_months} mo). Perks: ${(p.perks || []).join(', ')}`)
      .join('\n');

    // Privacy Protection: Strip trainers' private personal phone and email!
    const trainersText = (trainers || [])
      .map((t) => `- ${t.full_name}: ${t.specialty} (Status: ${t.status || 'on_floor'}, Shift: ${t.shift_hours || 'Morning/Evening'})`)
      .join('\n');

    const announcementsText = (announcements || [])
      .map((a) => `- ${a.title} [${a.priority.toUpperCase()}]: ${a.message}`)
      .join('\n');

    const faqsText = (faqs || [])
      .slice(0, 8)
      .map((f) => `Q: ${f.question} | A: ${f.answer}`)
      .join('\n');

    return `
AUTHORITATIVE GYM DATA (DATABASE TRUTH SOURCE):
Gym Name: ${profile?.gym_name || 'Virtex Fitness'}
Tagline: ${profile?.tagline || 'AI-Powered Smart Fitness Reception'}
Contact: Phone: ${profile?.phone || '+91 98765 43210'}, Email: ${profile?.email || 'reception@virtexfitness.in'}
Address: ${profile?.address || '42, 100 Feet Road, Indiranagar, Bengaluru, Karnataka 560038'}
Guest Wi-Fi: ${profile?.wifi_ssid || 'Virtex-Gym-Guest'}

Operating Hours:
${hoursText}

Active Membership Plans & Pricing (INR):
${plansText || '- No membership plans are currently listed. Ask the visitor to enquire at the front desk for pricing.'}

Trainer Roster & Availability:
${trainersText || '- No trainers are currently listed.'}

Active Announcements & Club Notices:
${announcementsText || '- No active announcements.'}

Facilities & Amenities:
- Digital biometric lockers, hot water showers, steam room, hydration stations, and high-speed Wi-Fi.

Gym Rules & Floor Etiquette:
- Clean indoor athletic shoes and workout towels are mandatory on the fitness floor.
- Members must re-rack free weights and wipe down machines after use.

Enquiries & Membership Registration:
- Non-members and visitors can submit an enquiry form at the kiosk or speak to front desk reception.
- Free 1-day trial workout passes are available upon consultation with staff.

Workout & Fitness Guidance:
- General safe fitness advice: Warm up for 5-10 minutes, maintain continuous hydration, use controlled form, and stretch afterwards.
- For personalized nutrition or workout programming, consult our certified trainers on the floor. FitBot does not provide medical or prescription fitness plans.

Frequently Asked Questions & Answers:
${faqsText || '- No FAQs are currently configured.'}
`.trim();
  } catch (err) {
    console.warn('[GeminiService] Error building grounding context:', err.message);
    return 'Gym: Virtex Fitness. Hours: Mon-Sat 5:30-22:30, Sun 7:00-13:00.';
  }
}

/**
 * Sanitize member context to guarantee no private records or PII are sent to LLM
 * @param {object|null} memberContext
 * @returns {object|null}
 */
export function sanitizeMemberContext(memberContext) {
  if (!memberContext || typeof memberContext !== 'object') return null;

  const allowed = ['firstName', 'name', 'membershipPlan', 'membershipTier'];
  const sanitized = {};
  for (const key of allowed) {
    if (memberContext[key] !== undefined) {
      sanitized[key] = String(memberContext[key]).substring(0, 50);
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

/**
 * Call Google Gemini API securely from the backend
 * @param {object} params
 * @param {string} params.message
 * @param {string} params.language
 * @param {string} params.groundingContext
 * @param {object|null} [params.memberContext]
 * @returns {Promise<{ reply: string, gesture: string }>}
 */
export async function callGeminiAPI({ message, language, groundingContext, memberContext = null }) {
  if (!config.ai.geminiApiKey) {
    throw new Error('GEMINI_API_KEY is not configured in backend environment.');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${config.ai.geminiModel}:generateContent?key=${config.ai.geminiApiKey}`;

  const sanitizedMember = sanitizeMemberContext(memberContext);
  const userPrompt = `${groundingContext}

User Query: "${message}"
Target Language: ${language}
${sanitizedMember ? `Member Context: ${JSON.stringify(sanitizedMember)}` : ''}

Respond in strict JSON with keys "reply" and "gesture" ("WAVE", "NOD", or "IDLE").`;

  const controller = new AbortController();
  const timeoutMs = config.ai.timeoutMs || 8000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        systemInstruction: {
          parts: [{ text: GYM_RECEPTIONIST_SYSTEM_PROMPT }],
        },
        generationConfig: {
          temperature: 0.2, // Low temperature for high factual accuracy
          topP: 0.8,
          maxOutputTokens: 250,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              reply: { type: 'STRING' },
              gesture: { type: 'STRING', enum: ['WAVE', 'NOD', 'IDLE'] },
            },
            required: ['reply', 'gesture'],
          },
        },
      }),
    });

    clearTimeout(timeoutId);

    if (res.status === 429) {
      throw new Error('Gemini API rate limit exceeded (HTTP 429).');
    }

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Gemini API error (HTTP ${res.status}): ${errorText.substring(0, 150)}`);
    }

    const data = await res.json();
    const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawContent) {
      throw new Error('Gemini API returned empty candidate text.');
    }

    const parsed = JSON.parse(rawContent);
    let gesture = (parsed.gesture || 'NOD').toUpperCase();
    if (gesture === 'WAVE') gesture = 'GREET_WAVE';
    else if (gesture === 'NOD') gesture = 'NOD_YES';
    else if (gesture === 'IDLE') gesture = 'IDLE';

    return {
      reply: parsed.reply || 'Welcome to Virtex Fitness! How can I assist you?',
      gesture,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Gemini API request timed out after ${timeoutMs}ms.`);
    }
    throw err;
  }
}

/**
 * Intelligent rule-based local fallback grounded on PostgreSQL data
 * Used when Gemini API key is unset, rate-limited, or encountering network errors.
 * @param {object} params
 * @returns {{ reply: string, gesture: string }}
 */
export function generateFallbackResponse({ message, language = 'en-IN' }) {
  const normLang = normalizeLanguage(language);
  const text = (message || '').trim().toLowerCase();

  let reply = '';
  let gesture = 'NOD_YES';

  const hasWord = (word) => new RegExp(`\\b${word}\\b`, 'i').test(text);

  // 1. GREETINGS & CHECK-IN
  if (
    hasWord('hello') ||
    hasWord('hi') ||
    hasWord('hey') ||
    text.includes('namaste') ||
    text.includes('namaskara') ||
    text.includes('good morning') ||
    text.includes('good evening') ||
    text.includes('ನಮಸ್ಕಾರ') ||
    text.includes('ಹಲೋ') ||
    text.includes('नमस्ते') ||
    text.includes('हेलो')
  ) {
    gesture = 'GREET_WAVE';
    switch (normLang) {
      case 'kn-IN':
        reply = 'ನಮಸ್ಕಾರ! Virtex Fitness ಗೆ ಸುಸ್ವಾಗತ! ಇಂದು ನಿಮ್ಮ ವ್ಯಾಯಾಮಕ್ಕೆ ನಾನು ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?';
        break;
      case 'hi-IN':
        reply = 'नमस्ते! Virtex Fitness में आपका स्वागत है! आज आपकी कसरत में मैं क्या सहायता कर सकता हूँ?';
        break;
      case 'en-IN':
      default:
        reply = 'Hello! Welcome to Virtex Fitness. How can I assist you with your workout session today?';
        break;
    }
  }

  // 2. TIMINGS / OPERATING HOURS
  else if (
    text.includes('timing') ||
    text.includes('hours') ||
    text.includes('open') ||
    text.includes('close') ||
    text.includes('schedule') ||
    text.includes('samaya') ||
    text.includes('ಸಮಯ') ||
    text.includes('ತೆರೆದಿರುತ್ತದೆ') ||
    text.includes('समय') ||
    text.includes('खुलता') ||
    text.includes('बंद')
  ) {
    gesture = 'NOD_YES';
    switch (normLang) {
      case 'kn-IN':
        reply = 'ನಮ್ಮ ಜಿಮ್ ಸೋಮವಾರದಿಂದ ಶನಿವಾರದವರೆಗೆ ಬೆಳಿಗ್ಗೆ 5:30 ರಿಂದ ರಾತ್ರಿ 10:30 ರವರೆಗೆ ಮತ್ತು ಭಾನುವಾರ ಬೆಳಿಗ್ಗೆ 7:00 ರಿಂದ ಮಧ್ಯಾಹ್ನ 1:00 ರವರೆಗೆ ತೆರೆದಿರುತ್ತದೆ.';
        break;
      case 'hi-IN':
        reply = 'हमारा जिम सोमवार से शनिवार सुबह 5:30 से रात 10:30 बजे तक और रविवार को सुबह 7:00 से दोपहर 1:00 बजे तक खुला रहता है।';
        break;
      case 'en-IN':
      default:
        reply = 'Virtex Fitness is open Monday through Saturday from 5:30 AM to 10:30 PM, and Sundays from 7:00 AM to 1:00 PM.';
        break;
    }
  }

  // 2B. GROUP CLASSES & GYM SESSIONS
  else if (
    text.includes('class') ||
    text.includes('group class') ||
    text.includes('zumba') ||
    text.includes('yoga') ||
    text.includes('batch') ||
    text.includes('ಕ್ಲಾಸ್') ||
    text.includes('ತರಗತಿ') ||
    text.includes('ಜುಂಬಾ') ||
    text.includes('ಯೋಗ') ||
    text.includes('क्लास') ||
    text.includes('जुम्बा') ||
    text.includes('योग') ||
    text.includes('बैच')
  ) {
    gesture = 'NOD_YES';
    switch (normLang) {
      case 'kn-IN':
        reply = 'ಪಲ್ಸ್‌ಕೋರ್ ಫಿಟ್‌ನೆಸ್‌ನಲ್ಲಿ ಜನರಲ್ ಜಿಮ್ ಜೊತೆಗೆ ಜುಂಬಾ, ಯೋಗ ಮತ್ತು ಎಚ್‌ಐಐಟಿ (HIIT) ಗ್ರೂಪ್ ಕ್ಲಾಸ್‌ಗಳು ನಡೆಯುತ್ತವೆ. ದೈನಂದಿನ ಬ್ಯಾಚ್ ವೇಳಾಪಟ್ಟಿಗಾಗಿ ನಮ್ಮ ರಿಸೆಪ್ಷನ್ ಅಥವಾ ಕಿಯೋಸ್ಕ್ ಡಿಸ್‌ಪ್ಲೇ ಪರಿಶೀಲಿಸಿ!';
        break;
      case 'hi-IN':
        reply = 'पल्सकोर फिटनेस में जनरल जिम के साथ-साथ जुम्बा, योग और एचआईआईटी (HIIT) ग्रुप क्लासेस उपलब्ध हैं। दैनिक बैच टाइमिंग के लिए रिसेप्शन या कियोस्क शेड्यूल देखें!';
        break;
      case 'en-IN':
      default:
        reply = 'Virtex Fitness offers open gym access along with high-energy Group Classes including Zumba, Yoga, and HIIT. Check our reception schedule for today’s morning and evening batches!';
        break;
    }
  }

  // 3. MEMBERSHIP PLANS & PRICING
  else if (
    text.includes('membership') ||
    text.includes('plan') ||
    text.includes('price') ||
    text.includes('fee') ||
    text.includes('cost') ||
    text.includes('shulka') ||
    text.includes('rate') ||
    text.includes('ಫೀಸ್') ||
    text.includes('ಶುಲ್ಕ') ||
    text.includes('ಸದಸ್ಯತ್ವ') ||
    text.includes('ಪ್ಲಾನ್') ||
    text.includes('फीस') ||
    text.includes('शुल्क') ||
    text.includes('सदस्यता') ||
    text.includes('प्लान')
  ) {
    gesture = 'NOD_YES';
    switch (normLang) {
      case 'kn-IN':
        reply = 'ನಮ್ಮಲ್ಲಿ ಮಾಸಿಕ (₹2,499), ತ್ರೈಮಾಸಿಕ (₹6,499) ಮತ್ತು ವಾರ್ಷಿಕ (₹19,999) ಸದಸ್ಯತ್ವ ಯೋಜನೆಗಳಿವೆ. ವಾರ್ಷಿಕ ಪ್ಲಾನ್‌ನಲ್ಲಿ ಉಚಿತ ಡಯಟ್ ಚಾರ್ಟ್ ಮತ್ತು ತರಬೇತಿ ಸೇರಿದೆ!';
        break;
      case 'hi-IN':
        reply = 'हमारे पास मासिक (₹2,499), त्रैमासिक (₹6,499) और वार्षिक (₹19,999) प्लान उपलब्ध हैं। वार्षिक सदस्यता में मुफ़्त डायट चार्ट और निजी कोचिंग शामिल है!';
        break;
      case 'en-IN':
      default:
        reply = 'We offer Monthly at ₹2,499, Quarterly at ₹6,499, and Annual Elite at ₹19,999. Annual memberships include a complimentary body composition analysis and diet consultation!';
        break;
    }
  }

  // 4. PERSONAL TRAINERS & COACHES
  else if (
    text.includes('trainer') ||
    text.includes('coach') ||
    text.includes('personal training') ||
    text.includes('tarabethi') ||
    text.includes('arjun') ||
    text.includes('meera') ||
    text.includes('karan') ||
    text.includes('ತರಬೇತುದಾರ') ||
    text.includes('ಕೋಚ್') ||
    text.includes('ಟ್ರೈನರ್') ||
    text.includes('ಅರ್ಜುನ್') ||
    text.includes('ಮೀರಾ') ||
    text.includes('करण') ||
    text.includes('ट्रेनर') ||
    text.includes('प्रशिक्षक') ||
    text.includes('कोच') ||
    text.includes('अर्जुन') ||
    text.includes('मीरा')
  ) {
    gesture = 'NOD_YES';
    switch (normLang) {
      case 'kn-IN':
        reply = 'ನಮ್ಮ ಪ್ರಮಾಣೀಕೃತ ವೈಯಕ್ತಿಕ ತರಬೇತುದಾರರು ಸಾಮರ್ಥ್ಯ ಮತ್ತು ತೂಕ ನಿರ್ವಹಣೆ ವಿಭಾಗದಲ್ಲಿ ಲಭ್ಯವಿದ್ದಾರೆ. ನೀವು 1-on-1 ಟ್ರಯಲ್ ಸೆಷನ್ ಬುಕ್ ಮಾಡಲು ಬಯಸುವಿರಾ?';
        break;
      case 'hi-IN':
        reply = 'हमारे प्रमाणित निजी ट्रेनर फ्लोर पर उपलब्ध हैं जो शक्ति और कार्डियो में विशेषज्ञ हैं। क्या आप 1-on-1 ट्रायल सत्र बुक करना चाहते हैं?';
        break;
      case 'en-IN':
      default:
        reply = 'Certified personal trainers are available on the workout floor specializing in strength, fat loss, and CrossFit. Would you like to schedule a trial assessment?';
        break;
    }
  }

  // 5. ANNOUNCEMENTS & NOTICES
  else if (
    text.includes('announcement') ||
    text.includes('notice') ||
    text.includes('event') ||
    text.includes('challenge') ||
    text.includes('bootcamp') ||
    text.includes('diwali') ||
    text.includes('maintenance') ||
    text.includes('ಅನೌನ್ಸ್‌ಮೆಂಟ್') ||
    text.includes('ಸೂಚನೆ') ||
    text.includes('ಕಾರ್ಯಕ್ರಮ') ||
    text.includes('ಸ್ಪರ್ಧೆ') ||
    text.includes('ಬೂಟ್‌ಕ್ಯಾಂಪ್') ||
    text.includes('ಘೋಷಣೆ') ||
    text.includes('सूचना') ||
    text.includes('इवेंट') ||
    text.includes('चुनौती') ||
    text.includes('बूटकैंप')
  ) {
    gesture = 'NOD_YES';
    switch (normLang) {
      case 'kn-IN':
        reply = 'ನಮ್ಮಲ್ಲಿ 30 ದಿನಗಳ ಲೀನ್ & ಸ್ಟ್ರಾಂಗ್ ಬೂಟ್‌ಕ್ಯಾಂಪ್ ನೋಂದಣಿ ನಡೆಯುತ್ತಿದೆ, ಮತ್ತು ಈ ಗುರುವಾರ ಮಧ್ಯಾಹ್ನ 2 ರಿಂದ 4 ರವರೆಗೆ ಸ್ಟೀಮ್ ರೂಮ್ ನಿರ್ವಹಣೆ ಇರುತ್ತದೆ.';
        break;
      case 'hi-IN':
        reply = 'हमारे 30-दिवसीय लीन एंड स्ट्रांग बूटकैंप के लिए पंजीकरण खुला है, और इस गुरुवार दोपहर 2 से 4 बजे स्टीम रूम का नियमित रखरखाव होगा।';
        break;
      case 'en-IN':
      default:
        reply = 'We have our 30-Day Lean and Strong Bootcamp challenge currently open for registration, and the steam room has routine maintenance this Thursday from 2 to 4 PM.';
        break;
    }
  }

  // 6. ENQUIRIES & HOW TO JOIN / TRIAL PASS
  else if (
    text.includes('enquiry') ||
    text.includes('inquiry') ||
    text.includes('join') ||
    text.includes('trial') ||
    text.includes('register') ||
    text.includes('admission') ||
    text.includes('sign up') ||
    text.includes('pass') ||
    text.includes('ಸೇರಲು') ||
    text.includes('ವಿಚಾರಣೆ') ||
    text.includes('ಟ್ರಯಲ್') ||
    text.includes('ದಾಖಲಾತಿ') ||
    text.includes('ನೋಂದಣಿ') ||
    text.includes('पूछताछ') ||
    text.includes('ज्वाइन') ||
    text.includes('ट्रायल') ||
    text.includes('दाखिला') ||
    text.includes('रजिस्टर')
  ) {
    gesture = 'NOD_YES';
    switch (normLang) {
      case 'kn-IN':
        reply = 'ನೀವು ಕಿಯೋಸ್ಕ್ ಪರದೆಯಲ್ಲೇ ಸದಸ್ಯತ್ವ ವಿಚಾರಣೆ ನಮೂದಿಸಬಹುದು ಅಥವಾ ಉಚಿತ 1 ದಿನದ ಟ್ರಯಲ್ ತರಬೇತಿಗಾಗಿ ನಮ್ಮ ರಿಸೆಪ್ಷನ್ ಸಿಬ್ಬಂದಿಯನ್ನು ಸಂಪರ್ಕಿಸಬಹುದು!';
        break;
      case 'hi-IN':
        reply = 'आप कियोस्क स्क्रीन पर सदस्यता पूछताछ दर्ज कर सकते हैं या 1-दिवसीय मुफ्त ट्रायल वर्कआउट के लिए हमारे रिसेप्शन स्टाफ से संपर्क कर सकते हैं!';
        break;
      case 'en-IN':
      default:
        reply = 'You can submit a membership enquiry or request a free 1-day trial workout right here at the kiosk screen or by speaking with our front desk staff!';
        break;
    }
  }

  // 7. WORKOUTS & FITNESS GUIDANCE
  else if (
    text.includes('workout') ||
    text.includes('exercise') ||
    text.includes('fitness') ||
    text.includes('routine') ||
    text.includes('muscle') ||
    text.includes('weight loss') ||
    text.includes('warm up') ||
    text.includes('warmup') ||
    text.includes('diet') ||
    text.includes('cardio') ||
    text.includes('ವ್ಯಾಯಾಮ') ||
    text.includes('ಫಿಟ್‌ನೆಸ್') ||
    text.includes('ಕಸರತ್ತು') ||
    text.includes('ತೂಕ') ||
    text.includes('ವಾರಂಪ್') ||
    text.includes('कसरत') ||
    text.includes('व्यायाम') ||
    text.includes('फिटनेस') ||
    text.includes('वजन घटाने') ||
    text.includes('वार्मअप')
  ) {
    gesture = 'NOD_YES';
    switch (normLang) {
      case 'kn-IN':
        reply = 'ಸುರಕ್ಷಿತ ವ್ಯಾಯಾಮಕ್ಕಾಗಿ 5 ನಿಮಿಷಗಳ ವಾರ್ಮ್-ಅಪ್ ಮಾಡಿ, ಸಾಕಷ್ಟು ನೀರು ಕುಡಿಯಿರಿ ಮತ್ತು ಸರಿಯಾದ ಭಂಗಿ ಕಾಪಾಡಿಕೊಳ್ಳಿ. ವೈಯಕ್ತಿಕ ಪ್ಲಾನ್‌ಗಾಗಿ ನಮ್ಮ ಫ್ಲೋರ್ ತರಬೇತುದಾರರನ್ನು ಸಂಪರ್ಕಿಸಿ!';
        break;
      case 'hi-IN':
        reply = 'सुरक्षित कसरत के लिए 5 मिनट वार्म-अप से शुरुआत करें, भरपूर पानी पिएं और सही फॉर्म बनाए रखें। व्यक्तिगत वर्कआउट प्लान के लिए हमारे ट्रेनर्स से मिलें!';
        break;
      case 'en-IN':
      default:
        reply = 'For safe workouts, start with a 5-minute warm-up, stay well-hydrated, and practice controlled form. For custom workout plans, our floor trainers will gladly guide you!';
        break;
    }
  }

  // 8. GYM RULES & ETIQUETTE
  else if (
    text.includes('rule') ||
    text.includes('policy') ||
    text.includes('shoe') ||
    text.includes('towel') ||
    text.includes('dress code') ||
    text.includes('hygiene') ||
    text.includes('ನಿಯಮ') ||
    text.includes('ಶೂ') ||
    text.includes('ಟವಲ್') ||
    text.includes('ನಡವಳಿಕೆ') ||
    text.includes('ನೀತಿಸಂಹಿತೆ') ||
    text.includes('नियम') ||
    text.includes('जूते') ||
    text.includes('तौलिया') ||
    text.includes('ड्रेस कोड')
  ) {
    gesture = 'NOD_YES';
    switch (normLang) {
      case 'kn-IN':
        reply = 'ಫಿಟ್‌ನೆಸ್ ಫ್ಲೋರ್‌ನಲ್ಲಿ ಸ್ವಚ್ಛವಾದ ಶೂಗಳು ಮತ್ತು ಟವೆಲ್ ಧರಿಸುವುದು ಕಡ್ಡಾಯವಾಗಿದೆ. ದಯವಿಟ್ಟು ಉಪಕರಣಗಳನ್ನು ಬಳಸಿದ ನಂತರ ಸ್ವಚ್ಛಗೊಳಿಸಿ ಮತ್ತು ವೇಯ್ಟ್‌ಗಳನ್ನು ಮರಳಿ ಇರಿಸಿ.';
        break;
      case 'hi-IN':
        reply = 'फिटनेस फ्लोर पर साफ जूते और तौलिया लाना अनिवार्य है। कृपया इस्तेमाल के बाद मशीनों को पोंछें और वजन सही जगह पर रखें।';
        break;
      case 'en-IN':
      default:
        reply = 'Clean indoor athletic shoes and workout towels are mandatory on the fitness floor. Please wipe down machines and re-rack weights after use.';
        break;
    }
  }

  // 9. AMENITIES, LOCKERS & SHOWERS
  else if (
    text.includes('locker') ||
    text.includes('shower') ||
    text.includes('water') ||
    text.includes('steam') ||
    text.includes('wifi') ||
    text.includes('facility') ||
    text.includes('amenit') ||
    text.includes('ಲಾಕರ್') ||
    text.includes('ಶವರ್') ||
    text.includes('ಸ್ಟೀಮ್') ||
    text.includes('ವೈಫೈ') ||
    text.includes('ಸೌಲಭ್ಯ') ||
    text.includes('लॉकर') ||
    text.includes('शावर') ||
    text.includes('स्टीम') ||
    text.includes('वाईफाई') ||
    text.includes('सुविधा')
  ) {
    gesture = 'NOD_YES';
    switch (normLang) {
      case 'kn-IN':
        reply = 'ನಮ್ಮಲ್ಲಿ ಡಿಜಿಟಲ್ ಲಾಕರ್‌ಗಳು, ಬಿಸಿ ನೀರಿನ ಶವರ್‌ಗಳು, ಫಿಲ್ಟರ್ ಮಾಡಿದ ಕುಡಿಯುವ ನೀರು ಮತ್ತು ಸ್ಟೀಮ್ ಬಾತ್ ಲಭ್ಯವಿದೆ. ದಯವಿಟ್ಟು ಸ್ವಚ್ಛವಾದ ಶೂಗಳನ್ನು ಧರಿಸಿ.';
        break;
      case 'hi-IN':
        reply = 'हमारे पास डिजिटल लॉकर, गर्म पानी के शावर, स्वच्छ पेयजल और स्टीम रूम उपलब्ध हैं। कृपया वर्कआउट के लिए साफ जूते और तौलिया साथ रखें।';
        break;
      case 'en-IN':
      default:
        reply = 'We provide secure digital lockers, hot water showers, filtered hydration stations, and steam rooms. Clean indoor athletic shoes and workout towels are mandatory.';
        break;
    }
  }

  // 10. CONTACT INFORMATION & LOCATION
  else if (
    text.includes('contact') ||
    text.includes('phone') ||
    text.includes('email') ||
    text.includes('address') ||
    text.includes('location') ||
    text.includes('reach') ||
    text.includes('ಕರೆ') ||
    text.includes('ವಿಳಾಸ') ||
    text.includes('ದೂರವಾಣಿ') ||
    text.includes('फ़ोन') ||
    text.includes('पता') ||
    text.includes('संपर्क')
  ) {
    gesture = 'NOD_YES';
    switch (normLang) {
      case 'kn-IN':
        reply = 'ನಮ್ಮನ್ನು +91 98765 43210 ಗೆ ಕರೆ ಮಾಡಿ ಅಥವಾ reception@virtexfitness.in ಗೆ ಇಮೇಲ್ ಮಾಡಿ. ನಮ್ಮ ವಿಳಾಸ: 42, 100 Feet Road, Indiranagar, Bengaluru.';
        break;
      case 'hi-IN':
        reply = 'आप हमें +91 98765 43210 पर कॉल कर सकते हैं या reception@virtexfitness.in पर ईमेल कर सकते हैं। पता: 42, 100 फीट रोड, इंदिरानगर, बेंगलुरु।';
        break;
      case 'en-IN':
      default:
        reply = 'You can reach reception at +91 98765 43210 or email reception@virtexfitness.in. We are located at 42, 100 Feet Road, Indiranagar, Bengaluru.';
        break;
    }
  }

  // 11. MISSING DATA DIRECTIVE (Never invent data; direct to reception)
  else {
    gesture = 'IDLE';
    switch (normLang) {
      case 'kn-IN':
        reply = 'ಕ್ಷಮಿಸಿ, ನನ್ನ ಬಳಿ ಆ ನಿರ್ದಿಷ್ಟ ಮಾಹಿತಿ ಲಭ್ಯವಿಲ್ಲ. ದಯವಿಟ್ಟು ನಮ್ಮ ಮುಂಭಾಗದ ರಿಸೆಪ್ಷನ್ ಕೌಂಟರ್‌ನಲ್ಲಿ ಮಾತನಾಡಿ ಅಥವಾ +91 98765 43210 ಗೆ ಕರೆ ಮಾಡಿ!';
        break;
      case 'hi-IN':
        reply = 'क्षमा करें, मेरे पास यह विशिष्ट जानकारी उपलब्ध नहीं है। कृपया अधिक जानकारी के लिए हमारे फ्रंट डेस्क रिसेप्शन से संपर्क करें या +91 98765 43210 पर कॉल करें!';
        break;
      case 'en-IN':
      default:
        reply = "I don't have those specific details on hand. Please speak with our reception desk staff at +91 98765 43210 who will be happy to assist you!";
        break;
    }
  }

  return {
    reply,
    gesture,
  };
}

/**
 * Main conversational dispatcher
 * @param {object} params
 * @param {string} params.message
 * @param {string} params.language
 * @param {object|null} [params.memberContext]
 * @returns {Promise<{ reply: string, gesture: string, language: string, source: string }>}
 */
export async function generateReceptionistResponse({ message, language = 'en-IN', memberContext = null }) {
  const normLang = normalizeLanguage(language);

  // 1. Build Grounding Context from PostgreSQL
  const groundingContext = await buildGroundingContext(normLang);

  // 2. Try Gemini API if API key is present
  if (config.ai.geminiApiKey) {
    try {
      const geminiResult = await callGeminiAPI({
        message,
        language: normLang,
        groundingContext,
        memberContext,
      });

      return {
        reply: geminiResult.reply,
        gesture: geminiResult.gesture,
        language: normLang,
        source: 'gemini',
      };
    } catch (err) {
      console.warn(`[GeminiService] Gemini API call bypassed (${err.message}). Engaging grounded fallback.`);
    }
  }

  // 3. Resilient Grounded Fallback
  const fallback = generateFallbackResponse({ message, language: normLang });
  return {
    reply: fallback.reply,
    gesture: fallback.gesture,
    language: normLang,
    source: 'grounded_rules',
  };
}
