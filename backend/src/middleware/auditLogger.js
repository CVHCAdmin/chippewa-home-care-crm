// src/middleware/auditLogger.js
const AuditLog = require('../models/AuditLog');

/**
 * Audit Logger Middleware
 * 
 * This middleware logs all non-GET requests to the audit_logs collection.
 * It captures:
 * - User information
 * - Action taken (create, update, delete)
 * - Entity type and ID
 * - Changes made (old vs new values)
 * - Network information
 * - Suspicious activity flags
 */

const auditLogger = async (req, res, next) => {
  // Skip audit logging for read-only report endpoints (POST that don't mutate data)
  if (req.path.startsWith('/api/reports')) {
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
      // Only log non-GET requests and successful operations
      if (req.method !== 'GET' && res.statusCode < 400) {
        const auditData = extractAuditData(req, res, requestBody, responseBody);
        
        // Save to database
        await AuditLog.createAuditLog(auditData);
      }
      // Log failed operations too (for security)
      else if (req.method !== 'GET' && res.statusCode >= 400) {
        const auditData = extractAuditData(req, res, requestBody, responseBody);
        auditData.flags = ['access_denied'];
        await AuditLog.createAuditLog(auditData);
      }
      // Log failed logins
      else if (req.path.includes('/login') && res.statusCode >= 400) {
        await AuditLog.createAuditLog({
          timestamp: new Date(),
          user_id: null,
          user_name: req.body?.email || 'Unknown',
          action: 'failed_login',
          entity_type: 'user',
          entity_id: 'login-attempt',
          ip_address: extractIP(req),
          user_agent: req.get('user-agent'),
          flags: ['multiple_failed_login'],
          status_code: res.statusCode,
          is_sensitive: true
        });
      }
    } catch (error) {
      console.error('Error logging audit:', error);
      // Don't throw - audit logging shouldn't break the app
    }
  });

  next();
};

/**
 * Extract audit data from request/response
 */
function extractAuditData(req, res, requestBody, responseBody) {
  const entityInfo = extractEntityInfo(req);
  const changes = extractChanges(req, responseBody);
  const flags = AuditLog.checkSuspiciousActivity(req);

  return {
    timestamp: new Date(),
    user_id: req.user?.id || req.user?._id || null,
    user_name: req.user?.name || req.user?.email || 'System',
    action: mapMethodToAction(req.method),
    entity_type: entityInfo.entityType,
    entity_id: entityInfo.entityId,
    changes: changes,
    change_description: generateChangeDescription(changes),
    ip_address: extractIP(req),
    user_agent: req.get('user-agent'),
    flags: flags,
    status_code: res.statusCode,
    is_sensitive: isSensitiveOperation(req, entityInfo),
    metadata: {
      path: req.path,
      method: req.method,
      query: req.query
    }
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
  return map[method] || 'other';
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
    
    // Map plural to singular
    if (resource.endsWith('s')) {
      entityType = resource.slice(0, -1);
    } else {
      entityType = resource;
    }
    
    // Extract entity ID
    if (pathParts.length > 1) {
      entityId = pathParts[1];
    }
  }

  // Normalize entity type
  const entityTypeMap = {
    'client': 'client',
    'caregiver': 'caregiver',
    'schedule': 'schedule',
    'invoice': 'invoice',
    'care-plan': 'care_plan',
    'carePlan': 'care_plan',
    'incident': 'incident',
    'user': 'user',
    'payroll': 'payroll',
    'audit-log': 'audit_log'
  };

  entityType = entityTypeMap[entityType] || entityType;

  return { entityType, entityId };
}

/**
 * Extract what changed in the request
 */
function extractChanges(req, responseBody) {
  const changes = {};

  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    // For create/update, log the fields that were sent
    if (req.body && typeof req.body === 'object') {
      for (const [key, value] of Object.entries(req.body)) {
        // Skip sensitive fields and passwords
        if (!['password', 'token', 'secret', 'key'].some(s => key.toLowerCase().includes(s))) {
          changes[key] = {
            old_value: req.method === 'POST' ? null : 'existing',
            new_value: JSON.stringify(value).substring(0, 100) // Limit string size
          };
        }
      }
    }
  }

  return changes;
}

/**
 * Generate human-readable description of changes
 */
function generateChangeDescription(changes) {
  if (Object.keys(changes).length === 0) {
    return null;
  }

  const changedFields = Object.keys(changes);
  const fieldList = changedFields.join(', ');
  
  return `Modified fields: ${fieldList}`;
}

/**
 * Check if operation is sensitive
 */
function isSensitiveOperation(req, entityInfo) {
  const sensitiveEntities = ['user', 'caregiver', 'client'];
  const sensitiveActions = ['delete', 'role', 'permission'];
  
  const isSensitiveEntity = sensitiveEntities.includes(entityInfo.entityType);
  const isSensitiveAction = sensitiveActions.some(action => 
    req.path.toLowerCase().includes(action) || 
    Object.keys(req.body || {}).some(key => key.toLowerCase().includes(action))
  );
  
  return isSensitiveEntity || isSensitiveAction;
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

/**
 * Clean up sensitive data from logs (passwords, etc)
 */
function sanitizeData(data) {
  if (!data) return data;

  const sensitiveFields = ['password', 'token', 'secret', 'apiKey'];
  
  if (typeof data === 'object') {
    const cleaned = { ...data };
    for (const field of sensitiveFields) {
      if (cleaned[field]) {
        cleaned[field] = '[REDACTED]';
      }
    }
    return cleaned;
  }

  return data;
}

module.exports = auditLogger;
