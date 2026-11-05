import { createApp } from './app.js';
import { config } from './config/env.js';
import { checkDatabaseConnection } from './config/database.js';

async function bootstrap() {
  const app = createApp();

  // Test Database Connectivity
  console.log('[Bootstrap] Testing PostgreSQL connectivity...');
  const dbHealth = await checkDatabaseConnection();
  if (dbHealth.ok) {
    console.log('[Bootstrap] PostgreSQL connection verified successfully.');
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
    console.log('🔑 ESP32 Hardware Auth: Active (Headers: x-robot-device-id, x-robot-api-key)');
    console.log('====================================================');
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[Shutdown] Closing server and cleanup...');
    server.close(() => {
      console.log('[Shutdown] Server closed successfully.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[Bootstrap Error] Failed to start server:', err);
  process.exit(1);
});

