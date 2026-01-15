// src/middleware/auditLogger.js
/**
 * HIPAA-Compliant Audit Logger
 * - Every action has an actor (user or SYSTEM)
 * - Flags sensitive PHI access
 * - Detects suspicious activity patterns
 */

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

// Tables/actions containing PHI or sensitive data
const SENSITIVE_TABLES = [
  'clients',
  'care_plans',
  'visits',
  'medical_records',
  'medications',
  'diagnoses',
  'emergency_contacts',
  'insurance',
  'billing',
  'invoices',
  'payments',
  'documents'
];

const SENSITIVE_ACTIONS = [
  'export',
  'download',
  'bulk',
  'delete',
  'password',
  'login',
  'role'
];

const auditLogger = (pool) => {

  // Check if operation involves PHI or sensitive data
  const isSensitiveOperation = (table_name, action, req_body) => {
    // Table contains PHI
    if (SENSITIVE_TABLES.some(t => table_name?.toLowerCase().includes(t))) {
      return true;
    }
    
    // Action is sensitive
    if (SENSITIVE_ACTIONS.some(a => action?.toLowerCase().includes(a))) {
      return true;
    }
    
    // Body contains sensitive fields
    const sensitiveFields = ['ssn', 'social_security', 'diagnosis', 'medication', 'medical', 'insurance', 'dob', 'date_of_birth'];
    if (req_body) {
      const bodyStr = JSON.stringify(req_body).toLowerCase();
      if (sensitiveFields.some(f => bodyStr.includes(f))) {
        return true;
      }
    }
    
    return false;
  };

  // Detect suspicious activity patterns
  const checkSuspiciousActivity = async (user_id, action, table_name, ip_address) => {
    try {
      // Skip for system user
      if (user_id === SYSTEM_USER_ID) return null;

      const alerts = [];
      const now = new Date();
      const oneHourAgo = new Date(now - 60 * 60 * 1000);
      const fiveMinutesAgo = new Date(now - 5 * 60 * 1000);

      // Check 1: Bulk data access (>20 records in 5 minutes)
      const bulkCheck = await pool.query(
        `SELECT COUNT(*) as count FROM audit_logs 
         WHERE user_id = $1 
         AND created_at > $2 
         AND action LIKE '%GET%'`,
        [user_id, fiveMinutesAgo]
      );
      if (parseInt(bulkCheck.rows[0]?.count) > 20) {
        alerts.push('BULK_ACCESS: High volume data retrieval detected');
      }

      // Check 2: After-hours access (before 6am or after 10pm)
      const hour = now.getHours();
      if (hour < 6 || hour > 22) {
        alerts.push('AFTER_HOURS: Access outside normal business hours');
      }

      // Check 3: Multiple failed actions (>5 in 5 minutes)
      const failCheck = await pool.query(
        `SELECT COUNT(*) as count FROM audit_logs 
         WHERE user_id = $1 
         AND created_at > $2 
         AND action LIKE '%fail%'`,
        [user_id, fiveMinutesAgo]
      );
      if (parseInt(failCheck.rows[0]?.count) > 5) {
        alerts.push('MULTIPLE_FAILURES: Repeated failed operations');
      }

      // Check 4: Accessing many different client records (>10 in 1 hour)
      const clientCheck = await pool.query(
        `SELECT COUNT(DISTINCT record_id) as count FROM audit_logs 
         WHERE user_id = $1 
         AND created_at > $2 
         AND table_name = 'clients'`,
        [user_id, oneHourAgo]
      );
      if (parseInt(clientCheck.rows[0]?.count) > 10) {
        alerts.push('UNUSUAL_ACCESS: Accessing unusually high number of client records');
      }

      // Check 5: IP address change mid-session
      const ipCheck = await pool.query(
        `SELECT DISTINCT ip_address FROM audit_logs 
         WHERE user_id = $1 
         AND created_at > $2 
         AND ip_address IS NOT NULL`,
        [user_id, oneHourAgo]
      );
      if (ipCheck.rows.length > 2) {
        alerts.push('IP_CHANGE: Multiple IP addresses detected for same user');
      }

      // Check 6: Sensitive data export
      if (action?.toLowerCase().includes('export') || action?.toLowerCase().includes('download')) {
        if (SENSITIVE_TABLES.some(t => table_name?.toLowerCase().includes(t))) {
          alerts.push('PHI_EXPORT: Sensitive data export detected');
        }
      }

      // Log alerts if any
      if (alerts.length > 0) {
        console.warn(`⚠️ SECURITY ALERT - User ${user_id}:`, alerts);
        
        // Log the alert itself
        await pool.query(
          `INSERT INTO audit_logs (user_id, action, table_name, record_id, new_data, ip_address, is_sensitive)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            SYSTEM_USER_ID,
            'SECURITY_ALERT',
            'audit_logs',
            null,
            JSON.stringify({ user_id, alerts, original_action: action }),
            ip_address,
            true
          ]
        );
      }

      return alerts.length > 0 ? alerts : null;

    } catch (err) {
      console.error('Suspicious activity check failed:', err.message);
      return null;
    }
  };

  // Direct logging function for non-request events
  const log = async ({ 
    user_id = SYSTEM_USER_ID, 
    action, 
    table_name, 
    record_id = null, 
    old_data = null, 
    new_data = null, 
    ip_address = null 
  }) => {
    try {
      const is_sensitive = isSensitiveOperation(table_name, action, new_data);

      await pool.query(
        `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data, ip_address, is_sensitive)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          user_id || SYSTEM_USER_ID,
          action,
          table_name,
          record_id,
          old_data ? JSON.stringify(old_data) : null,
          new_data ? JSON.stringify(new_data) : null,
          ip_address,
          is_sensitive
        ]
      );

      // Check for suspicious activity on sensitive operations
      if (is_sensitive && user_id !== SYSTEM_USER_ID) {
        await checkSuspiciousActivity(user_id, action, table_name, ip_address);
      }

    } catch (err) {
      console.error('Audit insert failed:', err.message);
    }
  };

  // Middleware for HTTP requests
  const middleware = async (req, res, next) => {
    // Skip GET requests for logging, but still check suspicious activity
    if (req.method === 'GET') {
      const user_id = req.user?.id || req.user?.userId;
      if (user_id) {
        const table_name = extractTableName(req.path);
        // Check suspicious activity for sensitive GETs
        if (isSensitiveOperation(table_name, 'GET', null)) {
          checkSuspiciousActivity(user_id, `GET ${req.path}`, table_name, req.ip);
        }
      }
      return next();
    }

    const originalJson = res.json;
    
    res.json = function(data) {
      res.on('finish', async () => {
        if (res.statusCode < 400) {
          const user_id = req.user?.id || req.user?.userId || SYSTEM_USER_ID;
          const table_name = extractTableName(req.path);
          const record_id = req.params?.id || data?.id || null;
          const ip_address = req.ip || req.headers['x-forwarded-for'] || 'unknown';
          
          await log({
            user_id,
            action: `${req.method} ${req.path}`,
            table_name,
            record_id,
            old_data: null,
            new_data: req.body,
            ip_address
          });
        }
      });
      return originalJson.call(this, data);
    };

    next();
  };

  // Extract table name from path
  const extractTableName = (path) => {
    const parts = path.split('/').filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      if (part !== 'api' && part !== 'admin' && !/^[0-9a-f-]+$/i.test(part)) {
        return part;
      }
    }
    return 'unknown';
  };

  // Attach functions for direct access
  middleware.log = log;
  middleware.SYSTEM_USER_ID = SYSTEM_USER_ID;
  middleware.isSensitiveOperation = isSensitiveOperation;
  middleware.checkSuspiciousActivity = checkSuspiciousActivity;

  return middleware;
};

module.exports = auditLogger;
