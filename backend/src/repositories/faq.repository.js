import { query } from '../config/database.js';

/**
 * Find FAQs with language, category, or search filters
 * @param {Object} [filter] - { language, category, q, activeOnly }
 * @param {import('pg').PoolClient} [client]
 */
export async function findFaqs({ language, category, q, activeOnly = true } = {}, client) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (activeOnly) {
    conditions.push('is_active = TRUE');
  }

  if (language) {
    conditions.push(`language = $${paramIndex++}`);
    params.push(language);
  }

  if (category) {
    conditions.push(`category = $${paramIndex++}`);
    params.push(category);
  }

  if (q) {
    conditions.push(
      `(question ILIKE $${paramIndex} OR answer ILIKE $${paramIndex} OR $${paramIndex + 1} = ANY(keywords))`
    );
    params.push(`%${q}%`);
    params.push(q.toLowerCase().trim());
    paramIndex += 2;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT id, question, answer, language, category, suggested_gesture, keywords, display_order, is_active
    FROM faqs
    ${whereClause}
    ORDER BY display_order ASC, id ASC;
  `;

  const executor = client || { query };
  const result = await executor.query(sql, params);
  return result.rows;
}

/**
 * Find FAQ by ID
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 */
export async function findFaqById(id, client) {
  const sql = `
    SELECT id, question, answer, language, category, suggested_gesture, keywords, display_order, is_active
    FROM faqs
    WHERE id = $1
    LIMIT 1;
  `;
  const executor = client || { query };
  const result = await executor.query(sql, [id]);
  return result.rows[0] || null;
}

/**
 * Create a new FAQ entry
 * @param {Object} faqData
 * @param {import('pg').PoolClient} [client]
 */
export async function createFaq(faqData, client) {
  const {
    question,
    answer,
    language = 'en-IN',
    category = 'general',
    suggestedGesture = 'NOD_YES',
    keywords = [],
    displayOrder = 10,
  } = faqData;

  const sql = `
    INSERT INTO faqs (question, answer, language, category, suggested_gesture, keywords, display_order, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
    RETURNING id, question, answer, language, category, suggested_gesture, keywords, display_order, is_active, created_at;
  `;

  const executor = client || { query };
  const result = await executor.query(sql, [
    question,
    answer,
    language,
    category,
    suggestedGesture,
    keywords,
    displayOrder,
  ]);
  return result.rows[0];
}

/**
 * Update an existing FAQ entry
 * @param {number} id
 * @param {Object} faqData
 * @param {import('pg').PoolClient} [client]
 */
export async function updateFaq(id, faqData, client) {
  const { question, answer, language, category, suggestedGesture, keywords, displayOrder, isActive } = faqData;

  const sql = `
    UPDATE faqs
    SET question = COALESCE($1, question),
        answer = COALESCE($2, answer),
        language = COALESCE($3, language),
        category = COALESCE($4, category),
        suggested_gesture = COALESCE($5, suggested_gesture),
        keywords = COALESCE($6, keywords),
        display_order = COALESCE($7, display_order),
        is_active = COALESCE($8, is_active),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $9
    RETURNING id, question, answer, language, category, suggested_gesture, keywords, display_order, is_active, updated_at;
  `;

  const executor = client || { query };
  const result = await executor.query(sql, [
    question,
    answer,
    language,
    category,
    suggestedGesture,
    keywords,
    displayOrder,
    isActive,
    id,
  ]);
  return result.rows[0] || null;
}

/**
 * Delete an FAQ entry
 * @param {number} id
 * @param {import('pg').PoolClient} [client]
 */
export async function deleteFaq(id, client) {
  const sql = `
    DELETE FROM faqs
    WHERE id = $1
    RETURNING id;
  `;
  const executor = client || { query };
  const result = await executor.query(sql, [id]);
  return result.rows[0] || null;
}


