// src/routes/users.js
const express = require('express');
const router = express.Router();

/**
 * GET /api/users/admins
 * Get list of admin users
 */
router.get('/admins', async (req, res) => {
  try {
    res.json({
      success: true,
      users: [],
      count: 0
    });
  } catch (error) {
    console.error('Error fetching admins:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/users/caregivers
 * Get list of caregivers
 */
router.get('/caregivers', async (req, res) => {
  try {
    res.json({
      success: true,
      users: [],
      count: 0
    });
  } catch (error) {
    console.error('Error fetching caregivers:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/users/all
 * Get all users (admin + caregivers)
 */
router.get('/all', async (req, res) => {
  try {
    res.json({
      success: true,
      users: [],
      count: 0
    });
  } catch (error) {
    console.error('Error fetching all users:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
