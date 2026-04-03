const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });

const pool = new Pool({
  host: process.env.DB_HOST || "192.168.0.249",
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "password",
  database: process.env.DB_NAME || "video_analysis",
});

module.exports = pool;
