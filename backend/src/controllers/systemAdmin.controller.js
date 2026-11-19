/**
 * Virtex Admin - System Administration Controller
 * 
 * Endpoints for 10 core features:
 * 1. Admin & Staff Permission Overview
 * 2. Login Activity History
 * 3. Audit-Log Viewer
 * 4. Database Backup Status & Verification
 * 5. Data Export Tools (Strictly Sanitized)
 * 6. Security Activity Monitoring
 * 7. API Integration Status
 * 8. System Health Dashboard
 * 9. Error Monitoring
 * 10. Application Activity Reports
 * 
 * SECURITY MANDATE:
 * Preserves JWT and RBAC controls. Never exposes passwords, API secrets,
 * JWT tokens, or sensitive member data.
 */

import { systemAdminRepository } from '../repositories/systemAdmin.repository.js';

// ==========================================
// 1. ADMIN & STAFF PERMISSION OVERVIEW
// ==========================================
export async function getPermissionsOverview(req, res) {
  try {
    const [roles, staffUsers] = await Promise.all([
      systemAdminRepository.getRolesAndPermissions(),
      systemAdminRepository.getStaffUsersOverview()
    ]);

    res.json({
      success: true,
      data: {
        roles,
        staffUsers
      }
    });
  } catch (err) {
    console.error('Error fetching permissions overview:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve permissions overview' });
  }
}

// ==========================================
// 2. LOGIN ACTIVITY HISTORY
// ==========================================
export async function getLoginActivity(req, res) {
  try {
    const { limit, username, status } = req.query;
    const history = await systemAdminRepository.getLoginActivityHistory({
      limit: limit ? parseInt(limit, 10) : 50,
      username,
      status
    });

    res.json({ success: true, data: history });
  } catch (err) {
    console.error('Error fetching login activity history:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve login activity history' });
  }
}

// ==========================================
// 3. AUDIT-LOG VIEWER
// ==========================================
export async function getAuditLogs(req, res) {
  try {
    const { limit, eventType, search, startDate, endDate } = req.query;
    const logs = await systemAdminRepository.getAuditLogs({
      limit: limit ? parseInt(limit, 10) : 100,
      eventType,
      search,
      startDate,
      endDate
    });

    res.json({ success: true, data: logs });
  } catch (err) {
    console.error('Error fetching audit logs:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve audit logs' });
  }
}

// ==========================================
// 4. DATABASE BACKUP STATUS
// ==========================================
export async function getDatabaseBackups(req, res) {
  try {
    const backups = await systemAdminRepository.getDatabaseBackups();
    res.json({ success: true, data: backups });
  } catch (err) {
    console.error('Error fetching database backups:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve database backups' });
  }
}

export async function triggerDatabaseBackup(req, res) {
  try {
    const createdBy = req.user?.username || 'admin';
    const backup = await systemAdminRepository.createBackupRecord({
      created_by: createdBy,
      notes: req.body?.notes || 'Manual database snapshot from System Admin Console'
    });

    res.status(201).json({
      success: true,
      data: backup,
      message: 'Database backup snapshot generated successfully'
    });
  } catch (err) {
    console.error('Error triggering database backup:', err);
    res.status(500).json({ success: false, message: 'Failed to trigger database backup' });
  }
}

export async function verifyDatabaseBackup(req, res) {
  try {
    const { id } = req.params;
    const verified = await systemAdminRepository.verifyBackup(id);
    if (!verified) {
      return res.status(404).json({ success: false, message: 'Backup record not found' });
    }
    res.json({
      success: true,
      data: verified,
      message: 'Database backup checksum verified clean'
    });
  } catch (err) {
    console.error('Error verifying database backup:', err);
    res.status(500).json({ success: false, message: 'Failed to verify database backup' });
  }
}

// ==========================================
// 5. DATA EXPORT TOOLS (STRICTLY SANITIZED)
// ==========================================
export async function exportData(req, res) {
  try {
    const { entityType, format = 'json' } = req.body;
    if (!entityType) {
      return res.status(400).json({ success: false, message: 'entityType is required' });
    }

    const exportedBy = req.user?.username || 'owner_admin';
    const result = await systemAdminRepository.exportEntityData(entityType, format, exportedBy);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${result.exportName}"`);
      
      // Simple CSV formatter
      if (result.data.length === 0) {
        return res.send('');
      }
      const headers = Object.keys(result.data[0]);
      const csvLines = [headers.join(',')];
      for (const row of result.data) {
        csvLines.push(headers.map(h => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(','));
      }
      return res.send(csvLines.join('\n'));
    }

    res.json({
      success: true,
      message: `Data export generated for ${entityType} (${result.recordCount} records, sanitized).`,
      meta: {
        exportName: result.exportName,
        recordCount: result.recordCount,
        fileSizeBytes: result.fileSizeBytes,
        sanitizedFields: result.sanitizedFields
      },
      data: result.data
    });
  } catch (err) {
    console.error('Error exporting entity data:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to export data' });
  }
}

export async function getExportLogs(req, res) {
  try {
    const logs = await systemAdminRepository.getExportLogs();
    res.json({ success: true, data: logs });
  } catch (err) {
    console.error('Error fetching export logs:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve export logs' });
  }
}

// ==========================================
// 6. SECURITY ACTIVITY MONITORING
// ==========================================
export async function getSecurityMonitoring(req, res) {
  try {
    const overview = await systemAdminRepository.getSecurityOverview();
    res.json({ success: true, data: overview });
  } catch (err) {
    console.error('Error fetching security overview:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve security monitoring data' });
  }
}

// ==========================================
// 7. API INTEGRATION STATUS
// ==========================================
export async function getApiIntegrationStatus(req, res) {
  try {
    const integrations = await systemAdminRepository.getApiIntegrationStatus();
    res.json({ success: true, data: integrations });
  } catch (err) {
    console.error('Error fetching API integration status:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve API integration status' });
  }
}

// ==========================================
// 8. SYSTEM HEALTH DASHBOARD
// ==========================================
export async function getSystemHealth(req, res) {
  try {
    const metrics = await systemAdminRepository.getSystemHealthMetrics();
    res.json({ success: true, data: metrics });
  } catch (err) {
    console.error('Error fetching system health metrics:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve system health metrics' });
  }
}

// ==========================================
// 9. ERROR MONITORING
// ==========================================
export async function getErrorLogs(req, res) {
  try {
    const { limit, status, errorType } = req.query;
    const errors = await systemAdminRepository.getErrorLogs({
      limit: limit ? parseInt(limit, 10) : 50,
      status,
      errorType
    });

    res.json({ success: true, data: errors });
  } catch (err) {
    console.error('Error fetching error logs:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve error logs' });
  }
}

export async function resolveErrorLog(req, res) {
  try {
    const { id } = req.params;
    const resolvedBy = req.user?.username || 'Duty Administrator';
    const resolved = await systemAdminRepository.resolveErrorLog(id, resolvedBy);
    if (!resolved) {
      return res.status(404).json({ success: false, message: 'Error log entry not found' });
    }
    res.json({
      success: true,
      data: resolved,
      message: 'Error log marked as resolved'
    });
  } catch (err) {
    console.error('Error resolving error log:', err);
    res.status(500).json({ success: false, message: 'Failed to resolve error log' });
  }
}

// ==========================================
// 10. APPLICATION ACTIVITY REPORTS
// ==========================================
export async function getActivityReports(req, res) {
  try {
    const reports = await systemAdminRepository.getApplicationActivityReports();
    res.json({ success: true, data: reports });
  } catch (err) {
    console.error('Error fetching activity reports:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve application activity reports' });
  }
}

