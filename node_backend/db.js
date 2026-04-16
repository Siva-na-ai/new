const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const pool = new Pool({
  host: process.env.DB_HOST || "192.168.0.135",
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "password",
  database: process.env.DB_NAME || "video_analysis",
  // Resilience settings
  connectionTimeoutMillis: 5000, 
  idleTimeoutMillis: 30000,
  max: 20
});

// Avoid process crash on unexpected DB errors
pool.on('error', (err) => {
  console.error('CRITICAL: Unexpected database pool error', err);
});

module.exports = pool;
