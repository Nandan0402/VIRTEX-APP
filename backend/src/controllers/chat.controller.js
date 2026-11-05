import { generateReceptionistResponse } from '../services/gemini.service.js';
import * as robotService from '../services/robot.service.js';
import { SUPPORTED_LANGUAGES, getLanguageMetadata } from '../services/voice.service.js';

/**
 * POST /api/v1/chat/message
 * Handles user query via text or speech recognition
 */
export async function sendMessage(req, res, next) {
  try {
    const { message, language = 'en-IN', memberContext } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Message string is required.',
      });
    }

    // Call conversational receptionist service
    const response = await generateReceptionistResponse({
      message,
      language,
      memberContext,
    });

    // Auto-trigger the choreographed robot physical gesture
    if (response.gesture && robotService.GESTURES[response.gesture]) {
      robotService.queueGesture(response.gesture);
    }

    const voiceMeta = getLanguageMetadata(response.language);

    res.json({
      success: true,
      data: {
        reply: response.reply,
        gesture: response.gesture,
        language: response.language,
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

