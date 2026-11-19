import * as analyticsService from '../services/analytics.service.js';

/**
 * analytics.controller.js
 * Controller endpoints for Virtex Analytics, KPI Metrics & Interaction Monitoring
 */

/**
 * GET /api/v1/admin/analytics/overview
 * Executive high-level overview of daily/weekly metrics
 */
export async function getOverview(req, res, next) {
  try {
    const { startDate, endDate, period = 'weekly' } = req.query;
    const [summary, checkIns, enquiries, languages, latency, robot] = await Promise.all([
      analyticsService.getExecutiveSummary({ startDate, endDate, period }),
      analyticsService.getCheckInsAnalytics({ startDate, endDate, period }),
      analyticsService.getEnquiriesAnalytics({ startDate, endDate }),
      analyticsService.getLanguageDistribution({ startDate, endDate }),
      analyticsService.getAiLatencyAnalytics({ startDate, endDate }),
      analyticsService.getRobotUptime({ startDate, endDate }),
    ]);

    res.json({
      success: true,
      data: {
        summary: summary.metrics,
        checkIns: checkIns.totals,
        checkInsTrend: checkIns.trend,
        enquiries: enquiries.summary,
        enquiriesByPlan: enquiries.byPlan,
        languageDistribution: languages.distribution,
        aiPerformance: latency.stats,
        robotUptime: robot,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/admin/analytics/check-ins
 * Daily/Hourly check-ins with date filtering and peak hours breakdown
 */
export async function getCheckIns(req, res, next) {
  try {
    const { startDate, endDate, period = 'daily' } = req.query;
    const data = await analyticsService.getCheckInsAnalytics({ startDate, endDate, period });
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/admin/analytics/enquiries
 * Membership lead pipeline, conversion rates, and plan breakdowns
 */
export async function getEnquiries(req, res, next) {
  try {
    const { startDate, endDate } = req.query;
    const data = await analyticsService.getEnquiriesAnalytics({ startDate, endDate });
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/admin/analytics/faqs
 * Top queried FAQs and detected intent frequencies
 */
export async function getPopularFaqs(req, res, next) {
  try {
    const { startDate, endDate, limit = 10 } = req.query;
    const data = await analyticsService.getPopularFaqs({
      startDate,
      endDate,
      limit: parseInt(limit, 10) || 10,
    });
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/admin/analytics/languages
 * Language distribution and voice vs text method breakdowns
 */
export async function getLanguages(req, res, next) {
  try {
    const { startDate, endDate } = req.query;
    const data = await analyticsService.getLanguageDistribution({ startDate, endDate });
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/admin/analytics/trainers
 * Live trainer availability, shift roster, and floor load ratio
 */
export async function getTrainerAvailability(req, res, next) {
  try {
    const data = await analyticsService.getTrainerAvailability();
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/admin/analytics/robot
 * Robot hardware uptime, battery, RSSI, and error event statistics
 */
export async function getRobotMetrics(req, res, next) {
  try {
    const { startDate, endDate } = req.query;
    const data = await analyticsService.getRobotUptime({ startDate, endDate });
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/admin/analytics/robot-commands
 * Paginated and searchable robot command history
 */
export async function getRobotCommands(req, res, next) {
  try {
    const { page = 1, limit = 20, search = '', status = '', startDate, endDate } = req.query;
    const data = await analyticsService.getRobotCommandHistory({
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
      search,
      status,
      startDate,
      endDate,
    });
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/admin/analytics/ai-performance
 * AI response time metrics (avg, min, max, p95) and latency trends
 */
export async function getAiPerformance(req, res, next) {
  try {
    const { startDate, endDate } = req.query;
    const data = await analyticsService.getAiLatencyAnalytics({ startDate, endDate });
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/admin/analytics/failed-interactions
 * Failed, ungrounded, and high-latency speech queries with pagination & search
 */
export async function getFailedInteractions(req, res, next) {
  try {
    const { page = 1, limit = 20, search = '', startDate, endDate } = req.query;
    const data = await analyticsService.getFailedInteractions({
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
      search,
      startDate,
      endDate,
    });
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/admin/analytics/summary
 * Executive KPI rollups for daily, weekly, or monthly periods
 */
export async function getSummary(req, res, next) {
  try {
    const { period = 'weekly', startDate, endDate } = req.query;
    const data = await analyticsService.getExecutiveSummary({ period, startDate, endDate });
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/v1/admin/analytics/report
 * Role-restricted customized analytics report
 */
export async function getRoleReport(req, res, next) {
  try {
    const userRole = req.user?.role || 'trainer';
    const { startDate, endDate, period } = req.query;
    const report = await analyticsService.getRoleRestrictedReport(userRole, { startDate, endDate, period });
    res.json({
      success: true,
      data: report,
    });
  } catch (err) {
    if (err.message.includes('Forbidden')) {
      return res.status(403).json({ success: false, error: err.message });
    }
    next(err);
  }
}

