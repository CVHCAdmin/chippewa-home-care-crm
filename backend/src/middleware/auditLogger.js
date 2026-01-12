// src/middleware/auditLogger.js
/**
 * Audit Logger Middleware
 * Logs all non-GET requests to PostgreSQL audit_logs table
 */

const auditLogger = (pool) => {
  return async (req, res, next) => {
    // Store original send and json methods
    const originalSend = res.send;
    const originalJson = res.json;
    
    let responseBody = null;
    let requestBody = JSON.stringify(req.body || {});

    // Intercept res.send
    res.send = function(data) {
      responseBody = data;
      return originalSend.call(this, data);
    };

    // Intercept res.json
    res.json = function(data) {
      responseBody = JSON.stringify(data);
      return originalJson.call(this, data);
    };

    // Log after response is sent
    res.on('finish', async () => {
      try {
        // Only log non-GET requests and successful operations
        if (req.method !== 'GET' && res.statusCode < 400) {
          const auditData = extractAuditData(req, res, requestBody, responseBody);
          
          // Save to database
          await saveAuditLog(pool, auditData);
        }
        // Log failed operations too (for security)
        else if (req.method !== 'GET' && res.statusCode >= 400) {
          const auditData = extractAuditData(req, res, requestBody, responseBody);
          auditData.flags = JSON.stringify(['access_denied']);
          await saveAuditLog(pool, auditData);
        }
        // Log failed logins
        else if (req.path.includes('/login') && res.statusCode >= 400) {
          await saveAuditLog(pool, {
            user_id: null,
            action: 'failed_login',
            table_name: 'users',
            record_id: 'login-attempt',
            old_data: JSON.stringify({}),
            new_data: JSON.stringify({ email: req.body?.email || 'unknown' })
          });
        }
      } catch (error) {
        console.error('Error logging audit:', error);
        // Don't throw - audit logging shouldn't break the app
      }
    });

    next();
  };
};

/**
 * Save audit log to PostgreSQL
 */
async function saveAuditLog(pool, auditData) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        auditData.user_id || null,
        auditData.action || 'unknown',
        auditData.table_name || 'unknown',
        auditData.record_id || 'unknown',
        auditData.old_data || '{}',
        auditData.new_data || '{}'
      ]
    );
  } catch (error) {
    console.error('Audit log database error:', error);
  }
}

/**
 * Extract audit data from request/response
 */
function extractAuditData(req, res, requestBody, responseBody) {
  const entityInfo = extractEntityInfo(req);

  return {
    user_id: req.user?.id || null,
    action: mapMethodToAction(req.method),
    table_name: entityInfo.entityType,
    record_id: entityInfo.entityId,
    old_data: JSON.stringify({}),
    new_data: JSON.stringify(req.body || {})
  };
}

/**
 * Map HTTP method to audit action
 */
function mapMethodToAction(method) {
  const map = {
    'POST': 'create',
    'PUT': 'update',
    'PATCH': 'update',
    'DELETE': 'delete'
  };
  return map[method] || 'unknown';
}

/**
 * Extract entity type and ID from request path
 */
function extractEntityInfo(req) {
  const path = req.path.toLowerCase();
  const pathParts = path.split('/').filter(p => p && p !== 'api');

  let entityType = 'unknown';
  let entityId = 'unknown';

  // Extract entity type from path
  if (pathParts.length > 0) {
    const resource = pathParts[0];
    entityType = resource;
    
    // Extract entity ID
    if (pathParts.length > 1) {
      entityId = pathParts[1];
    }
  }

  return { entityType, entityId };
}

module.exports = auditLogger;