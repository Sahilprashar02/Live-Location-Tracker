const express = require('express');
const passport = require('passport');
const router = express.Router();

const clientRedirect = (suffix = '') => {
  const base = process.env.CLIENT_URL || '/';
  return base === '/' ? `/${suffix}` : `${base}${suffix}`;
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
    failureRedirect: clientRedirect('?error=auth_failed'),
  }),
  (req, res) => {
    res.redirect(clientRedirect());
  }
);

// Get current authenticated user
router.get('/me', (req, res) => {
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
