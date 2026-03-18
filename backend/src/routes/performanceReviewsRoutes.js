// src/routes/performanceReviewsRoutes.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { requireAdmin } = require('../middleware/shared');

// GET /api/performance-reviews - List all reviews
router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT pr.*, pr.rating_date as review_date,
              u.first_name as caregiver_first_name, u.last_name as caregiver_last_name,
              c.first_name as client_first_name, c.last_name as client_last_name
       FROM performance_ratings pr
       LEFT JOIN users u ON pr.caregiver_id = u.id
       LEFT JOIN clients c ON pr.client_id = c.id
       ORDER BY pr.rating_date DESC`
    );
    // Parse comments JSON to extract structured fields the frontend expects
    const rows = result.rows.map(row => {
      let parsed = {};
      if (row.comments) {
        try { parsed = typeof row.comments === 'string' ? JSON.parse(row.comments) : row.comments; } catch (e) { /* ignore */ }
      }
      return {
        ...row,
        performance_notes: parsed.performance_notes || row.comments || '',
        strengths: parsed.strengths || '',
        areas_for_improvement: parsed.areas_for_improvement || '',
        overall_assessment: parsed.overall_assessment || 'satisfactory',
      };
    });
    res.json(rows);
  } catch (error) {
    console.error('Error loading performance reviews:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/performance-reviews - Create a review
router.post('/', requireAdmin, async (req, res) => {
  try {
    const {
      caregiverId,
      clientId,
      reviewDate,
      performanceNotes,
      strengths,
      areasForImprovement,
      overallAssessment
    } = req.body;

    if (!caregiverId || !clientId) {
      return res.status(400).json({ error: 'Caregiver and Client are required' });
    }

    // Map overall assessment to a satisfaction score for the dashboard
    const satisfactionMap = { excellent: 5, satisfactory: 3, needs_improvement: 1 };
    const satisfactionScore = satisfactionMap[overallAssessment] || 3;

    const id = uuidv4();
    const result = await db.query(
      `INSERT INTO performance_ratings (
        id, caregiver_id, client_id, rating_date,
        satisfaction_score, comments,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING *`,
      [
        id,
        caregiverId,
        clientId,
        reviewDate || new Date().toISOString().split('T')[0],
        satisfactionScore,
        JSON.stringify({
          performance_notes: performanceNotes,
          strengths: strengths,
          areas_for_improvement: areasForImprovement,
          overall_assessment: overallAssessment
        })
      ]
    );

    // Return with the fields the frontend expects
    const row = result.rows[0];
    res.status(201).json({
      ...row,
      performance_notes: performanceNotes,
      strengths: strengths,
      areas_for_improvement: areasForImprovement,
      overall_assessment: overallAssessment,
      review_date: row.rating_date
    });
  } catch (error) {
    console.error('Error creating performance review:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/performance-reviews/:id - Delete a review
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      'DELETE FROM performance_ratings WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting performance review:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
