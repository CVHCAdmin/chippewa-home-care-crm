// src/middleware/auditLogger.js
// PostgreSQL-based audit logging (no Mongoose)

const auditLogger = (pool) => {
  return async (req, res, next) => {
    // Skip audit logging for these paths
    const skipPaths = [
      '/api/reports',
      '/api/auth',
      '/api/login',
      '/api/logout',
      '/api/verify'
    ];
    
    if (skipPaths.some(path => req.path.startsWith(path))) {
      return next();
    }

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
        // Only log non-GET requests
        if (req.method !== 'GET') {
          const auditData = extractAuditData(req, res, requestBody, responseBody);
          await logToPostgres(pool, auditData);
        }
      } catch (error) {
        // Don't let audit logging break the app
        console.debug('Audit log skipped:', error.message);
      }
    });

    next();
  };
};

/**
 * Log audit entry to PostgreSQL
 */
async function logToPostgres(pool, data) {
  try {
    // Validate UUID format for user_id
    const userId = isValidUUID(data.user_id) ? data.user_id : null;
    const entityId = isValidUUID(data.entity_id) ? data.entity_id : null;

    await pool.query(`
      INSERT INTO audit_logs (
        user_id, action, table_name, record_id, 
        old_data, new_data, ip_address, timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [
      userId,
      data.action,
      data.entity_type,
      entityId,
      JSON.stringify(data.old_data || null),
      JSON.stringify(data.new_data || null),
      data.ip_address
    ]);
  } catch (error) {
    // Silently fail - audit logging shouldn't break the app
    console.debug('Audit insert failed:', error.message);
  }
}

/**
 * Check if string is valid UUID
 */
function isValidUUID(str) {
  if (!str || typeof str !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Extract audit data from request/response
 */
function extractAuditData(req, res, requestBody, responseBody) {
  const entityInfo = extractEntityInfo(req);
  
  // Try to parse response to get created/updated entity ID
  let newData = null;
  let recordId = entityInfo.entityId;
  
  try {
    if (responseBody) {
      const parsed = JSON.parse(responseBody);
      if (parsed.id) recordId = parsed.id;
      newData = parsed;
    }
  } catch (e) {
    // Response wasn't JSON
  }

  return {
    user_id: req.user?.id || null,
    action: mapMethodToAction(req.method),
    entity_type: entityInfo.entityType,
    entity_id: recordId,
    old_data: null,
    new_data: req.method !== 'DELETE' ? req.body : null,
    ip_address: extractIP(req),
    status_code: res.statusCode
  };
}

/**
 * Map HTTP method to audit action
 */
function mapMethodToAction(method) {
  const map = {
    'POST': 'CREATE',
    'PUT': 'UPDATE',
    'PATCH': 'UPDATE',
    'DELETE': 'DELETE'
  };
  return map[method] || 'OTHER';
}

/**
 * Extract entity type and ID from request path
 */
function extractEntityInfo(req) {
  const path = req.path.toLowerCase();
  const pathParts = path.split('/').filter(p => p && p !== 'api');

  let entityType = 'unknown';
  let entityId = null;

  if (pathParts.length > 0) {
    // Entity type is first path segment
    entityType = pathParts[0];
    
    // Entity ID is second segment if it looks like a UUID
    if (pathParts.length > 1 && isValidUUID(pathParts[1])) {
      entityId = pathParts[1];
    }
  }

  return { entityType, entityId };
}

/**
 * Extract client IP address
 */
function extractIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || 
         req.socket?.remoteAddress || 
         req.connection?.remoteAddress ||
         'unknown';
}

module.exports = auditLogger;
