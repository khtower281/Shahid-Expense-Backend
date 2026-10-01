const jwt = require('jsonwebtoken');

/**
 * Generate a JWT for the admin user.
 * @param {Object} payload - data to embed in token
 * @returns {string} signed JWT
 */
const generateToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
};

/**
 * Verify a JWT and return the decoded payload.
 * Throws if invalid/expired.
 * @param {string} token
 * @returns {Object} decoded payload
 */
const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};

module.exports = { generateToken, verifyToken };