// src/db.js
// Shared database connection pool
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Test connection on startup
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection failed:', err);
  } else {
    console.log('✅ Database connected:', res.rows[0].now);
  }
});

// Helper for audit logging
const auditLog = async (userId, action, tableName, recordId, oldData, newData) => {
  try {
    if (recordId && typeof recordId === 'string' && !recordId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      console.warn('Skipping audit log: invalid recordId format:', recordId);
      return;
    }
    
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [userId || '00000000-0000-0000-0000-000000000000', action, tableName, recordId, JSON.stringify(oldData), JSON.stringify(newData)]
    );
  } catch (error) {
    console.error('Audit log database error:', error.message);
  }
};

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  auditLog
};
