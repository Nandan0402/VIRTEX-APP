import * as faqService from '../services/faq.service.js';
import { broadcast } from '../services/realtime.service.js';

/**
 * GET /api/faqs
 * Returns knowledge base Q&As with optional query filters (?language=en-IN&category=timings&q=hours)
 */
export async function getFaqs(req, res, next) {
  try {
    const { language, category, q } = req.query;
    const activeOnly = req.query.all === 'true' ? false : true;
    const faqs = await faqService.getFaqs({ language, category, q, activeOnly });
    res.json({
      success: true,
      count: faqs.length,
      data: faqs,
    });
  } catch (err) {
    next(err);
  }
}

export async function createFaq(req, res, next) {
  try {
    const { question, answer, language = 'en-IN', category = 'general', gesture, suggestedGesture, keywords } = req.body;
    if (!question || !answer) {
      return res.status(400).json({ success: false, error: 'Question and answer are required.' });
    }

    const created = await faqService.createFaq({
      question,
      answer,
      language,
      category,
      suggestedGesture: suggestedGesture || gesture || 'NOD_YES',
      keywords: Array.isArray(keywords) ? keywords : keywords ? keywords.split(',').map((k) => k.trim()) : [],
    });

    broadcast('FAQ_CREATED', created, { channel: 'all', triggeredBy: req.user?.username || 'admin' });
    res.status(201).json({
      success: true,
      message: 'FAQ created successfully.',
      data: created,
    });
  } catch (err) {
    next(err);
  }
}

export async function updateFaq(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    const updated = await faqService.updateFaq(id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'FAQ not found.' });
    }

    broadcast('FAQ_UPDATED', updated, { channel: 'all', triggeredBy: req.user?.username || 'admin' });
    res.json({
      success: true,
      message: 'FAQ updated successfully.',
      data: updated,
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteFaq(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    await faqService.deleteFaq(id);
    broadcast('FAQ_DELETED', { id }, { channel: 'all', triggeredBy: req.user?.username || 'admin' });
    res.json({
      success: true,
      message: 'FAQ deleted successfully.',
      data: { id },
    });
  } catch (err) {
    next(err);
  }
}


