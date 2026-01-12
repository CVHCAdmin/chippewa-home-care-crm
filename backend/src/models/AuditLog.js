// src/models/AuditLog.js
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  // Core audit fields
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
    required: true
  },
  
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
    required: true
  },
  
  user_name: {
    type: String,
    required: true
  },
  
  // Action and entity information
  action: {
    type: String,
    enum: ['create', 'update', 'delete', 'login', 'access', 'export', 'failed_login'],
    index: true,
    required: true
  },
  
  entity_type: {
    type: String,
    enum: ['client', 'caregiver', 'schedule', 'invoice', 'care_plan', 'incident', 'user', 'payroll'],
    index: true,
    required: true
  },
  
  entity_id: {
    type: String,
    required: true,
    index: true
  },
  
  // Details of what changed
  changes: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  change_description: {
    type: String,
    default: null
  },
  
  // Network/Access information
  ip_address: {
    type: String,
    default: null
  },
  
  user_agent: {
    type: String,
    default: null
  },
  
  // Security flags
  flags: {
    type: [String],
    default: [],
    enum: [
      'bulk_operation',
      'after_hours_access',
      'data_export',
      'permission_change',
      'delete_operation',
      'multiple_failed_login',
      'unusual_access_pattern',
      'access_denied',
      'bulk_delete',
      'unusual_ip',
      'rapid_access'
    ]
  },
  
  // HTTP response status code
  status_code: {
    type: Number,
    default: 200
  },
  
  // For tracking sensitive operations
  is_sensitive: {
    type: Boolean,
    default: false
  },
  
  // Additional context
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Compliance tracking
  retention_until: {
    type: Date,
    default: () => {
      const date = new Date();
      date.setFullYear(date.getFullYear() + (parseInt(process.env.AUDIT_LOG_RETENTION_YEARS || 6)));
      return date;
    }
  },
  
  archived: {
    type: Boolean,
    default: false
  },
  
  created_at: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'audit_logs',
  strict: false // Allow additional fields for flexibility
});

// Compound indexes for common queries
auditLogSchema.index({ timestamp: -1, user_id: 1 });
auditLogSchema.index({ action: 1, entity_type: 1 });
auditLogSchema.index({ entity_type: 1, entity_id: 1 });

// Text index for search
auditLogSchema.index({ 
  user_name: 'text', 
  change_description: 'text' 
});

// Make audit logs immutable - prevent updates and deletes
auditLogSchema.pre('findByIdAndUpdate', function(next) {
  throw new Error('Audit logs are immutable and cannot be modified');
});

auditLogSchema.pre('findByIdAndDelete', function(next) {
  throw new Error('Audit logs are immutable and cannot be deleted');
});

// Prevent any updates
auditLogSchema.pre('updateOne', function(next) {
  throw new Error('Audit logs are immutable and cannot be modified');
});

// Prevent deletes
auditLogSchema.pre('deleteOne', function(next) {
  throw new Error('Audit logs are immutable and cannot be deleted');
});

// Static method to create audit log safely
auditLogSchema.statics.createAuditLog = async function(auditData) {
  try {
    const auditLog = new this(auditData);
    return await auditLog.save();
  } catch (error) {
    console.error('Error creating audit log:', error);
    // Don't throw - audit logging shouldn't break the app
    return null;
  }
};

// Static method to get logs with filtering
auditLogSchema.statics.getFilteredLogs = async function(filters) {
  const query = {};
  
  if (filters.startDate || filters.endDate) {
    query.timestamp = {};
    if (filters.startDate) {
      query.timestamp.$gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      query.timestamp.$lte = new Date(filters.endDate);
    }
  }
  
  if (filters.userId) {
    query.user_id = filters.userId;
  }
  
  if (filters.action) {
    query.action = filters.action;
  }
  
  if (filters.entityType) {
    query.entity_type = filters.entityType;
  }
  
  return this.find(query).sort({ timestamp: -1 }).lean();
};

// Static method to flag suspicious activity
auditLogSchema.statics.checkSuspiciousActivity = function(req) {
  const flags = [];
  
  // Bulk operations (>50 records)
  if (req.body?.ids?.length > 50) {
    flags.push('bulk_operation');
  }
  
  // After-hours access (6 PM - 6 AM)
  const hour = new Date().getHours();
  if (hour < 6 || hour > 18) {
    flags.push('after_hours_access');
  }
  
  // Data exports
  if (req.path.includes('export')) {
    flags.push('data_export');
  }
  
  // Permission/role changes
  if (req.body?.role || req.body?.permissions || req.body?.is_admin) {
    flags.push('permission_change');
  }
  
  // Delete operations
  if (req.method === 'DELETE') {
    flags.push('delete_operation');
  }
  
  // Bulk delete (if deleting many items)
  if (req.method === 'DELETE' && req.body?.ids?.length > 10) {
    flags.push('bulk_delete');
  }
  
  return flags;
};

// Instance method to get human-readable description
auditLogSchema.methods.getDescription = function() {
  const action = this.action.charAt(0).toUpperCase() + this.action.slice(1);
  const entity = this.entity_type.charAt(0).toUpperCase() + this.entity_type.slice(1);
  
  return `${this.user_name} ${action}d ${entity} (${this.entity_id})`;
};

module.exports = mongoose.model('AuditLog', auditLogSchema);
