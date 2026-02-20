// __tests__/payroll.test.js
// Unit tests for payroll calculation logic

// ── Helper functions extracted from server.js payroll run ────────────────────

/**
 * Calculate hours worked from duration_minutes (the actual DB column)
 */
function calcHoursFromMinutes(durationMinutes, billableMinutes) {
  const mins = billableMinutes ?? durationMinutes ?? 0;
  return parseFloat((mins / 60).toFixed(4));
}

/**
 * Calculate gross pay with overtime
 */
function calcGrossPay(totalHours, hourlyRate, overtimeMultiplier = 1.5) {
  const regularHours  = Math.min(totalHours, 40);
  const overtimeHours = Math.max(totalHours - 40, 0);
  const regularPay    = regularHours * hourlyRate;
  const overtimePay   = overtimeHours * hourlyRate * overtimeMultiplier;
  return {
    regularHours:  parseFloat(regularHours.toFixed(4)),
    overtimeHours: parseFloat(overtimeHours.toFixed(4)),
    regularPay:    parseFloat(regularPay.toFixed(2)),
    overtimePay:   parseFloat(overtimePay.toFixed(2)),
    grossPay:      parseFloat((regularPay + overtimePay).toFixed(2)),
  };
}

/**
 * Calculate tax withholdings
 */
function calcTaxes(grossPay, {
  ssRate    = 0.062,
  ssLimit   = 160200,
  medicare  = 0.0145,
  ytdEarnings = 0,
} = {}) {
  const ssWages = Math.min(grossPay, Math.max(ssLimit - ytdEarnings, 0));
  const ssTax   = parseFloat((ssWages * ssRate).toFixed(2));
  const medTax  = parseFloat((grossPay * medicare).toFixed(2));
  return { ssTax, medTax, totalTax: parseFloat((ssTax + medTax).toFixed(2)) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Hours calculation', () => {
  test('converts duration_minutes to hours correctly', () => {
    expect(calcHoursFromMinutes(480, null)).toBe(8);       // 8-hour shift
    expect(calcHoursFromMinutes(90, null)).toBe(1.5);      // 90-minute shift
    expect(calcHoursFromMinutes(0, null)).toBe(0);         // zero
    expect(calcHoursFromMinutes(null, null)).toBe(0);      // null safety
  });

  test('prefers billable_minutes over duration_minutes', () => {
    expect(calcHoursFromMinutes(480, 450)).toBe(7.5);      // 450 billable vs 480 actual
    expect(calcHoursFromMinutes(480, 0)).toBe(0);          // billable=0 means unpaid
  });

  test('handles partial hours', () => {
    expect(calcHoursFromMinutes(75, null)).toBeCloseTo(1.25, 4);
    expect(calcHoursFromMinutes(45, null)).toBeCloseTo(0.75, 4);
  });
});

describe('Gross pay calculation', () => {
  test('regular time under 40 hours', () => {
    const result = calcGrossPay(32, 15);
    expect(result.regularHours).toBe(32);
    expect(result.overtimeHours).toBe(0);
    expect(result.grossPay).toBe(480);
    expect(result.overtimePay).toBe(0);
  });

  test('overtime beyond 40 hours', () => {
    const result = calcGrossPay(45, 20);
    expect(result.regularHours).toBe(40);
    expect(result.overtimeHours).toBe(5);
    expect(result.regularPay).toBe(800);
    expect(result.overtimePay).toBe(150);
    expect(result.grossPay).toBe(950);
  });

  test('exactly 40 hours — no overtime', () => {
    const result = calcGrossPay(40, 18);
    expect(result.overtimeHours).toBe(0);
    expect(result.grossPay).toBe(720);
  });

  test('zero hours', () => {
    const result = calcGrossPay(0, 15);
    expect(result.grossPay).toBe(0);
  });

  test('custom overtime multiplier', () => {
    const result = calcGrossPay(42, 20, 2.0); // double-time
    expect(result.overtimePay).toBe(80);       // 2 hrs * $20 * 2.0
  });
});

describe('Tax calculations', () => {
  test('standard SS and Medicare', () => {
    const taxes = calcTaxes(1000);
    expect(taxes.ssTax).toBe(62);      // 6.2% of 1000
    expect(taxes.medTax).toBe(14.50);  // 1.45% of 1000
    expect(taxes.totalTax).toBe(76.50);
  });

  test('SS wage base limit respected', () => {
    // If employee already earned $160,100 YTD, only $100 more is SS-taxable
    const taxes = calcTaxes(500, { ssLimit: 160200, ytdEarnings: 160100 });
    expect(taxes.ssTax).toBe(parseFloat((100 * 0.062).toFixed(2)));
    expect(taxes.medTax).toBe(parseFloat((500 * 0.0145).toFixed(2)));
  });

  test('past SS wage limit — no SS tax', () => {
    const taxes = calcTaxes(500, { ssLimit: 160200, ytdEarnings: 160200 });
    expect(taxes.ssTax).toBe(0);
    expect(taxes.medTax).toBeGreaterThan(0);
  });

  test('zero gross — zero taxes', () => {
    const taxes = calcTaxes(0);
    expect(taxes.totalTax).toBe(0);
  });
});

describe('End-to-end payroll scenario', () => {
  test('caregiver works 46 hours at $18/hr', () => {
    const hours    = calcHoursFromMinutes(46 * 60, null);
    const payBreakdown = calcGrossPay(hours, 18);
    const taxes    = calcTaxes(payBreakdown.grossPay);
    const netPay   = parseFloat((payBreakdown.grossPay - taxes.totalTax).toFixed(2));

    expect(hours).toBe(46);
    expect(payBreakdown.regularPay).toBe(720);   // 40 * 18
    expect(payBreakdown.overtimePay).toBe(162);  // 6 * 18 * 1.5
    expect(payBreakdown.grossPay).toBe(882);
    expect(taxes.ssTax).toBe(54.68);             // 882 * 0.062
    expect(taxes.medTax).toBe(12.79);            // 882 * 0.0145
    expect(netPay).toBe(814.53);
  });
});
