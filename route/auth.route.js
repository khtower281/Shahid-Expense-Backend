const express = require('express');
const { login, getMe } = require('../controller/auth.controller');
const protect = require('../middleware/auth.middleware');

const router = express.Router();

// POST /api/auth/login
router.post('/login', login);

// GET /api/auth/me  (protected)
router.get('/me', protect, getMe);

module.exports = router;