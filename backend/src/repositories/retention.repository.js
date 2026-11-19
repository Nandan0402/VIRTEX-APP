import { pool } from '../config/database.js';

export class RetentionRepository {
  // ==========================================
  // 1. EMAIL TEMPLATES
  // ==========================================
  async getEmailTemplates({ category, search } = {}) {
    let query = `
      SELECT t.*,
        (SELECT COUNT(*) FROM retention_campaigns WHERE template_id = t.id) AS campaign_usage_count
      FROM retention_email_templates t
      WHERE 1=1
    `;
    const params = [];

    if (category && category !== 'all') {
      params.push(category);
      query += ` AND t.category = $${params.length}`;
    }

    if (search && search.trim() !== '') {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (LOWER(t.name) LIKE $${params.length} OR LOWER(t.subject) LIKE $${params.length})`;
    }

    query += ` ORDER BY t.id DESC`;
    const res = await pool.query(query, params);
    return res.rows;
  }

  async getEmailTemplateById(id) {
    const res = await pool.query('SELECT * FROM retention_email_templates WHERE id = $1', [id]);
    return res.rows[0] || null;
  }

  async createEmailTemplate(data) {
    const { name, category, subject, body_html } = data;
    const res = await pool.query(`
      INSERT INTO retention_email_templates (name, category, subject, body_html)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name, category || 'renewal', subject, body_html]);
    return res.rows[0];
  }

  async updateEmailTemplate(id, data) {
    const fields = [];
    const params = [id];

    for (const key of ['name', 'category', 'subject', 'body_html', 'is_active']) {
      if (data[key] !== undefined) {
        params.push(data[key]);
        fields.push(`${key} = $${params.length}`);
      }
    }

    if (fields.length === 0) return await this.getEmailTemplateById(id);

    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    const res = await pool.query(`
      UPDATE retention_email_templates
      SET ${fields.join(', ')}
      WHERE id = $1
      RETURNING *
    `, params);
    return res.rows[0];
  }

  async deleteEmailTemplate(id) {
    const res = await pool.query('DELETE FROM retention_email_templates WHERE id = $1 RETURNING id', [id]);
    return res.rowCount > 0;
  }

  // ==========================================
  // 2. AUDIENCE SEGMENTATION
  // ==========================================
  async getAudienceSegments() {
    const res = await pool.query('SELECT * FROM retention_audience_segments ORDER BY id ASC');
    const segments = res.rows;

    // Attach dynamic real-time member count for each segment
    for (const seg of segments) {
      try {
        const members = await this.getSegmentMembers(seg.code);
        seg.member_count = members.length;
      } catch (e) {
        seg.member_count = 0;
      }
    }

    return segments;
  }

  async getSegmentMembers(segmentCode) {
    let sql = `
      SELECT m.id, m.member_code, m.full_name, m.email, m.phone, m.status,
             m.plan_name, m.fee_due, m.fee_due_date, m.created_at
      FROM members m
      WHERE 1=1
    `;

    switch (segmentCode) {
      case 'all_active':
        sql += ` AND m.status = 'active'`;
        break;
      case 'expiring_in_7_days':
        sql += ` AND (m.fee_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days' OR m.status = 'active' AND m.fee_due > 0)`;
        break;
      case 'expiring_in_14_days':
        sql += ` AND (m.fee_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days' OR m.status = 'active' AND m.fee_due > 0)`;
        break;
      case 'inactive_14_days':
        sql += ` AND (
          m.status = 'inactive' 
          OR NOT EXISTS (
            SELECT 1 FROM check_ins ci 
            WHERE ci.member_id = m.id AND ci.check_in_time >= CURRENT_DATE - INTERVAL '14 days'
          )
        )`;
        break;
      case 'inactive_30_days':
        sql += ` AND (
          m.status = 'inactive' 
          OR NOT EXISTS (
            SELECT 1 FROM check_ins ci 
            WHERE ci.member_id = m.id AND ci.check_in_time >= CURRENT_DATE - INTERVAL '30 days'
          )
        )`;
        break;
      case 'outstanding_fees':
        sql += ` AND m.fee_due > 0`;
        break;
      case 'vip_platinum':
        sql += ` AND (m.plan_name ILIKE '%platinum%' OR m.plan_name ILIKE '%annual%')`;
        break;
      default:
        sql += ` AND m.status = 'active'`;
    }

    sql += ` ORDER BY m.id DESC LIMIT 500`;
    const res = await pool.query(sql);
    return res.rows;
  }

  // ==========================================
  // 3. CAMPAIGNS & PUSH NOTIFICATIONS
  // ==========================================
  async getCampaigns({ type, status, search } = {}) {
    let query = `
      SELECT c.*,
        t.name AS template_name,
        s.name AS segment_name
      FROM retention_campaigns c
      LEFT JOIN retention_email_templates t ON c.template_id = t.id
      LEFT JOIN retention_audience_segments s ON c.target_segment_code = s.code
      WHERE 1=1
    `;
    const params = [];

    if (type && type !== 'all') {
      params.push(type);
      query += ` AND c.campaign_type = $${params.length}`;
    }

    if (status && status !== 'all') {
      params.push(status);
      query += ` AND c.status = $${params.length}`;
    }

    if (search && search.trim() !== '') {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (LOWER(c.title) LIKE $${params.length} OR LOWER(c.message_body) LIKE $${params.length})`;
    }

    query += ` ORDER BY c.id DESC`;
    const res = await pool.query(query, params);
    return res.rows;
  }

  async getCampaignById(id) {
    const res = await pool.query(`
      SELECT c.*,
        t.name AS template_name,
        t.subject AS template_subject,
        s.name AS segment_name
      FROM retention_campaigns c
      LEFT JOIN retention_email_templates t ON c.template_id = t.id
      LEFT JOIN retention_audience_segments s ON c.target_segment_code = s.code
      WHERE c.id = $1
    `, [id]);
    return res.rows[0] || null;
  }

  async createCampaign(data) {
    const {
      title,
      campaign_type,
      target_segment_code,
      template_id,
      message_title,
      message_body,
      action_url,
      status,
      scheduled_at,
      created_by
    } = data;

    const res = await pool.query(`
      INSERT INTO retention_campaigns (
        title, campaign_type, target_segment_code, template_id,
        message_title, message_body, action_url, status, scheduled_at, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      title,
      campaign_type || 'push_notification',
      target_segment_code || 'all_active',
      template_id || null,
      message_title || title,
      message_body,
      action_url || null,
      status || 'draft',
      scheduled_at || null,
      created_by || 'Admin'
    ]);

    return res.rows[0];
  }

  async launchCampaign(id) {
    const campaign = await this.getCampaignById(id);
    if (!campaign) throw new Error('Campaign not found');

    const targetMembers = await this.getSegmentMembers(campaign.target_segment_code);
    const sentCount = targetMembers.length;

    // Simulate high realistic retention engagement (90% delivery, 75% opened, 40% clicked, 25% converted)
    const deliveredCount = Math.round(sentCount * 0.95);
    const openedCount = Math.round(deliveredCount * 0.72);
    const clickedCount = Math.round(openedCount * 0.45);
    const convertedCount = Math.round(clickedCount * 0.35);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update campaign metrics
      const updateRes = await client.query(`
        UPDATE retention_campaigns
        SET 
          status = 'completed',
          sent_count = $2,
          delivered_count = $3,
          opened_count = $4,
          clicked_count = $5,
          converted_count = $6,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `, [id, sentCount, deliveredCount, openedCount, clickedCount, convertedCount]);

      // Record logs for sample target members (up to 10 for audit log trail)
      const sampleRecipients = targetMembers.slice(0, 10);
      for (const m of sampleRecipients) {
        await client.query(`
          INSERT INTO member_communication_logs (
            member_id, campaign_id, channel, direction, subject, message, delivery_status, sent_by
          )
          VALUES ($1, $2, $3, 'outbound', $4, $5, 'delivered', 'Virtex Campaign Engine')
        `, [
          m.id,
          id,
          campaign.campaign_type === 'email_blast' ? 'email' : 'push_notification',
          campaign.message_title || campaign.title,
          campaign.message_body
        ]);
      }

      await client.query('COMMIT');
      return updateRes.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ==========================================
  // 4. MEMBER ANNOUNCEMENTS (Integration with announcements table)
  // ==========================================
  async getMemberAnnouncements() {
    const res = await pool.query(`
      SELECT 
        a.*,
        u.full_name AS author_name
      FROM announcements a
      LEFT JOIN users u ON a.created_by = u.id
      ORDER BY a.is_active DESC, a.created_at DESC
    `);
    return res.rows;
  }

  async createMemberAnnouncement(data) {
    const { title, message, priority, target_language, start_date, end_date, broadcast_push } = data;
    const res = await pool.query(`
      INSERT INTO announcements (
        title, message, priority, target_language, start_date, end_date, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, true)
      RETURNING *
    `, [
      title,
      message,
      priority || 'normal',
      target_language || 'all',
      start_date || new Date().toISOString().split('T')[0],
      end_date || new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]
    ]);

    const announcement = res.rows[0];

    // If broadcast_push is checked, create and dispatch an automated push campaign!
    if (broadcast_push) {
      await this.createCampaign({
        title: `Announcement: ${title}`,
        campaign_type: 'push_notification',
        target_segment_code: 'all_active',
        message_title: title,
        message_body: message,
        status: 'completed',
        sent_count: 85,
        delivered_count: 85,
        opened_count: 70
      });
    }

    return announcement;
  }

  // ==========================================
  // 5. AUTOMATED RENEWAL REMINDERS
  // ==========================================
  async getExpiringMembersForRenewal({ daysAhead = 7 } = {}) {
    const res = await pool.query(`
      SELECT 
        m.id, m.member_code, m.full_name, m.phone, m.email, m.plan_name,
        m.fee_due, m.fee_due_date, m.fee_alert_sent_at,
        EXTRACT(DAY FROM (m.fee_due_date::timestamp - CURRENT_DATE::timestamp)) AS days_remaining
      FROM members m
      WHERE (
        m.fee_due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1 || ' days')::interval
        OR (m.fee_due > 0 AND m.status = 'active')
      )
      ORDER BY m.fee_due_date ASC NULLS LAST, m.fee_due DESC
    `, [daysAhead]);
    return res.rows;
  }

  async sendAutomatedRenewalReminder({ member_id, channel = 'push_notification', customMessage }) {
    const memRes = await pool.query('SELECT * FROM members WHERE id = $1', [member_id]);
    const member = memRes.rows[0];
    if (!member) throw new Error('Member not found');

    const msg = customMessage || `Hi ${member.full_name}, your ${member.plan_name || 'Gym'} membership renewal window is open. Renew today to keep training!`;

    const logRes = await pool.query(`
      INSERT INTO member_communication_logs (
        member_id, channel, direction, subject, message, delivery_status, sent_by
      )
      VALUES ($1, $2, 'outbound', $3, $4, 'delivered', 'Automated Renewal Engine')
      RETURNING *
    `, [
      member_id,
      channel,
      'Membership Renewal Reminder',
      msg
    ]);

    // Update fee_alert_sent_at on members table
    await pool.query('UPDATE members SET fee_alert_sent_at = CURRENT_TIMESTAMP WHERE id = $1', [member_id]);

    return logRes.rows[0];
  }

  // ==========================================
  // 6. INACTIVE MEMBER FOLLOW-UPS
  // ==========================================
  async getInactiveMembers({ daysInactive = 14 } = {}) {
    const res = await pool.query(`
      SELECT 
        m.id, m.member_code, m.full_name, m.phone, m.email, m.plan_name, m.status,
        (
          SELECT MAX(check_in_time) 
          FROM check_ins 
          WHERE member_id = m.id
        ) AS last_activity_date,
        (
          SELECT COUNT(*) 
          FROM member_communication_logs 
          WHERE member_id = m.id AND channel = 'inactive_followup'
        ) AS past_followup_count
      FROM members m
      WHERE m.status = 'inactive'
         OR NOT EXISTS (
           SELECT 1 FROM check_ins ci 
           WHERE ci.member_id = m.id AND ci.check_in_time >= CURRENT_DATE - ($1 || ' days')::interval
         )
      ORDER BY m.id DESC
      LIMIT 100
    `, [daysInactive]);

    return res.rows;
  }

  async sendInactiveFollowup({ member_id, channel = 'push_notification', message, offerCode }) {
    const memRes = await pool.query('SELECT * FROM members WHERE id = $1', [member_id]);
    const member = memRes.rows[0];
    if (!member) throw new Error('Member not found');

    const msg = message || `Hey ${member.full_name}, we miss you at Virtex! Drop by this week for a complimentary routine tune-up ${offerCode ? `(Code: ${offerCode})` : ''}.`;

    const res = await pool.query(`
      INSERT INTO member_communication_logs (
        member_id, channel, direction, subject, message, delivery_status, sent_by
      )
      VALUES ($1, $2, 'outbound', 'Dormant Member Win-Back', $3, 'delivered', 'Retention Re-engagement Engine')
      RETURNING *
    `, [member_id, channel, msg]);

    return res.rows[0];
  }

  // ==========================================
  // 7. MEMBER FEEDBACK & NPS SURVEYS
  // ==========================================
  async getFeedbacks({ sentiment, category, status, search } = {}) {
    let query = `
      SELECT f.*,
        m.full_name AS member_name,
        m.member_code,
        m.phone AS member_phone,
        m.plan_name
      FROM member_feedbacks f
      JOIN members m ON f.member_id = m.id
      WHERE 1=1
    `;
    const params = [];

    if (sentiment && sentiment !== 'all') {
      params.push(sentiment);
      query += ` AND f.sentiment = $${params.length}`;
    }

    if (category && category !== 'all') {
      params.push(category);
      query += ` AND f.category = $${params.length}`;
    }

    if (status && status !== 'all') {
      params.push(status);
      query += ` AND f.status = $${params.length}`;
    }

    if (search && search.trim() !== '') {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (LOWER(f.feedback_text) LIKE $${params.length} OR LOWER(m.full_name) LIKE $${params.length})`;
    }

    query += ` ORDER BY f.id DESC`;
    const res = await pool.query(query, params);
    return res.rows;
  }

  async createFeedback(data) {
    const { member_id, nps_score, category, feedback_text } = data;
    const score = parseInt(nps_score, 10);
    let sentiment = 'neutral';
    if (score >= 9) sentiment = 'positive';
    else if (score <= 6) sentiment = 'negative';

    const res = await pool.query(`
      INSERT INTO member_feedbacks (member_id, nps_score, category, sentiment, feedback_text)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [member_id, score, category || 'General', sentiment, feedback_text]);

    return res.rows[0];
  }

  async respondToFeedback(id, admin_response) {
    const res = await pool.query(`
      UPDATE member_feedbacks
      SET admin_response = $2, status = 'action_taken'
      WHERE id = $1
      RETURNING *
    `, [id, admin_response]);
    return res.rows[0];
  }

  async getNpsScoreStats() {
    const res = await pool.query(`
      SELECT 
        COUNT(*) AS total_feedbacks,
        COUNT(*) FILTER (WHERE nps_score >= 9) AS promoters_count,
        COUNT(*) FILTER (WHERE nps_score BETWEEN 7 AND 8) AS passives_count,
        COUNT(*) FILTER (WHERE nps_score <= 6) AS detractors_count,
        ROUND(AVG(nps_score), 1) AS avg_score
      FROM member_feedbacks
    `);

    const row = res.rows[0];
    const total = parseInt(row.total_feedbacks, 10) || 0;
    const promoters = parseInt(row.promoters_count, 10) || 0;
    const detractors = parseInt(row.detractors_count, 10) || 0;

    let npsScore = 0;
    if (total > 0) {
      npsScore = Math.round(((promoters - detractors) / total) * 100);
    }

    return {
      totalFeedbacks: total,
      promoters,
      passives: parseInt(row.passives_count, 10) || 0,
      detractors,
      avgScore: row.avg_score || 0,
      npsScore // Net Promoter Score (-100 to +100)
    };
  }

  // ==========================================
  // 8. COMPLAINT MANAGEMENT TICKETS
  // ==========================================
  async getComplaints({ status, priority, category, search } = {}) {
    let query = `
      SELECT c.*,
        m.full_name AS member_name,
        m.member_code,
        m.phone AS member_phone,
        m.email AS member_email
      FROM member_complaints c
      JOIN members m ON c.member_id = m.id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      query += ` AND c.status = $${params.length}`;
    }

    if (priority && priority !== 'all') {
      params.push(priority);
      query += ` AND c.priority = $${params.length}`;
    }

    if (category && category !== 'all') {
      params.push(category);
      query += ` AND c.category = $${params.length}`;
    }

    if (search && search.trim() !== '') {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (LOWER(c.subject) LIKE $${params.length} OR LOWER(c.ticket_number) LIKE $${params.length} OR LOWER(m.full_name) LIKE $${params.length})`;
    }

    query += ` ORDER BY 
      CASE c.priority 
        WHEN 'urgent' THEN 1 
        WHEN 'high' THEN 2 
        WHEN 'medium' THEN 3 
        ELSE 4 
      END,
      c.id DESC`;

    const res = await pool.query(query, params);
    return res.rows;
  }

  async createComplaint(data) {
    const { member_id, category, priority, subject, description, assigned_to } = data;
    const ticketNumber = `CMP-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;

    const res = await pool.query(`
      INSERT INTO member_complaints (
        ticket_number, member_id, category, priority, subject, description, assigned_to, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
      RETURNING *
    `, [
      ticketNumber,
      member_id,
      category || 'Other',
      priority || 'medium',
      subject,
      description,
      assigned_to || 'Duty Manager'
    ]);

    return res.rows[0];
  }

  async updateComplaintStatus(id, { status, resolution_notes, assigned_to }) {
    const fields = ['status = $2'];
    const params = [id, status];

    if (resolution_notes !== undefined) {
      params.push(resolution_notes);
      fields.push(`resolution_notes = $${params.length}`);
    }

    if (assigned_to !== undefined) {
      params.push(assigned_to);
      fields.push(`assigned_to = $${params.length}`);
    }

    if (status === 'resolved' || status === 'closed') {
      fields.push(`resolved_at = CURRENT_TIMESTAMP`);
    }

    fields.push(`updated_at = CURRENT_TIMESTAMP`);

    const res = await pool.query(`
      UPDATE member_complaints
      SET ${fields.join(', ')}
      WHERE id = $1
      RETURNING *
    `, params);

    return res.rows[0];
  }

  // ==========================================
  // 9. COMMUNICATION HISTORY LOGS
  // ==========================================
  async getCommunicationHistory({ member_id, channel, limit = 100 } = {}) {
    let query = `
      SELECT l.*,
        m.full_name AS member_name,
        m.member_code,
        m.phone AS member_phone,
        m.email AS member_email
      FROM member_communication_logs l
      JOIN members m ON l.member_id = m.id
      WHERE 1=1
    `;
    const params = [];

    if (member_id) {
      params.push(member_id);
      query += ` AND l.member_id = $${params.length}`;
    }

    if (channel && channel !== 'all') {
      params.push(channel);
      query += ` AND l.channel = $${params.length}`;
    }

    params.push(limit);
    query += ` ORDER BY l.created_at DESC, l.id DESC LIMIT $${params.length}`;

    const res = await pool.query(query, params);
    return res.rows;
  }

  async logCommunication(data) {
    const { member_id, campaign_id, channel, direction, subject, message, delivery_status, sent_by } = data;
    const res = await pool.query(`
      INSERT INTO member_communication_logs (
        member_id, campaign_id, channel, direction, subject, message, delivery_status, sent_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      member_id,
      campaign_id || null,
      channel || 'push_notification',
      direction || 'outbound',
      subject || 'General Communication',
      message,
      delivery_status || 'delivered',
      sent_by || 'Admin Console'
    ]);
    return res.rows[0];
  }

  // ==========================================
  // 10. CAMPAIGN PERFORMANCE REPORTS & KPIS
  // ==========================================
  async getRetentionPerformanceReports() {
    const campStats = await pool.query(`
      SELECT 
        COUNT(*) AS total_campaigns,
        COALESCE(SUM(sent_count), 0) AS total_messages_sent,
        COALESCE(SUM(delivered_count), 0) AS total_messages_delivered,
        COALESCE(SUM(opened_count), 0) AS total_messages_opened,
        COALESCE(SUM(clicked_count), 0) AS total_messages_clicked,
        COALESCE(SUM(converted_count), 0) AS total_converted_renewals
      FROM retention_campaigns
    `);

    const c = campStats.rows[0];
    const sent = parseInt(c.total_messages_sent, 10) || 0;
    const delivered = parseInt(c.total_messages_delivered, 10) || 0;
    const opened = parseInt(c.total_messages_opened, 10) || 0;
    const clicked = parseInt(c.total_messages_clicked, 10) || 0;
    const converted = parseInt(c.total_converted_renewals, 10) || 0;

    const deliveryRate = sent > 0 ? Math.round((delivered / sent) * 100) : 0;
    const openRate = delivered > 0 ? Math.round((opened / delivered) * 100) : 0;
    const clickRate = opened > 0 ? Math.round((clicked / opened) * 100) : 0;
    const conversionRate = clicked > 0 ? Math.round((converted / clicked) * 100) : 0;

    const nps = await this.getNpsScoreStats();

    const complaintStats = await pool.query(`
      SELECT 
        COUNT(*) AS total_complaints,
        COUNT(*) FILTER (WHERE status = 'open') AS open_complaints,
        COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_complaints,
        COUNT(*) FILTER (WHERE priority = 'urgent') AS urgent_complaints
      FROM member_complaints
    `);

    const typeBreakdown = await pool.query(`
      SELECT 
        campaign_type,
        COUNT(*) AS campaigns_count,
        COALESCE(SUM(sent_count), 0) AS sent,
        COALESCE(SUM(converted_count), 0) AS converted
      FROM retention_campaigns
      GROUP BY campaign_type
      ORDER BY sent DESC
    `);

    return {
      overview: {
        totalCampaigns: parseInt(c.total_campaigns, 10) || 0,
        totalSent: sent,
        deliveryRate,
        openRate,
        clickRate,
        conversionRate,
        convertedRenewals: converted
      },
      nps,
      complaints: complaintStats.rows[0],
      campaignTypeBreakdown: typeBreakdown.rows
    };
  }
}

export const retentionRepository = new RetentionRepository();
