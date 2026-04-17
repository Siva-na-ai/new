const Database = require('better-sqlite3');
const path = require('path');

// Locate the shared SQLite database file
const dbPath = path.resolve(__dirname, '../backend/video_analysis.db');
const db = new Database(dbPath, { verbose: null });

// Enable WAL mode for multi-process concurrency
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// Mimic the 'pg' pool.query interface for minimal changes in server.js
const pool = {
  query: async (text, params = []) => {
    try {
      // Map params to handle Date and Boolean objects
      const processedParams = params.map(p => {
        if (p instanceof Date) return p.toISOString();
        if (typeof p === 'boolean') return p ? 1 : 0;
        return p;
      });
      
      // Convert PostgreSQL $1, $2... placeholders to SQLite ?
      const sqliteQuery = text.replace(/\$\d+/g, '?');
      
      const statement = db.prepare(sqliteQuery);
      
      if (sqliteQuery.trim().toUpperCase().startsWith('SELECT')) {
        const rows = statement.all(...processedParams);
        return { rows };
      } else {
        const info = statement.run(...processedParams);
        return { rows: [], lastInsertRowid: info.lastInsertRowid, changes: info.changes };
      }
    } catch (err) {
      console.error('Database Error:', err.message);
      console.error('Query:', text);
      throw err;
    }
  }
};

module.exports = pool;
