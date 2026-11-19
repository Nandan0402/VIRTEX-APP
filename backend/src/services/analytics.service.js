import { isDatabaseConnected } from '../config/database.js';
import * as analyticsRepo from '../repositories/analytics.repository.js';
import * as robotService from './robot.service.js';

/**
 * analytics.service.js
 * Business logic, PII masking, in-memory caching, and role-based report generation.
 */

// Simple in-memory cache to prevent repetitive analytics queries from loading DB
const cache = new Map();
const CACHE_TTL_MS = 30 * 1000; // 30 seconds

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
  // Prevent unbounded memory growth
  if (cache.size > 200) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
}

/**
 * ============================================================================
 * PII MASKING UTILITIES
 * Enforces privacy protection for member and lead personal data
 * ============================================================================
 */

export function maskName(name) {
  if (!name || typeof name !== 'string') return 'Member';
  const parts = name.trim().split(/\s+/);
  return parts
    .map((part) => {
      if (part.length <= 2) return `${part[0]}*`;
      return `${part[0]}${'*'.repeat(Math.min(part.length - 2, 4))}${part[part.length - 1]}`;
    })
    .join(' ');
}

export function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return '—';
  const clean = phone.trim();
  if (clean.length < 6) return '******';
  const start = clean.slice(0, 4);
  const end = clean.slice(-2);
  return `${start}******${end}`;
}

export function maskEmail(email) {
  if (!email || typeof email !== 'string') return '—';
  const [user, domain] = email.split('@');
  if (!domain) return '***@***';
  const maskedUser = user.length <= 2 ? `${user[0]}*` : `${user[0]}***${user[user.length - 1]}`;
  return `${maskedUser}@${domain}`;
}

/**
 * Apply PII masking to records containing member/lead information
 */
export function sanitizeMemberPII(records) {
  if (!Array.isArray(records)) return [];
  return records.map((r) => ({
    ...r,
    full_name: r.full_name ? maskName(r.full_name) : undefined,
    phone: r.phone ? maskPhone(r.phone) : undefined,
    email: r.email ? maskEmail(r.email) : undefined,
    member_name: r.member_name ? maskName(r.member_name) : undefined,
  }));
}

/**
 * ============================================================================
 * ANALYTICS SERVICE METHODS
 * ============================================================================
 */

export async function getCheckInsAnalytics(options = {}) {
  const cacheKey = `checkins_${JSON.stringify(options)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (isDatabaseConnected()) {
    const data = await analyticsRepo.getCheckInAnalytics(options);
    setCache(cacheKey, data);
    return data;
  }

  // Fallback mock
  return {
    totals: { total: 42, kiosk_voice: 30, kiosk_manual: 8, rfid_card: 3, mobile_qr: 1, unique_members: 38 },
    trend: [
      { bucket: '2026-11-05T00:00:00.000Z', total_checkins: 20, voice_checkins: 14, manual_checkins: 4, rfid_checkins: 2, qr_checkins: 0 },
      { bucket: '2026-11-06T00:00:00.000Z', total_checkins: 22, voice_checkins: 16, manual_checkins: 4, rfid_checkins: 1, qr_checkins: 1 },
    ],
    peakHours: [
      { hour_of_day: 6, checkin_count: 8 },
      { hour_of_day: 7, checkin_count: 14 },
      { hour_of_day: 8, checkin_count: 10 },
      { hour_of_day: 17, checkin_count: 5 },
      { hour_of_day: 18, checkin_count: 5 },
    ],
    heatmap: [],
  };
}

export async function getEnquiriesAnalytics(options = {}) {
  const cacheKey = `enquiries_${JSON.stringify(options)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (isDatabaseConnected()) {
    const data = await analyticsRepo.getEnquiryAnalytics(options);
    setCache(cacheKey, data);
    return data;
  }

  return {
    summary: { total: 54, new_leads: 40, contacted: 14, enrolled: 8, dropped: 2, conversion_rate_pct: 14.8 },
    byPlan: [
      { plan_name: 'Monthly Standard', count: 24 },
      { plan_name: 'Quarterly Pro', count: 18 },
      { plan_name: 'Annual Elite', count: 12 },
    ],
  };
}

export async function getPopularFaqs(options = {}) {
  const cacheKey = `faqs_${JSON.stringify(options)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (isDatabaseConnected()) {
    const data = await analyticsRepo.getPopularFaqs(options);
    setCache(cacheKey, data);
    return data;
  }

  return {
    totalCategorized: 77,
    popularFaqs: [
      { rank: 1, intent: 'general_query', count: 44, count_en: 22, count_kn: 22, count_hi: 0, percentage: 57.1, avg_latency_ms: 185 },
      { rank: 2, intent: 'timings', count: 24, count_en: 12, count_kn: 12, count_hi: 0, percentage: 31.2, avg_latency_ms: 210 },
      { rank: 3, intent: 'greeting', count: 6, count_en: 3, count_kn: 3, count_hi: 0, percentage: 7.8, avg_latency_ms: 120 },
      { rank: 4, intent: 'member_checkin', count: 2, count_en: 1, count_kn: 1, count_hi: 0, percentage: 2.6, avg_latency_ms: 160 },
      { rank: 5, intent: 'gym_timings', count: 1, count_en: 0, count_kn: 1, count_hi: 0, percentage: 1.3, avg_latency_ms: 145 },
    ],
  };
}

export async function getLanguageDistribution(options = {}) {
  const cacheKey = `lang_${JSON.stringify(options)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (isDatabaseConnected()) {
    const data = await analyticsRepo.getLanguageDistribution(options);
    setCache(cacheKey, data);
    return data;
  }

  return {
    total: 77,
    distribution: [
      { language: 'en-IN', languageName: 'English', count: 38, voiceCount: 38, textCount: 0, avgLatencyMs: 195, percentage: 49.4 },
      { language: 'kn-IN', languageName: 'Kannada (ಕನ್ನಡ)', count: 38, voiceCount: 38, textCount: 0, avgLatencyMs: 205, percentage: 49.4 },
      { language: 'hi-IN', languageName: 'Hindi (हिन्दी)', count: 1, voiceCount: 1, textCount: 0, avgLatencyMs: 170, percentage: 1.3 },
    ],
  };
}

export async function getTrainerAvailability() {
  if (isDatabaseConnected()) {
    return await analyticsRepo.getTrainerAvailabilityAnalytics();
  }

  return {
    summary: { total_trainers: 4, on_floor: 2, in_session: 1, on_break: 0, off_duty: 1 },
    todayCheckins: 42,
    memberTrainerRatio: '21:1',
    roster: [
      { id: 1, trainer_code: 'TRN001', full_name: 'Rajesh Kumar', specialty: 'Strength & HIIT', status: 'on_floor', rating: 4.9, shift_start: '06:00:00', shift_end: '14:00:00' },
      { id: 2, trainer_code: 'TRN002', full_name: 'Sneha Rao', specialty: 'Yoga & Pilates', status: 'on_floor', rating: 4.8, shift_start: '06:00:00', shift_end: '14:00:00' },
      { id: 3, trainer_code: 'TRN003', full_name: 'Anand Sharma', specialty: 'CrossFit', status: 'in_session', rating: 4.7, shift_start: '14:00:00', shift_end: '22:00:00' },
    ],
  };
}

export async function getRobotUptime(options = {}) {
  if (isDatabaseConnected()) {
    return await analyticsRepo.getRobotUptimeAnalytics(options);
  }

  const robotState = await robotService.getRobotStatus();
  return {
    device: {
      device_uuid: 'ESP32_RECEPTION_01',
      device_name: 'FitBot Front Desk Station',
      status: robotState.status,
      battery_level: 88,
      wifi_rssi: -58,
      last_heartbeat: robotState.lastSeen,
    },
    uptimePercentage: 99.4,
    commandStats: { total_commands: 303, executed: 298, delivered: 4, pending: 1, failed: 0, avg_execution_time_ms: 120 },
    hardwareEvents: { total_events: 12, errors: 0, warnings: 2, brownout_events: 0, wifi_drops: 1 },
  };
}

export async function getRobotCommandHistory(options = {}) {
  if (isDatabaseConnected()) {
    return await analyticsRepo.getRobotCommandHistory(options);
  }

  return {
    total: 3,
    page: 1,
    limit: 20,
    totalPages: 1,
    commands: [
      { id: 303, command_type: 'GESTURE', gesture_name: 'GREET_WAVE', status: 'executed', execution_time_ms: 850, triggered_by: 'kiosk', created_at: new Date().toISOString() },
      { id: 302, command_type: 'DIRECT_ANGLES', gesture_name: null, status: 'executed', execution_time_ms: 300, triggered_by: 'admin_test', created_at: new Date().toISOString() },
      { id: 301, command_type: 'GESTURE', gesture_name: 'NOD_YES', status: 'executed', execution_time_ms: 600, triggered_by: 'speech_ai', created_at: new Date().toISOString() },
    ],
  };
}

export async function getAiLatencyAnalytics(options = {}) {
  const cacheKey = `latency_${JSON.stringify(options)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (isDatabaseConnected()) {
    const data = await analyticsRepo.getAiLatencyAnalytics(options);
    setCache(cacheKey, data);
    return data;
  }

  return {
    stats: { total_interactions: 77, avg_latency_ms: 197, min_latency_ms: 10, max_latency_ms: 696, p95_latency_ms: 380 },
    trend: [
      { date_bucket: '2026-11-05T00:00:00.000Z', avg_latency: 205, p95_latency: 410, query_count: 35 },
      { date_bucket: '2026-11-06T00:00:00.000Z', avg_latency: 190, p95_latency: 350, query_count: 42 },
    ],
  };
}

export async function getFailedInteractions(options = {}) {
  if (isDatabaseConnected()) {
    const result = await analyticsRepo.getFailedInteractions(options);
    // Sanitize member PII in returned records
    result.records = sanitizeMemberPII(result.records);
    return result;
  }

  return {
    failedCount: 4,
    totalInteractions: 77,
    failureRatePct: 5.2,
    page: 1,
    limit: 20,
    totalPages: 1,
    records: [
      { id: 12, user_query: 'Do you offer kickboxing classes?', robot_response: 'I could not find kickboxing in our schedule. Please check with reception.', language: 'en-IN', latency_ms: 240, created_at: new Date().toISOString() },
      { id: 25, user_query: 'ಸ್ವಿಮ್ಮಿಂಗ್ ಪೂಲ್ ಇದೆಯೇ?', robot_response: 'ಕ್ಷಮಿಸಿ, ಈ ಮಾಹಿತಿಗಾಗಿ ಮುಂಭಾಗದ ಡೆಸ್ಕ್ ಅನ್ನು ಸಂಪರ್ಕಿಸಿ.', language: 'kn-IN', latency_ms: 210, created_at: new Date().toISOString() },
    ],
  };
}

export async function getExecutiveSummary(options = {}) {
  const cacheKey = `summary_${JSON.stringify(options)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (isDatabaseConnected()) {
    const data = await analyticsRepo.getExecutiveSummary(options);
    setCache(cacheKey, data);
    return data;
  }

  return {
    period: options.period || 'weekly',
    startDate: options.startDate || new Date(Date.now() - 7 * 86400000).toISOString(),
    endDate: options.endDate || new Date().toISOString(),
    metrics: {
      total_checkins: 42,
      today_checkins: 22,
      total_ai_queries: 77,
      avg_ai_latency_ms: 197,
      new_enquiries: 54,
      robot_commands_count: 303,
      trainers_on_floor: 2,
      active_members_count: 5,
    },
  };
}

/**
 * Role-Restricted Report Generator
 * Customizes analytics view strictly according to the authenticated user's role.
 *
 * - Owner: Full access to financial conversion, operational KPIs, staff activity, robot logs.
 * - Manager: Full access to operational analytics, FAQs, leads, language, robot status (financial audit redacted).
 * - Trainer: Access strictly to floor availability, today's member check-in count, floor ratio, personal shift (leads & financials redacted).
 */
export async function getRoleRestrictedReport(role, options = {}) {
  const cleanRole = String(role || '').toLowerCase();

  if (!['owner', 'manager', 'trainer', 'superadmin', 'admin'].includes(cleanRole)) {
    throw new Error('Forbidden: Insufficient permissions to access analytics reports.');
  }

  // 1. Trainer Role: Floor Operations Report Only
  if (cleanRole === 'trainer') {
    const [trainers, checkIns] = await Promise.all([
      getTrainerAvailability(),
      getCheckInsAnalytics({ period: 'daily' }),
    ]);

    return {
      reportType: 'TRAINER_FLOOR_OPERATIONS',
      generatedForRole: 'trainer',
      timestamp: new Date().toISOString(),
      trainersSummary: trainers.summary,
      activeOnFloorTrainers: trainers.summary.on_floor,
      memberTrainerRatio: trainers.memberTrainerRatio,
      todayCheckInsCount: checkIns.totals.total,
      shiftSchedule: trainers.roster.filter((t) => t.status !== 'off_duty'),
    };
  }

  // 2. Manager Role: Operational Analytics & Member Telemetry
  if (cleanRole === 'manager') {
    const [summary, checkIns, enquiries, faqs, languages, robot, latency, failed] = await Promise.all([
      getExecutiveSummary(options),
      getCheckInsAnalytics(options),
      getEnquiriesAnalytics(options),
      getPopularFaqs(options),
      getLanguageDistribution(options),
      getRobotUptime(options),
      getAiLatencyAnalytics(options),
      getFailedInteractions({ limit: 5 }),
    ]);

    return {
      reportType: 'OPERATIONS_EXECUTIVE_SUMMARY',
      generatedForRole: 'manager',
      timestamp: new Date().toISOString(),
      summary: summary.metrics,
      checkInsTrend: checkIns.trend,
      checkInsTotals: checkIns.totals,
      enquiries: enquiries.summary,
      popularFaqs: faqs.popularFaqs,
      languageDistribution: languages.distribution,
      robotHealth: {
        uptimePct: robot.uptimePercentage,
        status: robot.device.status,
        batteryLevel: robot.device.battery_level,
        wifiRssi: robot.device.wifi_rssi,
      },
      aiPerformance: latency.stats,
      failedQueriesSample: failed.records,
    };
  }

  // 3. Owner / Superadmin Role: Complete Virtex Master Intelligence Report
  const [summary, checkIns, enquiries, faqs, languages, trainers, robot, latency, failed] = await Promise.all([
    getExecutiveSummary(options),
    getCheckInsAnalytics(options),
    getEnquiriesAnalytics(options),
    getPopularFaqs(options),
    getLanguageDistribution(options),
    getTrainerAvailability(),
    getRobotUptime(options),
    getAiLatencyAnalytics(options),
    getFailedInteractions({ limit: 10 }),
  ]);

  return {
    reportType: 'OWNER_MASTER_INTELLIGENCE',
    generatedForRole: 'owner',
    timestamp: new Date().toISOString(),
    executiveSummary: summary.metrics,
    checkIns: checkIns,
    leadAcquisition: enquiries,
    popularFaqs: faqs.popularFaqs,
    languageDistribution: languages.distribution,
    trainerOperations: trainers,
    robotHardwareTelemetry: robot,
    aiLatencyStats: latency.stats,
    latencyTrend: latency.trend,
    failedInteractions: failed,
  };
}
