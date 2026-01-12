// src/models/CaregiverPayRate.js
const mongoose = require('mongoose');

const caregiverPayRateSchema = new mongoose.Schema({
  // Reference to caregiver
  caregiver_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Caregiver',
    required: true,
    unique: true,
    index: true
  },
  
  // Pay rates
  hourly_rate: {
    type: Number,
    required: true,
    min: 0,
    default: 20.00,
    decimal: true,
    description: 'Base hourly rate in USD'
  },
  
  overtime_multiplier: {
    type: Number,
    default: 1.5,
    min: 1,
    description: 'Multiplier for overtime hours (default 1.5x)'
  },
  
  // Effective date for this rate
  effective_date: {
    type: Date,
    required: true,
    default: Date.now,
    index: true
  },
  
  // End date if rate is no longer active
  end_date: {
    type: Date,
    default: null,
    description: 'Date this rate ends (null = currently active)'
  },
  
  // Reason for rate change
  reason: {
    type: String,
    default: '',
    enum: [
      '',
      'merit_increase',
      'promotion',
      'market_adjustment',
      'new_hire',
      'certification',
      'annual_review',
      'reclassification'
    ]
  },
  
  // Who set/changed this rate
  set_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Notes about this rate
  notes: {
    type: String,
    default: ''
  },
  
  // Audit trail
  created_at: {
    type: Date,
    default: Date.now
  },
  
  updated_at: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'caregiver_pay_rates',
  timestamps: true
});

// Compound index for finding active rates
caregiverPayRateSchema.index({ 
  caregiver_id: 1, 
  effective_date: -1 
});

// Text index for searching notes/reasons
caregiverPayRateSchema.index({ 
  notes: 'text',
  reason: 'text'
});

// Pre-save hook to validate and update timestamp
caregiverPayRateSchema.pre('save', function(next) {
  this.updated_at = new Date();
  
  // Validate that end_date is after effective_date
  if (this.end_date && this.end_date <= this.effective_date) {
    throw new Error('End date must be after effective date');
  }
  
  next();
});

// Static method to get current pay rate for a caregiver
caregiverPayRateSchema.statics.getCurrentRate = async function(caregiverId) {
  const rate = await this.findOne({
    caregiver_id: caregiverId,
    effective_date: { $lte: new Date() },
    $or: [
      { end_date: null },
      { end_date: { $gt: new Date() } }
    ]
  }).lean();
  
  if (!rate) {
    // Return default rate if none found
    return {
      caregiver_id: caregiverId,
      hourly_rate: parseFloat(process.env.DEFAULT_HOURLY_RATE || 20),
      overtime_multiplier: parseFloat(process.env.OVERTIME_MULTIPLIER || 1.5)
    };
  }
  
  return rate;
};

// Static method to get all rates for a caregiver (history)
caregiverPayRateSchema.statics.getRateHistory = async function(caregiverId) {
  return this.find({
    caregiver_id: caregiverId
  }).sort({ effective_date: -1 }).lean();
};

// Static method to update pay rate
caregiverPayRateSchema.statics.updateRate = async function(caregiverId, newRate, userId, reason = '', notes = '') {
  // End the current active rate
  const currentRate = await this.findOne({
    caregiver_id: caregiverId,
    effective_date: { $lte: new Date() },
    $or: [
      { end_date: null },
      { end_date: { $gt: new Date() } }
    ]
  });
  
  if (currentRate) {
    currentRate.end_date = new Date();
    await currentRate.save();
  }
  
  // Create new rate
  const updatedRate = new this({
    caregiver_id: caregiverId,
    hourly_rate: newRate,
    effective_date: new Date(),
    set_by: userId,
    reason: reason,
    notes: notes
  });
  
  return updatedRate.save();
};

// Instance method to get annual cost at current rate
caregiverPayRateSchema.methods.getAnnualCost = function(hoursPerWeek = 40) {
  return parseFloat((this.hourly_rate * hoursPerWeek * 52).toFixed(2));
};

// Instance method to get weekly cost
caregiverPayRateSchema.methods.getWeeklyCost = function(hoursPerWeek = 40) {
  return parseFloat((this.hourly_rate * hoursPerWeek).toFixed(2));
};

// Instance method to check if rate is active
caregiverPayRateSchema.methods.isActive = function() {
  const now = new Date();
  return this.effective_date <= now && (!this.end_date || this.end_date > now);
};

// Instance method to get formatted hourly rate
caregiverPayRateSchema.methods.getFormattedRate = function() {
  return `$${this.hourly_rate.toFixed(2)}/hr`;
};

module.exports = mongoose.model('CaregiverPayRate', caregiverPayRateSchema);
