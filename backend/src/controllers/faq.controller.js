import * as faqService from '../services/faq.service.js';

/**
 * GET /api/faqs
 * Returns knowledge base Q&As with optional query filters (?language=en-IN&category=timings&q=hours)
 */
export async function getFaqs(req, res, next) {
  try {
    const { language, category, q } = req.query;
    const faqs = await faqService.getFaqs({ language, category, q });
    res.json({
      success: true,
      count: faqs.length,
      data: faqs,
    });
  } catch (err) {
    next(err);
  }
}

