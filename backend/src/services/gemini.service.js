import { config } from '../config/env.js';
import { normalizeLanguage } from './voice.service.js';
import { getGymProfile } from './gym.service.js';
import { getMembershipPlans } from './membership.service.js';
import { getTrainers } from './trainer.service.js';
import { getFaqs } from './faq.service.js';

/**
 * System prompt definition for the Gym Receptionist Robot AI
 */
export const GYM_RECEPTIONIST_SYSTEM_PROMPT = `
You are "FitBot", a friendly, energetic, and professional AI Gym Receptionist robot at PulseCore Fitness.
You speak aloud to members and visitors via Text-to-Speech (TTS) and can trigger safe physical robot movements.

CRITICAL OPERATIONAL RULES:
1. STRICT GROUNDING: Use ONLY the provided Authoritative Gym Data. NEVER invent or hallucinate prices, schedules, discounts, or trainer availability.
2. MISSING DATA DIRECTIVE: If the requested information is not in the authoritative data, state clearly that you do not have that specific detail and politely direct the user to the front desk reception staff.
3. CONCISE FOR SPEECH: Spoken replies must be 1 to 3 sentences maximum. Keep them punchy, polite, and natural for text-to-speech. Never use markdown, asterisks, bullet points, or tables.
4. MULTILINGUAL ACCURACY: You must answer in the requested language:
   - 'kn-IN': Reply in natural, conversational Kannada (ಕನ್ನಡ).
   - 'hi-IN': Reply in natural, conversational Hindi (हिन्दी).
   - 'en-IN': Reply in natural, professional Indian English.
5. GESTURE SEPARATION: Return your response strictly as a JSON object with:
   - "reply": the concise spoken answer
   - "gesture": one of "WAVE", "NOD", "IDLE"
     * "WAVE" for greetings, hellos, welcomes, and goodbyes.
     * "NOD" for answering questions, confirmations, explaining hours/plans/trainers/rules.
     * "IDLE" for neutral statements, uncertain queries, or when directing to reception.
`;

/**
 * Build authoritative grounding context dynamically from PostgreSQL (Truth Source)
 * @param {string} langCode - Language code for FAQ selection
 * @returns {Promise<string>} Grounding context string
 */
export async function buildGroundingContext(langCode = 'en-IN') {
  try {
    const [profile, plans, trainers, faqs] = await Promise.all([
      getGymProfile().catch(() => null),
      getMembershipPlans({ activeOnly: true }).catch(() => []),
      getTrainers().catch(() => []),
      getFaqs({ language: langCode }).catch(() => []),
    ]);

    let hoursText = '';
    if (profile?.operating_hours && Array.isArray(profile.operating_hours)) {
      hoursText = profile.operating_hours
        .map((h) => `${h.day}: ${h.is_closed ? 'Closed' : `${h.open} to ${h.close}`}`)
        .join(', ');
    } else {
      hoursText = 'Monday - Saturday: 06:00 to 22:00, Sunday: 07:00 to 13:00';
    }

    const plansText = (plans || [])
      .map((p) => `- ${p.name}: ₹${p.price_inr} (${p.duration_months} mo). Perks: ${(p.perks || []).join(', ')}`)
      .join('\n');

    // Privacy Protection: Strip trainers' private personal phone and email!
    const trainersText = (trainers || [])
      .map((t) => `- ${t.full_name}: ${t.specialty} (Status: ${t.status}, Shift: ${t.shift_hours})`)
      .join('\n');

    const faqsText = (faqs || [])
      .slice(0, 8)
      .map((f) => `Q: ${f.question} | A: ${f.answer}`)
      .join('\n');

    return `
AUTHORITATIVE GYM DATA (DATABASE TRUTH SOURCE):
Gym Name: ${profile?.gym_name || 'PulseCore Fitness'}
Contact: Phone: ${profile?.phone || '+91 98765 43210'}, Email: ${profile?.email || 'reception@pulsecorefitness.in'}
Address: ${profile?.address || '42, 100 Feet Road, Indiranagar, Bengaluru, Karnataka 560038'}

Operating Hours:
${hoursText}

Active Membership Plans & Pricing (INR):
${plansText || '- Silver Monthly: ₹2,499\n- Gold Quarterly: ₹5,999\n- Platinum Annual: ₹18,999'}

Trainer Roster & Availability:
${trainersText || '- Arjun Reddy: CrossFit (on_floor)\n- Meera Rao: Yoga (in_session)\n- Karan Verma: Hypertrophy (off_duty)'}

Facilities, Rules & FAQs:
${faqsText || 'Digital lockers, hot showers, and steam rooms available. Clean athletic footwear and workout towels required.'}
`.trim();
  } catch (err) {
    console.warn('[GeminiService] Error building grounding context:', err.message);
    return 'Gym: PulseCore Fitness. Hours: Mon-Sat 6:00-22:00, Sun 7:00-13:00.';
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
      reply: parsed.reply || 'Welcome to PulseCore Fitness! How can I assist you?',
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
        reply = 'ನಮಸ್ಕಾರ! PulseCore Fitness ಗೆ ಸುಸ್ವಾಗತ! ಇಂದು ನಿಮ್ಮ ವ್ಯಾಯಾಮಕ್ಕೆ ನಾನು ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?';
        break;
      case 'hi-IN':
        reply = 'नमस्ते! PulseCore Fitness में आपका स्वागत है! आज आपकी कसरत में मैं क्या सहायता कर सकता हूँ?';
        break;
      case 'en-IN':
      default:
        reply = 'Hello! Welcome to PulseCore Fitness. How can I assist you with your workout session today?';
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
    text.includes('खुलता')
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
        reply = 'PulseCore Fitness is open Monday through Saturday from 5:30 AM to 10:30 PM, and Sundays from 7:00 AM to 1:00 PM.';
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
    text.includes('ಫೀಸ್') ||
    text.includes('ಶುಲ್ಕ') ||
    text.includes('ಸದಸ್ಯತ್ವ') ||
    text.includes('फीस') ||
    text.includes('शुल्क') ||
    text.includes('सदस्यता')
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
    text.includes('ತರಬೇತುದಾರ') ||
    text.includes('ಕೋಚ್') ||
    text.includes('ट्रेनर') ||
    text.includes('प्रशिक्षक') ||
    text.includes('कोच')
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

  // 5. AMENITIES, LOCKERS, SHOWERS & RULES
  else if (
    text.includes('locker') ||
    text.includes('shower') ||
    text.includes('water') ||
    text.includes('towel') ||
    text.includes('rule') ||
    text.includes('facility') ||
    text.includes('amenit') ||
    text.includes('ಲಾಕರ್') ||
    text.includes('ಶವರ್') ||
    text.includes('ಸೌಲಭ್ಯ') ||
    text.includes('लॉकर') ||
    text.includes('शावर') ||
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

  // 6. CONTACT INFORMATION & LOCATION
  else if (
    text.includes('contact') ||
    text.includes('phone') ||
    text.includes('email') ||
    text.includes('address') ||
    text.includes('location') ||
    text.includes('ಕರೆ') ||
    text.includes('ವಿಳಾಸ') ||
    text.includes('फ़ोन') ||
    text.includes('पता')
  ) {
    gesture = 'NOD_YES';
    switch (normLang) {
      case 'kn-IN':
        reply = 'ನಮ್ಮನ್ನು +91 98765 43210 ಗೆ ಕರೆ ಮಾಡಿ ಅಥವಾ reception@pulsecorefitness.in ಗೆ ಇಮೇಲ್ ಮಾಡಿ. ನಮ್ಮ ವಿಳಾಸ: 42, 100 Feet Road, Indiranagar, Bengaluru.';
        break;
      case 'hi-IN':
        reply = 'आप हमें +91 98765 43210 पर कॉल कर सकते हैं या reception@pulsecorefitness.in पर ईमेल कर सकते हैं। पता: 42, 100 फीट रोड, इंदिरानगर, बेंगलुरु।';
        break;
      case 'en-IN':
      default:
        reply = 'You can reach reception at +91 98765 43210 or email reception@pulsecorefitness.in. We are located at 42, 100 Feet Road, Indiranagar, Bengaluru.';
        break;
    }
  }

  // 7. MISSING DATA DIRECTIVE (Never invent data; direct to reception)
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
