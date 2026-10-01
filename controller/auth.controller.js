const { generateToken } = require('../util/token.util');

/**
 * @desc    Login with static admin credentials
 * @route   POST /api/auth/login
 * @access  Public
 */
const login = (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  if (username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const token = generateToken({ username, role: 'admin' });

  return res.status(200).json({
    message: 'Login successful',
    token,
    admin: { username, role: 'admin' }
  });
};

/**
 * @desc    Verify token & return admin info
 * @route   GET /api/auth/me
 * @access  Private
 */
const getMe = (req, res) => {
  return res.status(200).json({ admin: req.admin });
};

module.exports = { login, getMe };