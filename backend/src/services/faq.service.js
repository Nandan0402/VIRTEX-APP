import { query, isDatabaseConnected } from '../config/database.js';

const MOCK_FAQS = [
  {
    id: 1,
    question: 'What are your gym operating hours?',
    answer: 'We are open Monday through Saturday from 6:00 AM to 10:00 PM, and Sundays from 7:00 AM to 1:00 PM.',
    language: 'en-IN',
    category: 'timings',
    suggested_gesture: 'NOD_YES',
    keywords: ['hours', 'timing', 'open', 'close'],
  },
  {
    id: 2,
    question: 'How much are the membership plans?',
    answer: 'We offer Silver Monthly at ₹2,499, Gold Quarterly at ₹5,999, and Platinum Annual at ₹18,999 with 24/7 access.',
    language: 'en-IN',
    category: 'pricing',
    suggested_gesture: 'NOD_YES',
    keywords: ['membership', 'price', 'fee', 'cost'],
  },
  {
    id: 3,
    question: 'Are certified personal trainers available?',
    answer: 'Yes! Certified trainers Arjun Reddy and Meera Rao are available on the workout floor right now.',
    language: 'en-IN',
    category: 'trainers',
    suggested_gesture: 'LOOK_RIGHT',
    keywords: ['trainer', 'coach', 'personal trainer'],
  },
  {
    id: 4,
    question: 'ಜಿಮ್ ತೆರೆಯುವ ಸಮಯ ಎಷ್ಟು?',
    answer: 'ನಮ್ಮ ಜಿಮ್ ಸೋಮವಾರದಿಂದ ಶನಿವಾರದವರೆಗೆ ಬೆಳಿಗ್ಗೆ 6:00 ರಿಂದ ರಾತ್ರಿ 10:00 ರವರೆಗೆ ತೆರೆದಿರುತ್ತದೆ.',
    language: 'kn-IN',
    category: 'timings',
    suggested_gesture: 'NOD_YES',
    keywords: ['ಸಮಯ', 'ತೆರೆಯುವುದು'],
  },
  {
    id: 5,
    question: 'जिम का समय क्या है?',
    answer: 'हमारा जिम सोमवार से शनिवार सुबह 6:00 से रात 10:00 बजे तक खुला रहता है।',
    language: 'hi-IN',
    category: 'timings',
    suggested_gesture: 'NOD_YES',
    keywords: ['समय', 'टाइमिंग'],
  },
];

/**
 * Fetch FAQs with optional language, category, and keyword search filters
 * @param {object} filter - { language, category, q }
 */
export async function getFaqs({ language, category, q } = {}) {
  if (isDatabaseConnected()) {
    const conditions = ['is_active = TRUE'];
    const params = [];
    let paramIndex = 1;

    if (language) {
      conditions.push(`language = $${paramIndex++}`);
      params.push(language);
    }

    if (category) {
      conditions.push(`category = $${paramIndex++}`);
      params.push(category);
    }

    if (q) {
      conditions.push(`(question ILIKE $${paramIndex} OR answer ILIKE $${paramIndex} OR $${paramIndex + 1} = ANY(keywords))`);
      params.push(`%${q}%`);
      params.push(q.toLowerCase().trim());
      paramIndex += 2;
    }

    const sql = `
      SELECT id, question, answer, language, category, suggested_gesture, keywords, display_order
      FROM faqs
      WHERE ${conditions.join(' AND ')}
      ORDER BY display_order ASC, id ASC;
    `;

    const result = await query(sql, params);
    return result.rows;
  }

  // Fallback mock filtering
  return MOCK_FAQS.filter((f) => {
    if (language && f.language !== language) return false;
    if (category && f.category !== category) return false;
    if (q) {
      const needle = q.toLowerCase();
      const matchQ = f.question.toLowerCase().includes(needle);
      const matchA = f.answer.toLowerCase().includes(needle);
      const matchK = f.keywords.some((k) => k.toLowerCase().includes(needle));
      if (!matchQ && !matchA && !matchK) return false;
    }
    return true;
  });
}

