const jwt = require('jsonwebtoken');
const User = require('../models/User');

const getRequestUser = async (req) => {
  if (req.user?._id) return req.user;

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;

  try {
    const decoded = jwt.verify(authHeader.slice(7), process.env.SESSION_SECRET);
    return await User.findById(decoded.id);
  } catch {
    return null;
  }
};

const requireAuth = async (req, res, next) => {
  const user = await getRequestUser(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  req.authUser = user;
  next();
};

module.exports = { getRequestUser, requireAuth };
