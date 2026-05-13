const express = require('express');
const passport = require('passport');
const router = express.Router();
const jwt = require('jsonwebtoken');

const clientRedirect = (suffix = '') => {
  const base = process.env.CLIENT_URL || '/';
  const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return cleanBase + suffix;
};

// Initiate Google OAuth flow
router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
  })
);

// Google OAuth callback
router.get(
  '/google/callback',
  passport.authenticate('google', {
    failureRedirect: clientRedirect('/?error=auth_failed'),
  }),
  (req, res) => {
    // Generate JWT for cross-domain auth (Vercel)
    const token = jwt.sign(
      { id: req.user._id, displayName: req.user.displayName },
      process.env.SESSION_SECRET,
      { expiresIn: '24h' }
    );

    // Redirect to frontend with token in query param
    res.redirect(clientRedirect(`/?token=${token}`));
  }
);

// Get current authenticated user
router.get('/me', async (req, res) => {
  // 1. Check Passport session (for local dev or if cookies work)
  if (req.isAuthenticated()) {
    return res.json({
      success: true,
      user: {
        id: req.user._id,
        displayName: req.user.displayName,
        email: req.user.email,
        avatar: req.user.avatar,
      },
    });
  }

  // 2. Check JWT (for Vercel cross-domain/Incognito)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, process.env.SESSION_SECRET);
      const User = require('../models/User');
      const user = await User.findById(decoded.id);
      if (user) {
        return res.json({
          success: true,
          user: {
            id: user._id,
            displayName: user.displayName,
            email: user.email,
            avatar: user.avatar,
          },
        });
      }
    } catch (err) {
      console.error('JWT verify error:', err);
    }
  }

  return res.status(401).json({ success: false, message: 'Not authenticated' });
});

// Logout
router.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ success: false, message: 'Logout failed' });
    }
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error:', err);
      }
      res.clearCookie('connect.sid');
      res.redirect(clientRedirect());
    });
  });
});

module.exports = router;
