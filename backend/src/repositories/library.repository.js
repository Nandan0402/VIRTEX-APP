/**
 * Virtex Admin - Fitness Books and Digital Library Repository
 * Secure PostgreSQL queries for book catalogue, digital uploads, e-book publishing,
 * access control, purchase history, reading progress, and document downloads.
 */

import { pool } from '../config/database.js';

// ----------------------------------------------------
// 1. BOOK CATALOGUE & PUBLISHING
// ----------------------------------------------------

export async function getBooks({ category, is_paid, access_tier, status, search } = {}) {
  let query = `
    SELECT 
      lb.id,
      lb.title,
      lb.slug,
      lb.author,
      lb.category,
      lb.description,
      lb.cover_url,
      lb.secure_file_path,
      lb.file_format,
      lb.file_size_mb,
      lb.page_count,
      lb.is_paid,
      lb.price_amount,
      lb.currency,
      lb.access_tier,
      lb.status,
      lb.downloads_count,
      lb.created_at,
      COUNT(DISTINCT bp.id) AS purchase_count,
      COUNT(DISTINCT brp.id) AS reader_count
    FROM library_books lb
    LEFT JOIN book_purchases bp ON lb.id = bp.book_id
    LEFT JOIN book_reading_progress brp ON lb.id = brp.book_id
    WHERE 1=1
  `;
  const params = [];

  if (category && category !== 'All') {
    params.push(category);
    query += ` AND lb.category = $${params.length}`;
  }
  if (is_paid !== undefined && is_paid !== 'All') {
    const isPaidBool = is_paid === 'true' || is_paid === true;
    params.push(isPaidBool);
    query += ` AND lb.is_paid = $${params.length}`;
  }
  if (access_tier && access_tier !== 'All') {
    params.push(access_tier);
    query += ` AND lb.access_tier = $${params.length}`;
  }
  if (status && status !== 'All') {
    params.push(status);
    query += ` AND lb.status = $${params.length}`;
  }
  if (search && search.trim() !== '') {
    params.push(`%${search.trim()}%`);
    query += ` AND (lb.title ILIKE $${params.length} OR lb.author ILIKE $${params.length} OR lb.description ILIKE $${params.length})`;
  }

  query += ` GROUP BY lb.id ORDER BY lb.created_at DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function getBookById(id) {
  const query = `
    SELECT 
      lb.*,
      COUNT(DISTINCT bp.id) AS purchase_count,
      COUNT(DISTINCT brp.id) AS reader_count
    FROM library_books lb
    LEFT JOIN book_purchases bp ON lb.id = bp.book_id
    LEFT JOIN book_reading_progress brp ON lb.id = brp.book_id
    WHERE lb.id = $1
    GROUP BY lb.id
  `;
  const { rows } = await pool.query(query, [id]);
  return rows[0] || null;
}

export async function createBook(data) {
  const slug = (data.title || 'book')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '') + '-' + Date.now().toString().slice(-4);

  const query = `
    INSERT INTO library_books (
      title, slug, author, category, description, cover_url, secure_file_path,
      file_format, file_size_mb, page_count, is_paid, price_amount, currency,
      access_tier, status, downloads_count, created_by_user_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 0, $16)
    RETURNING *
  `;
  const params = [
    data.title,
    slug,
    data.author,
    data.category || 'Fitness & Training',
    data.description || '',
    data.cover_url || 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=700',
    data.secure_file_path || `vault/books/${slug}.pdf`,
    data.file_format || 'PDF',
    parseFloat(data.file_size_mb) || 5.0,
    parseInt(data.page_count, 10) || 100,
    data.is_paid === true || data.is_paid === 'true',
    parseFloat(data.price_amount) || 0.00,
    data.currency || 'INR',
    data.access_tier || 'all_members',
    data.status || 'published',
    data.created_by_user_id || null
  ];
  const { rows } = await pool.query(query, params);
  return rows[0];
}

export async function updateBook(id, data) {
  const query = `
    UPDATE library_books
    SET 
      title = COALESCE($1, title),
      author = COALESCE($2, author),
      category = COALESCE($3, category),
      description = COALESCE($4, description),
      cover_url = COALESCE($5, cover_url),
      secure_file_path = COALESCE($6, secure_file_path),
      file_format = COALESCE($7, file_format),
      file_size_mb = COALESCE($8, file_size_mb),
      page_count = COALESCE($9, page_count),
      is_paid = COALESCE($10, is_paid),
      price_amount = COALESCE($11, price_amount),
      access_tier = COALESCE($12, access_tier),
      status = COALESCE($13, status),
      updated_at = NOW()
    WHERE id = $14
    RETURNING *
  `;
  const params = [
    data.title || null,
    data.author || null,
    data.category || null,
    data.description || null,
    data.cover_url || null,
    data.secure_file_path || null,
    data.file_format || null,
    data.file_size_mb ? parseFloat(data.file_size_mb) : null,
    data.page_count ? parseInt(data.page_count, 10) : null,
    data.is_paid !== undefined ? (data.is_paid === true || data.is_paid === 'true') : null,
    data.price_amount !== undefined ? parseFloat(data.price_amount) : null,
    data.access_tier || null,
    data.status || null,
    id
  ];
  const { rows } = await pool.query(query, params);
  return rows[0] || null;
}

export async function deleteBook(id) {
  const query = 'DELETE FROM library_books WHERE id = $1 RETURNING *';
  const { rows } = await pool.query(query, [id]);
  return rows[0] || null;
}

export async function incrementDownloadCount(id) {
  const query = `
    UPDATE library_books
    SET downloads_count = downloads_count + 1
    WHERE id = $1
    RETURNING downloads_count
  `;
  const { rows } = await pool.query(query, [id]);
  return rows[0]?.downloads_count || 0;
}

// ----------------------------------------------------
// 2. PURCHASE HISTORY
// ----------------------------------------------------

export async function getPurchases({ book_id, member_id } = {}) {
  let query = `
    SELECT 
      bp.id,
      bp.book_id,
      lb.title AS book_title,
      lb.category AS book_category,
      lb.cover_url,
      bp.member_id,
      m.full_name AS member_name,
      m.member_code,
      bp.amount_paid,
      bp.currency,
      bp.payment_method,
      bp.invoice_code,
      bp.purchased_at
    FROM book_purchases bp
    JOIN library_books lb ON bp.book_id = lb.id
    JOIN members m ON bp.member_id = m.id
    WHERE 1=1
  `;
  const params = [];

  if (book_id) {
    params.push(book_id);
    query += ` AND bp.book_id = $${params.length}`;
  }
  if (member_id) {
    params.push(member_id);
    query += ` AND bp.member_id = $${params.length}`;
  }

  query += ` ORDER BY bp.purchased_at DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function recordPurchase(data) {
  const invoice = data.invoice_code || `INV-BK-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const query = `
    INSERT INTO book_purchases (book_id, member_id, amount_paid, currency, payment_method, invoice_code, purchased_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    RETURNING *
  `;
  const params = [
    data.book_id,
    data.member_id,
    parseFloat(data.amount_paid) || 0.00,
    data.currency || 'INR',
    data.payment_method || 'Wallet / Card',
    invoice
  ];
  const { rows } = await pool.query(query, params);
  return rows[0];
}

// ----------------------------------------------------
// 3. READING PROGRESS TRACKING
// ----------------------------------------------------

export async function getReadingProgress({ book_id, member_id } = {}) {
  let query = `
    SELECT 
      brp.id,
      brp.book_id,
      lb.title AS book_title,
      lb.author AS book_author,
      lb.page_count AS book_total_pages,
      brp.member_id,
      m.full_name AS member_name,
      m.member_code,
      brp.current_page,
      brp.total_pages,
      brp.progress_pct,
      brp.completed,
      brp.last_read_at,
      brp.notes
    FROM book_reading_progress brp
    JOIN library_books lb ON brp.book_id = lb.id
    JOIN members m ON brp.member_id = m.id
    WHERE 1=1
  `;
  const params = [];

  if (book_id) {
    params.push(book_id);
    query += ` AND brp.book_id = $${params.length}`;
  }
  if (member_id) {
    params.push(member_id);
    query += ` AND brp.member_id = $${params.length}`;
  }

  query += ` ORDER BY brp.last_read_at DESC`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function updateReadingProgress(book_id, member_id, { current_page, total_pages, notes }) {
  const curPage = parseInt(current_page, 10) || 1;
  const totPages = parseInt(total_pages, 10) || 100;
  const progressPct = Math.min(100, Math.round((curPage / totPages) * 100));
  const completed = progressPct >= 100;

  const query = `
    INSERT INTO book_reading_progress (book_id, member_id, current_page, total_pages, progress_pct, completed, last_read_at, notes)
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
    ON CONFLICT (book_id, member_id) DO UPDATE SET
      current_page = EXCLUDED.current_page,
      total_pages = EXCLUDED.total_pages,
      progress_pct = EXCLUDED.progress_pct,
      completed = EXCLUDED.completed,
      last_read_at = NOW(),
      notes = COALESCE(EXCLUDED.notes, book_reading_progress.notes)
    RETURNING *
  `;
  const { rows } = await pool.query(query, [book_id, member_id, curPage, totPages, progressPct, completed, notes || '']);
  return rows[0];
}

// ----------------------------------------------------
// 4. LIBRARY ANALYTICS & KPIS
// ----------------------------------------------------

export async function getLibraryKpis() {
  const statsQuery = `
    SELECT 
      (SELECT COUNT(*) FROM library_books) AS total_books,
      (SELECT COUNT(DISTINCT category) FROM library_books) AS total_categories,
      (SELECT COUNT(*) FROM library_books WHERE is_paid = true) AS paid_books,
      (SELECT COUNT(*) FROM library_books WHERE is_paid = false) AS free_books,
      (SELECT COALESCE(SUM(downloads_count), 0) FROM library_books) AS total_downloads,
      (SELECT COUNT(*) FROM book_purchases) AS total_purchases,
      (SELECT COALESCE(SUM(amount_paid), 0) FROM book_purchases) AS total_revenue,
      (SELECT COUNT(DISTINCT member_id) FROM book_reading_progress) AS active_readers
  `;
  const { rows } = await pool.query(statsQuery);
  const row = rows[0] || {};

  return {
    totalBooks: parseInt(row.total_books, 10) || 0,
    totalCategories: parseInt(row.total_categories, 10) || 0,
    paidBooks: parseInt(row.paid_books, 10) || 0,
    freeBooks: parseInt(row.free_books, 10) || 0,
    totalDownloads: parseInt(row.total_downloads, 10) || 0,
    totalPurchases: parseInt(row.total_purchases, 10) || 0,
    totalRevenue: parseFloat(row.total_revenue) || 0.00,
    activeReaders: parseInt(row.active_readers, 10) || 0
  };
}

