// src/models/Payroll.js
const mongoose = require('mongoose');

const payrollSchema = new mongoose.Schema({
  // Caregiver reference
  caregiver_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Caregiver',
    required: true,
    index: true
  },
  
  // Pay period dates
  pay_period_start: {
    type: Date,
    required: true
  },
  
  pay_period_end: {
    type: Date,
    required: true
  },
  
  // Hours worked
  regular_hours: {
    type: Number,
    default: 0,
    min: 0
  },
  
  overtime_hours: {
    type: Number,
    default: 0,
    min: 0
  },
  
  total_hours: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Pay rates
  hourly_rate: {
    type: Number,
    required: true,
    min: 0,
    decimal: true
  },
  
  overtime_multiplier: {
    type: Number,
    default: 1.5,
    min: 1
  },
  
  // Pay amounts
  regular_pay: {
    type: Number,
    default: 0,
    decimal: true
  },
  
  overtime_pay: {
    type: Number,
    default: 0,
    decimal: true
  },
  
  bonuses: {
    type: Number,
    default: 0,
    decimal: true
  },
  
  gross_pay: {
    type: Number,
    required: true,
    default: 0,
    decimal: true
  },
  
  // Taxes
  federal_tax: {
    type: Number,
    default: 0,
    decimal: true
  },
  
  social_security_tax: {
    type: Number,
    default: 0,
    decimal: true
  },
  
  medicare_tax: {
    type: Number,
    default: 0,
    decimal: true
  },
  
  other_deductions: {
    type: Number,
    default: 0,
    decimal: true
  },
  
  total_deductions: {
    type: Number,
    required: true,
    default: 0,
    decimal: true
  },
  
  // Net pay (take home)
  net_pay: {
    type: Number,
    required: true,
    default: 0,
    decimal: true
  },
  
  // Status tracking
  status: {
    type: String,
    enum: ['draft', 'approved', 'processed', 'paid'],
    default: 'draft',
    index: true
  },
  
  // Check information
  check_number: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  
  // Approval workflow
  approved_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  approved_at: {
    type: Date,
    default: null
  },
  
  // Processing workflow
  processed_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  processed_at: {
    type: Date,
    default: null
  },
  
  // Payment tracking
  paid_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  paid_at: {
    type: Date,
    default: null
  },
  
  payment_method: {
    type: String,
    enum: ['check', 'direct_deposit', 'cash'],
    default: null
  },
  
  // Notes
  notes: {
    type: String,
    default: ''
  },
  
  // Timestamps
  created_at: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  updated_at: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'payroll',
  timestamps: true
});

// Indexes for queries
payrollSchema.index({ caregiver_id: 1, pay_period_start: -1 });
payrollSchema.index({ status: 1, created_at: -1 });
payrollSchema.index({ pay_period_start: 1, pay_period_end: 1 });

// Pre-save hook to update timestamps
payrollSchema.pre('save', function(next) {
  this.updated_at = new Date();
  next();
});

// Static method to calculate payroll for a date range
payrollSchema.statics.calculatePayroll = async function(startDate, endDate) {
  const Caregiver = mongoose.model('Caregiver');
  const Schedule = mongoose.model('Schedule');
  const CaregiverPayRate = mongoose.model('CaregiverPayRate');
  
  const caregivers = await Caregiver.find({ deleted_at: null }).lean();
  const payrollData = [];
  
  for (const caregiver of caregivers) {
    // Get schedules for period
    const schedules = await Schedule.find({
      caregiver_id: caregiver._id,
      date: {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      }
    }).lean();
    
    // Calculate hours
    let regularHours = 0;
    let overtimeHours = 0;
    
    schedules.forEach(schedule => {
      const start = new Date(`2000-01-01 ${schedule.start_time}`);
      const end = new Date(`2000-01-01 ${schedule.end_time}`);
      const hours = (end - start) / (1000 * 60 * 60);
      
      if (regularHours + hours > 40) {
        const regularToAdd = Math.max(0, 40 - regularHours);
        regularHours += regularToAdd;
        overtimeHours += hours - regularToAdd;
      } else {
        regularHours += hours;
      }
    });
    
    // Get pay rate
    const payRate = await CaregiverPayRate.findOne({
      caregiver_id: caregiver._id
    }).lean();
    
    const hourlyRate = payRate?.hourly_rate || parseFloat(process.env.DEFAULT_HOURLY_RATE || 20);
    const overtimeMultiplier = payRate?.overtime_multiplier || parseFloat(process.env.OVERTIME_MULTIPLIER || 1.5);
    
    // Calculate pay
    const regularPay = parseFloat((regularHours * hourlyRate).toFixed(2));
    const overtimePay = parseFloat((overtimeHours * hourlyRate * overtimeMultiplier).toFixed(2));
    const bonuses = 0;
    const grossPay = parseFloat((regularPay + overtimePay + bonuses).toFixed(2));
    
    // Calculate taxes (simplified - adjust based on actual tax requirements)
    const federalTax = this.calculateFederalTax(grossPay);
    const socialSecurityTax = Math.min(
      parseFloat((grossPay * parseFloat(process.env.SOCIAL_SECURITY_RATE || 0.062)).toFixed(2)),
      parseFloat(((parseFloat(process.env.SOCIAL_SECURITY_WAGE_LIMIT || 168600) / 26) * parseFloat(process.env.SOCIAL_SECURITY_RATE || 0.062)).toFixed(2))
    );
    const medicareTax = parseFloat((grossPay * parseFloat(process.env.MEDICARE_RATE || 0.0145)).toFixed(2));
    const otherDeductions = 0;
    const totalDeductions = parseFloat((federalTax + socialSecurityTax + medicareTax + otherDeductions).toFixed(2));
    const netPay = parseFloat((grossPay - totalDeductions).toFixed(2));
    
    payrollData.push({
      caregiver_id: caregiver._id,
      first_name: caregiver.first_name,
      last_name: caregiver.last_name,
      pay_period_start: startDate,
      pay_period_end: endDate,
      regular_hours: regularHours,
      overtime_hours: overtimeHours,
      total_hours: regularHours + overtimeHours,
      hourly_rate: hourlyRate,
      regular_pay: regularPay,
      overtime_pay: overtimePay,
      bonuses: bonuses,
      gross_pay: grossPay,
      federal_tax: federalTax,
      social_security_tax: socialSecurityTax,
      medicare_tax: medicareTax,
      other_deductions: otherDeductions,
      total_deductions: totalDeductions,
      net_pay: netPay,
      status: 'draft'
    });
  }
  
  return payrollData;
};

// Static method to calculate federal tax (simplified 2024)
payrollSchema.statics.calculateFederalTax = function(grossPay) {
  // Simplified weekly calculation - adjust for actual requirements
  const weeklyGross = grossPay / 52;
  const standardDeduction = parseFloat(process.env.FEDERAL_TAX_STANDARD_DEDUCTION || 13850) / 52;
  const taxableIncome = Math.max(0, weeklyGross - standardDeduction);
  
  // 2024 tax brackets (single filer)
  let tax = 0;
  if (taxableIncome <= 241) {
    tax = 0;
  } else if (taxableIncome <= 996) {
    tax = (taxableIncome - 241) * 0.10;
  } else if (taxableIncome <= 3314) {
    tax = 75.50 + (taxableIncome - 996) * 0.12;
  } else if (taxableIncome <= 9610) {
    tax = 357.66 + (taxableIncome - 3314) * 0.22;
  } else if (taxableIncome <= 20619) {
    tax = 1393.68 + (taxableIncome - 9610) * 0.24;
  } else {
    tax = 4241.44 + (taxableIncome - 20619) * 0.32;
  }
  
  // Annual from weekly
  return parseFloat((tax * 52).toFixed(2));
};

// Static method to generate check number
payrollSchema.statics.generateCheckNumber = function() {
  return `CHK-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`;
};

// Instance method to approve payroll
payrollSchema.methods.approve = async function(userId) {
  if (this.status !== 'draft') {
    throw new Error(`Cannot approve payroll with status: ${this.status}`);
  }
  
  this.status = 'approved';
  this.approved_by = userId;
  this.approved_at = new Date();
  
  return this.save();
};

// Instance method to process paycheck
payrollSchema.methods.process = async function(userId) {
  if (this.status !== 'approved') {
    throw new Error(`Cannot process payroll with status: ${this.status}`);
  }
  
  this.status = 'processed';
  this.processed_by = userId;
  this.processed_at = new Date();
  this.check_number = this.constructor.generateCheckNumber();
  
  return this.save();
};

// Instance method to mark as paid
payrollSchema.methods.markPaid = async function(userId, paymentMethod = 'check') {
  if (this.status !== 'processed') {
    throw new Error(`Cannot mark payroll as paid with status: ${this.status}`);
  }
  
  this.status = 'paid';
  this.paid_by = userId;
  this.paid_at = new Date();
  this.payment_method = paymentMethod;
  
  return this.save();
};

module.exports = mongoose.model('Payroll', payrollSchema);
