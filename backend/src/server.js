import { createApp } from './app.js';
import { config } from './config/env.js';
import { checkDatabaseConnection, closePool } from './config/database.js';
import { bootstrapEmptyDatabase } from './config/bootstrapSchema.js';
import { initRealtime, closeRealtime } from './services/realtime.service.js';
import { startBirthdayScheduler, stopBirthdayScheduler } from './services/birthdayWishes.service.js';

async function bootstrap() {
  const app = createApp();

  // Test Database Connectivity
  console.log('[Bootstrap] Testing PostgreSQL connectivity...');
  const dbHealth = await checkDatabaseConnection();
  if (dbHealth.ok) {
    console.log(
      `[Bootstrap] PostgreSQL connection verified successfully (${dbHealth.pgVersion}, latency: ${dbHealth.latencyMs}ms).`
    );
    // Brand-new EMPTY database (e.g. fresh hosting): create all tables once. Never touches a database with tables.
    try {
      const boot = await bootstrapEmptyDatabase();
      if (boot.ran) console.log(`[Bootstrap] Empty database: created ${boot.tables} tables. The first admin sign-up becomes the Owner.`);
    } catch (err) {
      console.error('[Bootstrap] Could not create the database tables:', err.message);
    }
  } else {
    console.warn(
      `[Bootstrap] PostgreSQL not reachable (${dbHealth.error}). Operating in development mock fallback mode.`
    );
  }

  // Start Server
  const server = app.listen(config.port, config.host, () => {
    console.log('====================================================');
    console.log('🤖 Gym Receptionist Robot Backend Online');
    console.log(`🌐 Local Web UI & API: http://localhost:${config.port}`);
    console.log(`📡 Network Host:       http://${config.host}:${config.port}`);
    console.log(`🩺 Health Endpoint:    http://localhost:${config.port}/api/v1/health`);
    console.log(`⚡ WebSocket Realtime: ws://localhost:${config.port}/ws`);
    console.log('🔑 ESP32 Hardware Auth: Active (Headers: x-robot-device-id, x-robot-api-key)');
    console.log('====================================================');
  });

  // Attach WebSocket Real-Time Synchronization Engine
  initRealtime(server);

  // Automatic birthday wishes for members and personal trainers (AUTO_BIRTHDAY_WISHES=false turns it off)
  startBirthdayScheduler();

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[Shutdown] Received ${signal}. Closing HTTP server and draining database connections...`);
    stopBirthdayScheduler();
    await closeRealtime();
    server.close(async () => {
      console.log('[Shutdown] HTTP server closed.');
      await closePool(5000);
      console.log('[Shutdown] All resources released successfully.');
      process.exit(0);
    });

    // Timeout safety fallback
    setTimeout(() => {
      console.error('[Shutdown] Forced termination after timeout.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[Bootstrap Error] Failed to start server:', err);
  process.exit(1);
});
