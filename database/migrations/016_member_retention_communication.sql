-- Migration 016: Member Retention & Communication System Expansion
-- Integrates email templates, push notification campaigns, automated renewal reminders,
-- inactive member follow-ups, member feedback (NPS), complaint management tickets,
-- communication history logs, audience segmentation, and campaign performance reports.

-- 1. Retention Email Templates
CREATE TABLE IF NOT EXISTS retention_email_templates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'renewal', -- 'renewal', 'inactive_followup', 'announcement', 'feedback', 'promotional', 'welcome'
  subject VARCHAR(255) NOT NULL,
  body_html TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Audience Segmentation Definitions
CREATE TABLE IF NOT EXISTS retention_audience_segments (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL, -- 'all_active', 'inactive_14_days', 'inactive_30_days', 'expiring_in_7_days', 'expired_members', 'new_joiners'
  description TEXT,
  filter_criteria JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Push Notification & Retention Blast Campaigns
CREATE TABLE IF NOT EXISTS retention_campaigns (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  campaign_type VARCHAR(50) NOT NULL, -- 'push_notification', 'email_blast', 'renewal_reminder', 'inactive_followup', 'member_announcement'
  target_segment_code VARCHAR(50) NOT NULL DEFAULT 'all_active',
  template_id INTEGER REFERENCES retention_email_templates(id) ON DELETE SET NULL,
  message_title VARCHAR(255),
  message_body TEXT NOT NULL,
  action_url VARCHAR(255),
  status VARCHAR(30) NOT NULL DEFAULT 'draft', -- 'draft', 'scheduled', 'running', 'completed', 'cancelled'
  scheduled_at TIMESTAMPTZ,
  sent_count INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  opened_count INTEGER NOT NULL DEFAULT 0,
  clicked_count INTEGER NOT NULL DEFAULT 0,
  converted_count INTEGER NOT NULL DEFAULT 0,
  created_by VARCHAR(100) DEFAULT 'Admin',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_retention_camp_status ON retention_campaigns(status);

-- 4. Unified Communication History Logs
CREATE TABLE IF NOT EXISTS member_communication_logs (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES retention_campaigns(id) ON DELETE SET NULL,
  channel VARCHAR(30) NOT NULL, -- 'email', 'push_notification', 'sms', 'renewal_reminder', 'announcement'
  direction VARCHAR(10) NOT NULL DEFAULT 'outbound', -- 'outbound', 'inbound'
  subject VARCHAR(255),
  message TEXT NOT NULL,
  delivery_status VARCHAR(20) NOT NULL DEFAULT 'delivered', -- 'queued', 'sent', 'delivered', 'opened', 'failed'
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  sent_by VARCHAR(100) NOT NULL DEFAULT 'Virtex Retention Engine',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_comm_logs_member ON member_communication_logs(member_id);
CREATE INDEX IF NOT EXISTS idx_comm_logs_channel ON member_communication_logs(channel);
CREATE INDEX IF NOT EXISTS idx_comm_logs_date ON member_communication_logs(created_at);

-- 5. Member Feedback & NPS Surveys
CREATE TABLE IF NOT EXISTS member_feedbacks (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  nps_score INTEGER NOT NULL CHECK (nps_score BETWEEN 0 AND 10),
  category VARCHAR(50) NOT NULL DEFAULT 'General', -- 'Equipment & Cleanliness', 'Trainer Quality', 'Facilities & Amenities', 'Front Desk & Support', 'Class Scheduling', 'General'
  sentiment VARCHAR(20) NOT NULL DEFAULT 'neutral', -- 'positive', 'neutral', 'negative'
  feedback_text TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'reviewed', -- 'new', 'reviewed', 'action_taken', 'archived'
  admin_response TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feedback_sentiment ON member_feedbacks(sentiment);

-- 6. Member Complaints Management & Resolution Tickets
CREATE TABLE IF NOT EXISTS member_complaints (
  id SERIAL PRIMARY KEY,
  ticket_number VARCHAR(50) UNIQUE NOT NULL,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL, -- 'Equipment Malfunction', 'Billing Issue', 'Locker Room Cleanliness', 'Trainer Conduct', 'Class Cancellation', 'Other'
  priority VARCHAR(20) NOT NULL DEFAULT 'medium', -- 'low', 'medium', 'high', 'urgent'
  subject VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  resolution_notes TEXT,
  assigned_to VARCHAR(100) DEFAULT 'Duty Manager',
  status VARCHAR(30) NOT NULL DEFAULT 'open', -- 'open', 'in_progress', 'resolved', 'closed'
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_complaints_status ON member_complaints(status);
CREATE INDEX IF NOT EXISTS idx_complaints_priority ON member_complaints(priority);

-- Seed Initial Templates, Audience Segments, Feedback, Complaints, and Sample Campaigns
DO $$
DECLARE
  v_tpl_renewal INTEGER;
  v_tpl_dormant INTEGER;
  v_tpl_feedback INTEGER;
  v_tpl_holiday INTEGER;
  v_mem_1 INTEGER;
  v_mem_2 INTEGER;
  v_mem_3 INTEGER;
  v_camp_1 INTEGER;
BEGIN
  -- 1. Seed Audience Segments
  INSERT INTO retention_audience_segments (name, code, description, filter_criteria)
  VALUES 
    ('All Active Members', 'all_active', 'Every member with status active', '{"status":"active"}'::jsonb),
    ('Expiring in 7 Days', 'expiring_in_7_days', 'Members with fee due date or plan expiration within next 7 days', '{"days_to_due":7}'::jsonb),
    ('Expiring in 14 Days', 'expiring_in_14_days', 'Members with renewal window opening within 14 days', '{"days_to_due":14}'::jsonb),
    ('Inactive / Dormant (14+ Days)', 'inactive_14_days', 'Members who have not checked in or completed routines for 14 days', '{"inactive_days":14}'::jsonb),
    ('Inactive / Dormant (30+ Days)', 'inactive_30_days', 'Critical churn-risk members without activity for 30+ days', '{"inactive_days":30}'::jsonb),
    ('Outstanding Fee Balance', 'outstanding_fees', 'Members with fee_due > 0 requiring payment reminders', '{"fee_due_gt":0}'::jsonb),
    ('VIP Platinum Plan Holders', 'vip_platinum', 'High-value long-term membership plan holders', '{"plan":"Platinum Annual"}'::jsonb)
  ON CONFLICT (code) DO NOTHING;

  -- 2. Seed Email Templates
  INSERT INTO retention_email_templates (name, category, subject, body_html)
  VALUES 
    (
      '7-Day Membership Renewal Notice',
      'renewal',
      'Your Virtex Gym Membership is expiring in 7 days!',
      '<div style="font-family:sans-serif;padding:20px;background:#11141e;color:#fff;"><h2>Keep Your Momentum Going, {{member_name}}! ⚡</h2><p>Your <strong>{{plan_name}}</strong> membership expires on <strong>{{expiry_date}}</strong>.</p><p>Renew early today at the reception desk or app and claim a <strong>10% loyalty discount</strong> plus 1 complimentary Personal Training consultation.</p><p style="margin-top:20px;"><a href="{{renewal_url}}" style="background:#00e676;color:#000;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:bold;">Renew Membership Online</a></p></div>'
    )
    RETURNING id INTO v_tpl_renewal;

  INSERT INTO retention_email_templates (name, category, subject, body_html)
  VALUES 
    (
      'We Miss You at the Gym! (Dormant Win-Back)',
      'inactive_followup',
      'We noticed you haven''t been in lately, {{member_name}}! Are you okay? 🏋️',
      '<div style="font-family:sans-serif;padding:20px;background:#11141e;color:#fff;"><h2>We Miss Having You On the Floor! ❤️</h2><p>Hey {{member_name}},</p><p>Your workout partners and trainers at Virtex noticed your locker key has been waiting for you! Consistency is key, and whether life got busy or you need a workout reboot, our team is here to help.</p><p>Drop in this week and get a <strong>free InBody body-composition scan</strong> and a tailored routine tune-up!</p></div>'
    )
    RETURNING id INTO v_tpl_dormant;

  INSERT INTO retention_email_templates (name, category, subject, body_html)
  VALUES 
    (
      'Quarterly Facility & Trainer Feedback Survey',
      'feedback',
      'How was your gym experience this month? Help us level up! 🌟',
      '<div style="font-family:sans-serif;padding:20px;background:#11141e;color:#fff;"><h2>Your Feedback Shapes Virtex 🌟</h2><p>Hi {{member_name}},</p><p>We strive to deliver the cleanest machines, best trainers, and energizing vibe. Could you take 60 seconds to rate your recent experience?</p><p><a href="{{survey_url}}" style="background:#00b0ff;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:bold;">Take 1-Minute Survey</a></p></div>'
    )
    RETURNING id INTO v_tpl_feedback;

  INSERT INTO retention_email_templates (name, category, subject, body_html)
  VALUES 
    (
      'Special Holiday Gym Schedule Announcement',
      'announcement',
      'Important Notice: Upcoming Holiday Hours & Special Group Fitness Classes',
      '<div style="font-family:sans-serif;padding:20px;background:#11141e;color:#fff;"><h2>Virtex Holiday Training Schedule 🗓️</h2><p>Dear {{member_name}},</p><p>Please note our revised holiday floor timings and special festive HIIT & Yoga masterclasses. Recovery sauna and steam suites remain open until 8:00 PM.</p></div>'
    )
    RETURNING id INTO v_tpl_holiday;

  -- 3. Select sample members for seeding logs, feedbacks, and complaints
  SELECT id INTO v_mem_1 FROM members WHERE email IS NOT NULL ORDER BY id LIMIT 1;
  SELECT id INTO v_mem_2 FROM members WHERE id != COALESCE(v_mem_1, 0) ORDER BY id LIMIT 1;
  SELECT id INTO v_mem_3 FROM members WHERE id NOT IN (COALESCE(v_mem_1, 0), COALESCE(v_mem_2, 0)) ORDER BY id LIMIT 1;

  IF v_mem_1 IS NOT NULL THEN
    -- 4. Seed Campaigns
    INSERT INTO retention_campaigns (
      title, campaign_type, target_segment_code, template_id, message_title, message_body,
      status, scheduled_at, sent_count, delivered_count, opened_count, clicked_count, converted_count, created_by
    )
    VALUES 
      (
        'November Auto-Renewal Push & Email Blast',
        'renewal_reminder',
        'expiring_in_7_days',
        v_tpl_renewal,
        'Membership Renewal Window Open',
        'Your membership renewal deadline is approaching in 7 days. Renew now to preserve your founding member rates!',
        'completed',
        CURRENT_TIMESTAMP - INTERVAL '2 days',
        42, 42, 36, 19, 14,
        'Nandan.B'
      )
      RETURNING id INTO v_camp_1;

    INSERT INTO retention_campaigns (
      title, campaign_type, target_segment_code, template_id, message_title, message_body,
      status, scheduled_at, sent_count, delivered_count, opened_count, clicked_count, converted_count, created_by
    )
    VALUES 
      (
        'Dormant Member Comeback Week (14-Day Re-engagement)',
        'inactive_followup',
        'inactive_14_days',
        v_tpl_dormant,
        'We miss you! Free workout pass & shaker inside',
        'Drop by Virtex this weekend for an energizing restart session with coach consultation included.',
        'running',
        CURRENT_TIMESTAMP - INTERVAL '1 day',
        28, 28, 21, 11, 7,
        'Nandan.B'
      ),
      (
        'Flash Push Announcement: New Eleiko Benches Arrived',
        'push_notification',
        'all_active',
        NULL,
        'New Free-Weight Gear on Gym Floor! 🏋️',
        'New commercial competition benches and urethane dumbbells have been installed in Free Weight Zone A. Check them out today!',
        'completed',
        CURRENT_TIMESTAMP - INTERVAL '5 days',
        85, 84, 76, 52, 48,
        'Nandan.B'
      );

    -- 5. Seed Communication Logs
    INSERT INTO member_communication_logs (
      member_id, campaign_id, channel, direction, subject, message, delivery_status, opened_at, clicked_at, sent_by
    )
    VALUES 
      (
        v_mem_1, v_camp_1, 'email', 'outbound',
        'Your Virtex Gym Membership is expiring in 7 days!',
        'Hi Rahul, your Platinum Annual plan is expiring on 2026-11-16. Renew today to get 10% loyalty perk.',
        'opened', CURRENT_TIMESTAMP - INTERVAL '1 day', CURRENT_TIMESTAMP - INTERVAL '22 hours',
        'Virtex Retention Engine'
      ),
      (
        v_mem_1, NULL, 'renewal_reminder', 'outbound',
        'SMS: Virtex Renewal Alert',
        'Your membership expires soon. Visit reception or app to renew without interruption.',
        'delivered', NULL, NULL,
        'Automated Cron Job'
      );

    IF v_mem_2 IS NOT NULL THEN
      INSERT INTO member_communication_logs (
        member_id, campaign_id, channel, direction, subject, message, delivery_status, opened_at, clicked_at, sent_by
      )
      VALUES 
        (
          v_mem_2, NULL, 'push_notification', 'outbound',
          'Dormant Re-engagement Push',
          'Hey Priya, we miss you at the gym! Join us for Zumba tonight at 6 PM.',
          'opened', CURRENT_TIMESTAMP - INTERVAL '3 hours', CURRENT_TIMESTAMP - INTERVAL '2 hours',
          'Retention Engine'
        );
    END IF;

    -- 6. Seed Member Feedbacks (NPS)
    INSERT INTO member_feedbacks (
      member_id, nps_score, category, sentiment, feedback_text, status, admin_response
    )
    VALUES 
      (
        v_mem_1, 10, 'Trainer Quality', 'positive',
        'Coach Ramesh is incredible! His periodized strength coaching helped me hit a 180kg deadlift safely. Facilities are super clean.',
        'reviewed', 'Thank you so much! Shared your praise with Coach Ramesh.'
      );

    IF v_mem_2 IS NOT NULL THEN
      INSERT INTO member_feedbacks (
        member_id, nps_score, category, sentiment, feedback_text, status, admin_response
      )
      VALUES 
        (
          v_mem_2, 8, 'Equipment & Cleanliness', 'positive',
          'Love the new Woodway treadmills and cable attachments. Locker rooms are always fresh.',
          'reviewed', 'Glad you are enjoying the new cardio deck!'
        );
    END IF;

    IF v_mem_3 IS NOT NULL THEN
      INSERT INTO member_feedbacks (
        member_id, nps_score, category, sentiment, feedback_text, status, admin_response
      )
      VALUES 
        (
          v_mem_3, 6, 'Front Desk & Support', 'neutral',
          'Peak hours between 7-8 PM get very crowded near the dumbbell racks. Might need a 2nd set of 15kg dumbbells.',
          'action_taken', 'Ordered twin pair of 15kg & 17.5kg dumbbells under PO-2026-001.'
        );
    END IF;

    -- 7. Seed Member Complaints
    INSERT INTO member_complaints (
      ticket_number, member_id, category, priority, subject, description, resolution_notes, assigned_to, status, resolved_at
    )
    VALUES 
      (
        'CMP-2026-001', v_mem_1, 'Equipment Malfunction', 'medium',
        'Left pulley on Cable Station 2 feels sticky during high crossover pulls',
        'The cable is squeaking slightly under 40kg load. Needs grease or cable inspection.',
        'Technician inspected and replaced cable with high-tensile 4.8mm steel core assembly on Nov 2.',
        'Maintenance Team', 'resolved', CURRENT_TIMESTAMP - INTERVAL '7 days'
      );

    IF v_mem_2 IS NOT NULL THEN
      INSERT INTO member_complaints (
        ticket_number, member_id, category, priority, subject, description, resolution_notes, assigned_to, status
      )
      VALUES 
        (
          'CMP-2026-002', v_mem_2, 'Locker Room Cleanliness', 'low',
          'Showers running low on eucalyptus body wash during morning peak (8 AM)',
          'Dispenser 3 in ladies locker room was empty yesterday morning.',
          'Refilled and instructed cleaning staff to check dispensers on 6 AM morning rounds.',
          'Housekeeping Lead', 'in_progress'
        );
    END IF;

  END IF;

END $$;

