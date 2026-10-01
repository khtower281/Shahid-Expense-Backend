const { verifyToken } = require('../util/token.util');

/**
 * Protects routes.
 * Expects header: Authorization: Bearer <token>
 */
const protect = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided, access denied' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);

    req.admin = decoded; // attach admin info to request
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

module.exports = protect;