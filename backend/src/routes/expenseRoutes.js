// routes/expenseRoutes.js — mounted at /api via app.use('/api', expenseRoutes)
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { verifyToken, requireAdmin, auditLog } = require('../middleware/shared');
// ─── EXPENSES ─────────────────────────────────────────────────────────────────

router.get('/expenses/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [total, byCategory, byMonth] = await Promise.all([
      db.query(`SELECT SUM(amount) as total_expenses, COUNT(*) as expense_count, AVG(amount) as average_expense FROM expenses`),
      db.query(`SELECT category, COUNT(*) as count, SUM(amount) as total, AVG(amount) as average FROM expenses GROUP BY category ORDER BY total DESC`),
      db.query(`SELECT DATE_TRUNC('month', expense_date)::DATE as month, SUM(amount) as total FROM expenses GROUP BY DATE_TRUNC('month', expense_date) ORDER BY month DESC LIMIT 12`),
    ]);
    res.json({ total: total.rows[0], byCategory: byCategory.rows, byMonth: byMonth.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/expenses/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM expenses WHERE id=$1`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/expenses', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { category, startDate, endDate, paymentMethod } = req.query;
    let query = `SELECT * FROM expenses WHERE 1=1`;
    const params = [];
    let i = 1;
    if (category) { query += ` AND category=$${i++}`; params.push(category); }
    if (startDate) { query += ` AND expense_date>=$${i++}`; params.push(startDate); }
    if (endDate) { query += ` AND expense_date<=$${i++}`; params.push(endDate); }
    if (paymentMethod) { query += ` AND payment_method=$${i++}`; params.push(paymentMethod); }
    query += ` ORDER BY expense_date DESC`;
    res.json((await db.query(query, params)).rows);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/expenses', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { expenseDate, category, description, amount, paymentMethod, notes, receiptUrl } = req.body;
    if (!expenseDate || !category || !amount) return res.status(400).json({ error: 'expenseDate, category, and amount are required' });
    const expenseId = uuidv4();
    const result = await db.query(
      `INSERT INTO expenses (id, expense_date, category, description, amount, payment_method, notes, receipt_url, submitted_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [expenseId, expenseDate, category, description||null, amount, paymentMethod||null, notes||null, receiptUrl||null, req.user.id]
    );
    await auditLog(req.user.id, 'CREATE', 'expenses', expenseId, null, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.put('/expenses/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { expenseDate, category, description, amount, paymentMethod, notes, receiptUrl } = req.body;
    const result = await db.query(
      `UPDATE expenses SET expense_date=COALESCE($1,expense_date), category=COALESCE($2,category), description=COALESCE($3,description),
        amount=COALESCE($4,amount), payment_method=COALESCE($5,payment_method), notes=COALESCE($6,notes), receipt_url=COALESCE($7,receipt_url), updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [expenseDate, category, description, amount, paymentMethod, notes, receiptUrl, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    await auditLog(req.user.id, 'UPDATE', 'expenses', req.params.id, null, result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/expenses/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM expenses WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    await auditLog(req.user.id, 'DELETE', 'expenses', req.params.id, null, result.rows[0]);
    res.json({ message: 'Expense deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ─── COMPLIANCE ───────────────────────────────────────────────────────────────

router.get('/compliance/summary', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [expiredBg, expiredTraining, trainingByType, bgStatus] = await Promise.all([
      db.query(`SELECT COUNT(*) as expired_bg FROM background_checks WHERE expiration_date < CURRENT_DATE`),
      db.query(`SELECT COUNT(*) as expired_training FROM training_records WHERE expiration_date < CURRENT_DATE AND status != 'expired'`),
      db.query(`SELECT training_type, COUNT(*) as count FROM training_records WHERE status='completed' GROUP BY training_type ORDER BY count DESC`),
      db.query(`SELECT status, COUNT(*) as count FROM background_checks GROUP BY status`),
    ]);
    res.json({ expiredBackgroundChecks: expiredBg.rows[0].expired_bg, expiredTraining: expiredTraining.rows[0].expired_training, trainingByType: trainingByType.rows, backgroundCheckStatus: bgStatus.rows });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/training-records/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM training_records WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Training record not found' });
    await auditLog(req.user.id, 'DELETE', 'training_records', req.params.id, null, result.rows[0]);
    res.json({ message: 'Training record deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/compliance-documents/:id', verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM compliance_documents WHERE id=$1 RETURNING *`, [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Document not found' });
    await auditLog(req.user.id, 'DELETE', 'compliance_documents', req.params.id, null, result.rows[0]);
    res.json({ message: 'Document deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.delete('/blackout-dates/:dateId', verifyToken, async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM caregiver_blackout_dates WHERE id=$1 RETURNING *`, [req.params.dateId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Blackout date not found' });
    await auditLog(req.user.id, 'DELETE', 'caregiver_blackout_dates', req.params.dateId, null, result.rows[0]);
    res.json({ message: 'Blackout date deleted' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
module.exports = router;
