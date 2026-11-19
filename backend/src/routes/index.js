import { Router } from 'express';
import { bootstrapStatus } from '../config/bootstrapSchema.js';
import gymRoutes from './gym.routes.js';
import faqRoutes from './faq.routes.js';
import membershipRoutes from './membership.routes.js';
import trainerRoutes from './trainer.routes.js';
import robotRoutes from './robot.routes.js';
import interactionRoutes from './interaction.routes.js';
import authRoutes from './auth.routes.js';
import chatRoutes from './chat.routes.js';
import memberRoutes from './member.routes.js';
import adminRoutes from './admin.routes.js';
import announcementRoutes from './announcement.routes.js';
import messageExtrasRoutes from './messageExtras.routes.js';
import analyticsRoutes from './analytics.routes.js';
import routineRoutes from './routine.routes.js';
import inventoryRoutes from './inventory.routes.js';
import retentionRoutes from './retention.routes.js';
import operationsRoutes from './operations.routes.js';
import roboticsManagementRoutes from './roboticsManagement.routes.js';
import systemAdminRoutes from './systemAdmin.routes.js';
import trainerHubRoutes from './trainerHub.routes.js';
import memberPortalRoutes from './memberPortal.routes.js';
import { checkDatabaseConnection, query } from '../config/database.js';

const router = Router();

/** Table count + first-start set-up result, so an empty / unset-up hosted database is visible (no secrets). */
async function schemaInfo() {
  try {
    const r = (await query(`SELECT (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS tables,
                                   has_schema_privilege('public', 'CREATE') AS can_create,
                                   current_setting('search_path') AS search_path,
                                   to_regclass('gym_settings') IS NOT NULL AS tables_visible`)).rows[0];
    return { tables: r.tables, tablesVisible: r.tables_visible, searchPath: r.search_path, canCreateTables: r.can_create, setup: bootstrapStatus };
  } catch (err) {
    return { error: err.message, setup: bootstrapStatus };
  }
}

// GET /api/health
router.get('/health', async (req, res) => {
  try {
    const dbStatus = await checkDatabaseConnection();
    res.json({
      status: 'online',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database: dbStatus.ok ? 'connected' : `disconnected (${dbStatus.error})`,
      diagnostics: {
        latencyMs: dbStatus.latencyMs,
        pgVersion: dbStatus.pgVersion,
        pool: dbStatus.pool,
      },
      schema: await schemaInfo(),
    });
  } catch (err) {
    res.status(200).json({
      status: 'online',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database: `disconnected (${err.message})`,
    });
  }
});

// Modular Routes
router.use('/gym', gymRoutes);
router.use('/faqs', faqRoutes);
router.use('/membership-plans', membershipRoutes);
router.use('/memberships', membershipRoutes);
router.use('/trainers', trainerRoutes);
router.use('/robot', robotRoutes);
router.use('/interactions', interactionRoutes);
router.use('/auth', authRoutes);

// Kiosk UI compatibility routes
router.use('/chat', chatRoutes);
router.use('/members', memberRoutes);
router.use('/announcements', announcementRoutes);
router.use('/messages', messageExtrasRoutes);   // 📎 files + 📊 polls in Messages (all portals)

// Server-side protected administrative console routes
router.use('/admin', adminRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/routine', routineRoutes);

// Direct modular route aliases
router.use('/inventory', inventoryRoutes);
router.use('/retention', retentionRoutes);
router.use('/operations', operationsRoutes);
router.use('/robotics-management', roboticsManagementRoutes);
router.use('/system-admin', systemAdminRoutes);

// Trainer Hub (trainer-scoped API): /api/trainer/* and /api/v1/trainer/*
router.use('/trainer', trainerHubRoutes);

// Member Portal (own-records API): /api/member/* and /api/v1/member/*
router.use('/member', memberPortalRoutes);

export default router;
