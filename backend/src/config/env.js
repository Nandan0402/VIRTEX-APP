import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  host: process.env.HOST || '0.0.0.0',

  // Authentication & Security
  jwt: {
    secret: process.env.JWT_SECRET || 'fallback_development_secret_do_not_use_in_prod',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },
  auth: {
    googleClientId: process.env.GOOGLE_CLIENT_ID || '521224801754-9s3d6mfta7e501gcum6i4glkillrn98k.apps.googleusercontent.com',
  },

  // ESP32 Microcontroller Hardware Authentication
  robot: {
    deviceUuid: process.env.ROBOT_DEVICE_UUID || 'ESP32_RECEPTION_01',
    apiKey: process.env.ROBOT_API_KEY || 'gym_robot_secret_key_12345',
  },

  // PostgreSQL Database
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'gym_robot_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MILLIS, 10) || 30000,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MILLIS, 10) || 5000,
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 mins
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 500,
    authMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS, 10) || 30, // Brute force guard for login
  },

  // AI & Voice
  ai: {
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    timeoutMs: parseInt(process.env.GEMINI_TIMEOUT_MS, 10) || 8000,
  },
  voice: {
    defaultLanguage: process.env.DEFAULT_LANGUAGE || 'en-IN',
    supportedLanguages: (process.env.SUPPORTED_LANGUAGES || 'en-IN,kn-IN,hi-IN').split(','),
  },
};
