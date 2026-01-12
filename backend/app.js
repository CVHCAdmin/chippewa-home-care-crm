// ADD these at the top
const auditLogger = require('./middleware/auditLogger');
const authorizeAdmin = require('./middleware/authorizeAdmin');

// ADD before your existing routes (IMPORTANT!)
app.use(auditLogger);

// ADD with your other routes
app.use('/api/reports', authenticate, require('./routes/reports'));
app.use('/api/payroll', authenticate, require('./routes/payroll'));
app.use('/api/audit-logs', authenticate, require('./routes/auditLogs'));
app.use('/api/users', authenticate, require('./routes/users'));