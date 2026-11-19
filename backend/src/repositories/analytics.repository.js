import { query } from '../config/database.js';

/**
 * analytics.repository.js
 * Parameterized, highly-optimized PostgreSQL aggregate queries for Virtex Admin Analytics.
 * Uses indexed columns: idx_check_ins_time, idx_interactions_created, idx_interactions_language.
 */

/**
 * Helper to build SQL date range clause
 * @param {string} column
 * @param {Object} range
 * @param {Array} params
 * @returns {string}
 */
function buildDateClause(column, { startDate, endDate }, params) {
  const clauses = [];
  if (startDate) {
    params.push(new Date(startDate).toISOString());
    clauses.push(`${column} >= $${params.length}`);
  }
  if (endDate) {
    const end = new Date(endDate);
    if (typeof endDate === 'string' && !endDate.includes('T') && !endDate.includes(':')) {
      end.setUTCHours(23, 59, 59, 999);
    }
    params.push(end.toISOString());
    clauses.push(`${column} <= $${params.length}`);
  }
  return clauses.length > 0 ? `AND ${clauses.join(' AND ')}` : '';
}

/**
 * 1. Daily Check-ins Aggregation
 * Returns daily check-in volume, breakdown by check-in method, and peak hours
 */
export async function getCheckInAnalytics({ startDate, endDate, period = 'daily' } = {}, client) {
  const executor = client || { query };
  const params = [];
  const dateClause = buildDateClause('c.check_in_time', { startDate, endDate }, params);

  const truncUnit = period === 'hourly' ? 'hour' : 'day';

  // 1. Time-series trend
  const trendSql = `
    SELECT 
      DATE_TRUNC('${truncUnit}', c.check_in_time) AS bucket,
      COUNT(*)::int AS total_checkins,
      COUNT(*) FILTER (WHERE c.check_in_method = 'kiosk_voice')::int AS voice_checkins,
      COUNT(*) FILTER (WHERE c.check_in_method = 'kiosk_manual')::int AS manual_checkins,
      COUNT(*) FILTER (WHERE c.check_in_method = 'rfid_card')::int AS rfid_checkins,
      COUNT(*) FILTER (WHERE c.check_in_method = 'mobile_qr')::int AS qr_checkins
    FROM check_ins c
    WHERE 1=1 ${dateClause}
    GROUP BY DATE_TRUNC('${truncUnit}', c.check_in_time)
    ORDER BY bucket ASC;
  `;

  // 2. Total and method distribution
  const totalsSql = `
    SELECT 
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE c.check_in_method = 'kiosk_voice')::int AS kiosk_voice,
      COUNT(*) FILTER (WHERE c.check_in_method = 'kiosk_manual')::int AS kiosk_manual,
      COUNT(*) FILTER (WHERE c.check_in_method = 'rfid_card')::int AS rfid_card,
      COUNT(*) FILTER (WHERE c.check_in_method = 'mobile_qr')::int AS mobile_qr,
      COUNT(DISTINCT c.member_id)::int AS unique_members
    FROM check_ins c
    WHERE 1=1 ${dateClause};
  `;

  // 3. Peak hours distribution (0 - 23)
  const peakHoursSql = `
    SELECT 
      EXTRACT(HOUR FROM c.check_in_time)::int AS hour_of_day,
      COUNT(*)::int AS checkin_count
    FROM check_ins c
    WHERE 1=1 ${dateClause}
    GROUP BY EXTRACT(HOUR FROM c.check_in_time)
    ORDER BY hour_of_day ASC;
  `;

  // 4. Day-of-week and hour heatmap matrix (0=Sun, 1=Mon, ..., 6=Sat)
  const heatmapSql = `
    SELECT 
      EXTRACT(DOW FROM c.check_in_time)::int AS day_of_week,
      EXTRACT(HOUR FROM c.check_in_time)::int AS hour_of_day,
      COUNT(*)::int AS count
    FROM check_ins c
    WHERE 1=1 ${dateClause}
    GROUP BY day_of_week, hour_of_day
    ORDER BY day_of_week, hour_of_day;
  `;

  const [trendRes, totalsRes, peakRes, heatmapRes] = await Promise.all([
    executor.query(trendSql, params),
    executor.query(totalsSql, params),
    executor.query(peakHoursSql, params),
    executor.query(heatmapSql, params),
  ]);

  return {
    totals: totalsRes.rows[0] || { total: 0, kiosk_voice: 0, kiosk_manual: 0, rfid_card: 0, mobile_qr: 0, unique_members: 0 },
    trend: trendRes.rows,
    peakHours: peakRes.rows,
    heatmap: heatmapRes.rows,
  };
}

/**
 * 2. Membership Enquiries Analytics
 * Status breakdown, conversion rates, and acquisition funnel
 */
export async function getEnquiryAnalytics({ startDate, endDate } = {}, client) {
  const executor = client || { query };
  const params = [];
  const dateClause = buildDateClause('e.created_at', { startDate, endDate }, params);

  const sql = `
    SELECT 
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE e.status = 'new')::int AS new_leads,
      COUNT(*) FILTER (WHERE e.status = 'contacted')::int AS contacted,
      COUNT(*) FILTER (WHERE e.status IN ('enrolled', 'converted'))::int AS enrolled,
      COUNT(*) FILTER (WHERE e.status IN ('dropped', 'closed'))::int AS dropped,
      ROUND(
        COALESCE(
          (COUNT(*) FILTER (WHERE e.status IN ('enrolled', 'converted'))::numeric / NULLIF(COUNT(*), 0)) * 100, 
          0
        ), 
        1
      )::float AS conversion_rate_pct
    FROM member_enquiries e
    WHERE 1=1 ${dateClause};
  `;

  const planBreakdownSql = `
    SELECT 
      COALESCE(e.plan_name, 'General Inquiry') AS plan_name,
      COUNT(*)::int AS count
    FROM member_enquiries e
    WHERE 1=1 ${dateClause}
    GROUP BY plan_name
    ORDER BY count DESC;
  `;

  const [summaryRes, plansRes] = await Promise.all([
    executor.query(sql, params),
    executor.query(planBreakdownSql, params),
  ]);

  return {
    summary: summaryRes.rows[0] || { total: 0, new_leads: 0, contacted: 0, enrolled: 0, dropped: 0, conversion_rate_pct: 0 },
    byPlan: plansRes.rows,
  };
}

/**
 * 3. Popular FAQs & Intents Queried
 * Identifies most common questions asked by gym visitors and members
 */
export async function getPopularFaqs({ startDate, endDate, limit = 10 } = {}, client) {
  const executor = client || { query };
  const params = [];
  const dateClause = buildDateClause('i.created_at', { startDate, endDate }, params);

  params.push(limit);
  const limitParam = `$${params.length}`;

  const sql = `
    SELECT 
      COALESCE(i.intent_detected, 'general_query') AS intent,
      COUNT(*)::int AS count,
      COUNT(*) FILTER (WHERE i.language = 'en-IN')::int AS count_en,
      COUNT(*) FILTER (WHERE i.language = 'kn-IN')::int AS count_kn,
      COUNT(*) FILTER (WHERE i.language = 'hi-IN')::int AS count_hi,
      ROUND(AVG(i.latency_ms))::int AS avg_latency_ms
    FROM interaction_logs i
    WHERE 1=1 ${dateClause}
    GROUP BY COALESCE(i.intent_detected, 'general_query')
    ORDER BY count DESC
    LIMIT ${limitParam};
  `;

  const res = await executor.query(sql, params);

  // Calculate percentage of total queries
  const totalCount = res.rows.reduce((sum, r) => sum + r.count, 0);
  const items = res.rows.map((r, idx) => ({
    rank: idx + 1,
    intent: r.intent,
    count: r.count,
    count_en: r.count_en,
    count_kn: r.count_kn,
    count_hi: r.count_hi,
    percentage: totalCount > 0 ? Number(((r.count / totalCount) * 100).toFixed(1)) : 0,
    avg_latency_ms: r.avg_latency_ms || 0,
  }));

  return {
    totalCategorized: totalCount,
    popularFaqs: items,
  };
}

/**
 * 4. Language Distribution
 * Detailed breakdown across English, Kannada, and Hindi
 */
export async function getLanguageDistribution({ startDate, endDate } = {}, client) {
  const executor = client || { query };
  const params = [];
  const dateClause = buildDateClause('i.created_at', { startDate, endDate }, params);

  const sql = `
    SELECT 
      i.language,
      COUNT(*)::int AS count,
      COUNT(*) FILTER (WHERE i.input_method = 'voice')::int AS voice_count,
      COUNT(*) FILTER (WHERE i.input_method = 'text_kiosk')::int AS text_count,
      ROUND(AVG(i.latency_ms))::int AS avg_latency_ms
    FROM interaction_logs i
    WHERE 1=1 ${dateClause}
    GROUP BY i.language
    ORDER BY count DESC;
  `;

  const res = await executor.query(sql, params);
  const total = res.rows.reduce((acc, row) => acc + row.count, 0);

  if (res.rows.length === 0) {
    return {
      total: 0,
      distribution: [
        { language: 'en-IN', languageName: 'English', count: 0, voiceCount: 0, textCount: 0, avgLatencyMs: 0, percentage: 0 },
        { language: 'kn-IN', languageName: 'Kannada (ಕನ್ನಡ)', count: 0, voiceCount: 0, textCount: 0, avgLatencyMs: 0, percentage: 0 },
        { language: 'hi-IN', languageName: 'Hindi (हिन्दी)', count: 0, voiceCount: 0, textCount: 0, avgLatencyMs: 0, percentage: 0 },
      ],
    };
  }

  const distribution = res.rows.map((row) => ({
    language: row.language,
    languageName: row.language === 'kn-IN' ? 'Kannada (ಕನ್ನಡ)' : row.language === 'hi-IN' ? 'Hindi (हिन्दी)' : 'English',
    count: row.count,
    voiceCount: row.voice_count,
    textCount: row.text_count,
    avgLatencyMs: row.avg_latency_ms || 0,
    percentage: total > 0 ? Number(((row.count / total) * 100).toFixed(1)) : 0,
  }));

  return {
    total,
    distribution,
  };
}

/**
 * 5. Trainer Availability & Floor Load
 * Live shift states, current on-floor trainers, and member-to-trainer ratio
 */
export async function getTrainerAvailabilityAnalytics(client) {
  const executor = client || { query };

  const sql = `
    SELECT 
      COUNT(*)::int AS total_trainers,
      COUNT(*) FILTER (WHERE t.status = 'on_floor')::int AS on_floor,
      COUNT(*) FILTER (WHERE t.status = 'in_session')::int AS in_session,
      COUNT(*) FILTER (WHERE t.status = 'on_break')::int AS on_break,
      COUNT(*) FILTER (WHERE t.status = 'off_duty')::int AS off_duty
    FROM trainers t;
  `;

  const activeCheckInsSql = `
    SELECT COUNT(*)::int AS today_checkins
    FROM check_ins
    WHERE check_in_time >= CURRENT_DATE;
  `;

  const rosterSql = `
    SELECT DISTINCT ON (t.id)
      t.id, t.trainer_code, t.full_name, t.specialty, t.status,
      s.shift_start, s.shift_end
    FROM trainers t
    LEFT JOIN trainer_schedules s 
      ON t.id = s.trainer_id 
      AND s.day_of_week = EXTRACT(DOW FROM CURRENT_TIMESTAMP)::smallint
    ORDER BY t.id,
      CASE t.status 
        WHEN 'on_floor' THEN 1 
        WHEN 'in_session' THEN 2 
        WHEN 'on_break' THEN 3 
        ELSE 4 
      END,
      t.full_name ASC;
  `;

  const [statusRes, checkinsRes, rosterRes] = await Promise.all([
    executor.query(sql),
    executor.query(activeCheckInsSql),
    executor.query(rosterSql),
  ]);

  const summary = statusRes.rows[0] || { total_trainers: 0, on_floor: 0, in_session: 0, on_break: 0, off_duty: 0 };
  const todayCheckins = checkinsRes.rows[0]?.today_checkins || 0;
  const onFloor = summary.on_floor || 1;
  const floorRatio = onFloor > 0 ? Number((todayCheckins / onFloor).toFixed(1)) : 0;

  return {
    summary,
    todayCheckins,
    memberTrainerRatio: `${floorRatio}:1`,
    roster: rosterRes.rows,
  };
}

/**
 * 6. Robot Hardware Uptime & Command Statistics
 */
export async function getRobotUptimeAnalytics({ startDate, endDate } = {}, client) {
  const executor = client || { query };
  const params = [];
  const dateClause = buildDateClause('created_at', { startDate, endDate }, params);

  const deviceSql = `
    SELECT id, device_uuid, device_name, status, firmware_version, battery_level, wifi_rssi, last_heartbeat
    FROM robot_devices
    ORDER BY id ASC
    LIMIT 1;
  `;

  const cmdStatsSql = `
    SELECT 
      COUNT(*)::int AS total_commands,
      COUNT(*) FILTER (WHERE status = 'executed')::int AS executed,
      COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      ROUND(AVG(execution_time_ms))::int AS avg_execution_time_ms
    FROM robot_commands
    WHERE 1=1 ${dateClause};
  `;

  const errStatsSql = `
    SELECT 
      COUNT(*)::int AS total_events,
      COUNT(*) FILTER (WHERE log_level IN ('ERROR', 'FATAL'))::int AS errors,
      COUNT(*) FILTER (WHERE log_level = 'WARN')::int AS warnings,
      COUNT(*) FILTER (WHERE event_type = 'brownout_check')::int AS brownout_events,
      COUNT(*) FILTER (WHERE event_type = 'network')::int AS wifi_drops
    FROM robot_logs
    WHERE 1=1 ${dateClause};
  `;

  const [devRes, cmdRes, errRes] = await Promise.all([
    executor.query(deviceSql),
    executor.query(cmdStatsSql, params),
    executor.query(errStatsSql, params),
  ]);

  const dev = devRes.rows[0] || {};
  const cmd = cmdRes.rows[0] || { total_commands: 0, executed: 0, delivered: 0, pending: 0, failed: 0, avg_execution_time_ms: 0 };
  const err = errRes.rows[0] || { total_events: 0, errors: 0, warnings: 0, brownout_events: 0, wifi_drops: 0 };

  // Calculate uptime percentage: 100% minus penalty for errors and dropped commands
  const failureCount = cmd.failed + err.errors;
  const totalBase = Math.max(1, cmd.total_commands + err.total_events);
  const isOnline = dev.status === 'online';
  const uptimePct = isOnline
    ? Number(Math.max(90, Math.min(100, 100 - (failureCount / totalBase) * 10)).toFixed(1))
    : 0;

  return {
    device: dev,
    uptimePercentage: uptimePct,
    commandStats: cmd,
    hardwareEvents: err,
  };
}

/**
 * 7. Paginated & Searchable Robot Command History
 */
export async function getRobotCommandHistory({ page = 1, limit = 20, search = '', status = '', startDate, endDate } = {}, client) {
  const executor = client || { query };
  const params = [];
  const clauses = [];

  if (search && search.trim().length > 0) {
    params.push(`%${search.trim()}%`);
    clauses.push(`(gesture_name ILIKE $${params.length} OR command_type ILIKE $${params.length} OR triggered_by ILIKE $${params.length})`);
  }

  if (status && status !== 'all') {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }

  if (startDate) {
    params.push(new Date(startDate).toISOString());
    clauses.push(`created_at >= $${params.length}`);
  }
  if (endDate) {
    params.push(new Date(endDate).toISOString());
    clauses.push(`created_at <= $${params.length}`);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const countSql = `SELECT COUNT(*)::int AS count FROM robot_commands ${whereClause};`;
  const countRes = await executor.query(countSql, params);
  const total = countRes.rows[0]?.count || 0;

  const offset = Math.max(0, (page - 1) * limit);
  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const dataSql = `
    SELECT id, device_id, command_type, gesture_name, servo_payload, status,
           priority, triggered_by, execution_time_ms, error_message, created_at
    FROM robot_commands
    ${whereClause}
    ORDER BY id DESC
    LIMIT ${limitParam} OFFSET ${offsetParam};
  `;

  const dataRes = await executor.query(dataSql, params);

  return {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
    commands: dataRes.rows,
  };
}

/**
 * 8. AI Latency & Performance Statistics
 * Min, Max, Avg, P95, and trend over time
 */
export async function getAiLatencyAnalytics({ startDate, endDate } = {}, client) {
  const executor = client || { query };
  const params = [];
  const dateClause = buildDateClause('created_at', { startDate, endDate }, params);

  const statsSql = `
    SELECT 
      COUNT(*)::int AS total_interactions,
      ROUND(COALESCE(AVG(latency_ms), 0))::int AS avg_latency_ms,
      COALESCE(MIN(latency_ms), 0)::int AS min_latency_ms,
      COALESCE(MAX(latency_ms), 0)::int AS max_latency_ms,
      ROUND(COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms), 0))::int AS p95_latency_ms
    FROM interaction_logs
    WHERE latency_ms IS NOT NULL ${dateClause};
  `;

  const trendSql = `
    SELECT 
      DATE_TRUNC('day', created_at) AS date_bucket,
      ROUND(AVG(latency_ms))::int AS avg_latency,
      ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms))::int AS p95_latency,
      COUNT(*)::int AS query_count
    FROM interaction_logs
    WHERE latency_ms IS NOT NULL ${dateClause}
    GROUP BY DATE_TRUNC('day', created_at)
    ORDER BY date_bucket ASC;
  `;

  const [statsRes, trendRes] = await Promise.all([
    executor.query(statsSql, params),
    executor.query(trendSql, params),
  ]);

  return {
    stats: statsRes.rows[0] || { total_interactions: 0, avg_latency_ms: 0, min_latency_ms: 0, max_latency_ms: 0, p95_latency_ms: 0 },
    trend: trendRes.rows,
  };
}

/**
 * 9. Failed & Ungrounded Interactions Monitor
 * Paginated queries for queries with null/fallback intents, high latency, or negative sentiment
 */
export async function getFailedInteractions({ page = 1, limit = 20, search = '', startDate, endDate } = {}, client) {
  const executor = client || { query };
  const params = [];
  const clauses = [
    `(
      intent_detected IN ('unknown', 'fallback', 'ungrounded', 'unrecognized') 
      OR latency_ms > 2000 
      OR sentiment = 'negative'
      OR robot_response ILIKE '%apologize%'
      OR robot_response ILIKE '%specific details on hand%'
      OR robot_response ILIKE '%ಮಾಹಿತಿ ಲಭ್ಯವಿಲ್ಲ%'
      OR robot_response ILIKE '%विशिष्ट जानकारी उपलब्ध नहीं%'
    )`
  ];

  if (search && search.trim().length > 0) {
    params.push(`%${search.trim()}%`);
    clauses.push(`(user_query ILIKE $${params.length} OR robot_response ILIKE $${params.length})`);
  }

  if (startDate) {
    params.push(new Date(startDate).toISOString());
    clauses.push(`created_at >= $${params.length}`);
  }
  if (endDate) {
    params.push(new Date(endDate).toISOString());
    clauses.push(`created_at <= $${params.length}`);
  }

  const whereClause = `WHERE ${clauses.join(' AND ')}`;

  const countSql = `SELECT COUNT(*)::int AS count FROM interaction_logs ${whereClause};`;
  const totalLogsSql = `SELECT COUNT(*)::int AS total FROM interaction_logs;`;

  const [countRes, totalLogsRes] = await Promise.all([
    executor.query(countSql, params),
    executor.query(totalLogsSql),
  ]);

  const failedCount = countRes.rows[0]?.count || 0;
  const totalCount = totalLogsRes.rows[0]?.total || 1;
  const failureRatePct = Number(((failedCount / totalCount) * 100).toFixed(1));

  const offset = Math.max(0, (page - 1) * limit);
  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const dataSql = `
    SELECT id, member_id, device_id, user_query, robot_response, language,
           input_method, intent_detected, latency_ms, created_at
    FROM interaction_logs
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ${limitParam} OFFSET ${offsetParam};
  `;

  const dataRes = await executor.query(dataSql, params);

  return {
    failedCount,
    totalInteractions: totalCount,
    failureRatePct,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(failedCount / limit),
    records: dataRes.rows,
  };
}

/**
 * 10. Executive KPI Summary (Daily, Weekly, Monthly)
 */
export async function getExecutiveSummary({ startDate, endDate, period = 'weekly' } = {}, client) {
  const executor = client || { query };
  const params = [];
  
  // Set default period ranges if not provided
  let effectiveStart = startDate;
  let effectiveEnd = endDate;
  if (!effectiveStart) {
    const days = period === 'daily' ? 1 : period === 'monthly' ? 30 : 7;
    effectiveStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  const checkinClause = buildDateClause('check_in_time', { startDate: effectiveStart, endDate: effectiveEnd }, params);
  const interactionClause = buildDateClause('created_at', { startDate: effectiveStart, endDate: effectiveEnd }, params);

  const sql = `
    SELECT 
      (SELECT COUNT(*)::int FROM check_ins WHERE 1=1 ${checkinClause}) AS total_checkins,
      (SELECT COUNT(*)::int FROM check_ins WHERE check_in_time >= CURRENT_DATE) AS today_checkins,
      (SELECT COUNT(*)::int FROM interaction_logs WHERE 1=1 ${interactionClause}) AS total_ai_queries,
      (SELECT ROUND(COALESCE(AVG(latency_ms), 0))::int FROM interaction_logs WHERE 1=1 ${interactionClause}) AS avg_ai_latency_ms,
      (SELECT COUNT(*)::int FROM member_enquiries WHERE 1=1 ${interactionClause}) AS new_enquiries,
      (SELECT COUNT(*)::int FROM robot_commands WHERE 1=1 ${interactionClause}) AS robot_commands_count,
      (SELECT COUNT(*)::int FROM trainers WHERE status = 'on_floor') AS trainers_on_floor,
      (SELECT COUNT(*)::int FROM members WHERE status = 'active') AS active_members_count;
  `;

  const res = await executor.query(sql, params);
  return {
    period,
    startDate: effectiveStart,
    endDate: effectiveEnd,
    metrics: res.rows[0] || {},
  };
}
