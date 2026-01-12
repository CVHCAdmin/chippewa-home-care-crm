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
          
          // Only save if we have valid data
          if (auditData && auditData.user_id) {
            await saveAuditLog(pool, auditData);
          }
        }
      } catch (error) {
        console.error('Error in audit logging:', error.message);
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
    // Only log if we have a valid user_id (UUID)
    if (!auditData.user_id) {
      return; // Skip logging
    }

    await pool.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        auditData.user_id,
        auditData.action || 'update',
        auditData.table_name || 'unknown',
        auditData.record_id || 'unknown',
        auditData.old_data || '{}',
        auditData.new_data || '{}'
      ]
    );
  } catch (error) {
    console.error('Audit log database error:', error.message);
    // Silently fail - don't interrupt the response
  }
}

/**
 * Extract audit data from request/response
 */
function extractAuditData(req, res, requestBody, responseBody) {
  // Only log if user is authenticated
  if (!req.user?.id) {
    return null;
  }

  const entityInfo = extractEntityInfo(req);

  return {
    user_id: req.user.id,
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
  return map[method] || 'update';
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