import { generateReceptionistResponse } from '../services/gemini.service.js';
import * as robotService from '../services/robot.service.js';
import * as interactionService from '../services/interaction.service.js';
import { SUPPORTED_LANGUAGES, getLanguageMetadata } from '../services/voice.service.js';

/**
 * Detect high-level conversational intent for audit analytics
 * @param {string} text
 * @returns {string}
 */
export function detectQueryIntent(text) {
  const t = (text || '').toLowerCase();
  if (/\b(hello|hi|hey|namaste|namaskara)\b|ನಮಸ್ಕಾರ|ಹಲೋ|नमस्ते|हेलो/.test(t)) return 'greeting';
  if (/timing|hour|open|close|schedule|samaya|ಸಮಯ|ತೆರೆದಿರುತ್ತದೆ|समय|खुलता|बंद/.test(t)) return 'timings';
  if (/membership|plan|price|fee|cost|shulka|rate|ಶುಲ್ಕ|ಫೀಸ್|ಸದಸ್ಯತ್ವ|ಪ್ಲಾನ್|फीस|शुल्क|सदस्यता|प्लान/.test(t)) return 'membership_plans';
  if (/trainer|coach|personal training|pt|tarabethi|arjun|meera|karan|ತರಬೇತುದಾರ|ಕೋಚ್|ಟ್ರೈನರ್|ट्रेनर|प्रशिक्षक|कोच/.test(t)) return 'trainers';
  if (/announcement|notice|event|challenge|bootcamp|diwali|maintenance|ಅನೌನ್ಸ್‌ಮೆಂಟ್|ಸೂಚನೆ|ಕಾರ್ಯಕ್ರಮ|ಘೋಷಣೆ|सूचना|चुनौती|बूटकैंप/.test(t)) return 'announcements';
  if (/enquiry|inquiry|join|trial|register|admission|sign up|pass|ಸೇರಲು|ವಿಚಾರಣೆ|ಟ್ರಯಲ್|ದಾಖಲಾತಿ|पूछताछ|ज्वाइन|ट्रायल|दाखिला/.test(t)) return 'enquiries';
  if (/workout|exercise|fitness|routine|muscle|weight loss|warm up|diet|cardio|ವ್ಯಾಯಾಮ|ಫಿಟ್‌ನೆಸ್|ಕಸರತ್ತು|ತೂಕ|कसरत|व्यायाम|फिटनेस/.test(t)) return 'workouts';
  if (/rule|policy|shoe|hygiene|dress code|ನಿಯಮ|ಶೂ|ಟವಲ್|नियम|जूते|तौलिया/.test(t)) return 'rules';
  if (/locker|shower|steam|wifi|water|towel|amenit|facility|ಲಾಕರ್|ಶವರ್|ಸ್ಟೀಮ್|ವೈಫೈ|ಸೌಲಭ್ಯ|लॉकर|शावर|स्टीम|वाईफाई|सुविधा/.test(t)) return 'facilities';
  if (/contact|phone|email|address|location|reach|ಕರೆ|ವಿಳಾಸ|ದೂರವಾಣಿ|फ़ोन|पता|संपर्क/.test(t)) return 'contact_location';
  return 'general_query';
}

/**
 * Data Minimization Sanitizer for Interaction Logs
 * Strips phone numbers, credit card sequences, email addresses, and excessive characters
 * @param {string} text
 * @returns {string}
 */
export function sanitizeQueryForAudit(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/(?:\+91[\s-]?)?[6-9]\d{9}/g, '[PHONE_REDACTED]')
    .replace(/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, '[CARD_REDACTED]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]')
    .substring(0, 300)
    .trim();
}

/**
 * POST /api/v1/chat/message
 * Handles user query via text or speech recognition
 */
export async function sendMessage(req, res, next) {
  const startTime = Date.now();
  try {
    const { message, language = 'en-IN', memberContext, deviceId = 1, inputMethod = 'voice' } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Message string is required.',
      });
    }

    // Call conversational receptionist service (grounded on PostgreSQL)
    const response = await generateReceptionistResponse({
      message,
      language,
      memberContext,
    });

    const latencyMs = Date.now() - startTime;

    // SEPARATION OF CONCERNS:
    // Decouple AI speech response from robot physical motor movements.
    // The kiosk audio player plays response.reply; the robot hardware executes the queued motion.
    let robotCommand = null;
    let gestureCommandId = null;
    if (response.gesture && robotService.GESTURES[response.gesture]) {
      try {
        robotCommand = await robotService.queueGesture(response.gesture, {
          triggeredBy: 'ai_receptionist',
          deviceId: Number(deviceId) || 1,
        });
        gestureCommandId = robotCommand?.legacyId || robotCommand?.dbId || null;
      } catch (cmdErr) {
        console.warn('[ChatController] Could not queue robot physical gesture:', cmdErr.message);
      }
    }

    // DATA MINIMIZATION: Sanitize user query before persisting to database
    const sanitizedQuery = sanitizeQueryForAudit(message);
    const intentDetected = detectQueryIntent(message);

    // Persist interaction log with sanitized query and performance metrics
    try {
      await interactionService.logInteraction({
        memberId: memberContext?.memberId || memberContext?.id || null,
        deviceId: Number(deviceId) || 1,
        userQuery: sanitizedQuery,
        robotResponse: response.reply,
        language: response.language,
        inputMethod: inputMethod === 'text_kiosk' ? 'text_kiosk' : 'voice',
        intentDetected,
        gestureCommandId,
        latencyMs,
      });
    } catch (logErr) {
      console.warn('[ChatController] Interaction log record failed:', logErr.message);
    }

    const voiceMeta = getLanguageMetadata(response.language);

    res.json({
      success: true,
      data: {
        reply: response.reply,
        gesture: response.gesture,
        robotCommand: robotCommand
          ? {
              id: robotCommand.dbId || robotCommand.id,
              commandType: robotCommand.type || 'GESTURE',
              gestureName: robotCommand.gesture,
              status: 'pending',
            }
          : null,
        language: response.language,
        source: response.source, // 'gemini' | 'grounded_rules'
        latencyMs,
        voiceMeta,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/v1/chat/languages
 * Returns supported languages and metadata (en-IN, kn-IN, hi-IN)
 */
export async function listLanguages(req, res, next) {
  try {
    res.json({
      success: true,
      data: Object.values(SUPPORTED_LANGUAGES),
    });
  } catch (error) {
    next(error);
  }
}
