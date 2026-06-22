const crypto = require('crypto');
const express = require('express');
const ShareSession = require('../models/ShareSession');
const LocationHistory = require('../models/LocationHistory');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const serialize = (session) => ({
  id: session._id,
  shareCode: session.shareCode,
  owner: session.ownerId && {
    id: session.ownerId._id || session.ownerId,
    displayName: session.ownerId.displayName,
    avatar: session.ownerId.avatar,
  },
  expiresAt: session.expiresAt,
  isActive: session.isAvailable(),
  createdAt: session.createdAt,
});

router.post('/create', requireAuth, async (req, res, next) => {
  try {
    const duration = ['1h', '8h', 'forever'].includes(req.body.duration) ? req.body.duration : '1h';
    const hours = duration === '1h' ? 1 : duration === '8h' ? 8 : null;
    const session = await ShareSession.create({
      shareCode: crypto.randomBytes(5).toString('base64url'),
      ownerId: req.authUser._id,
      expiresAt: hours ? new Date(Date.now() + hours * 60 * 60 * 1000) : null,
      allowedViewers: Array.isArray(req.body.allowedViewers) ? req.body.allowedViewers : [],
    });
    await session.populate('ownerId', 'displayName avatar');
    res.status(201).json({ success: true, session: serialize(session) });
  } catch (error) {
    next(error);
  }
});

router.get('/my-sessions', requireAuth, async (req, res, next) => {
  try {
    await ShareSession.updateMany(
      { ownerId: req.authUser._id, isActive: true, expiresAt: { $lte: new Date() } },
      { $set: { isActive: false } }
    );
    const sessions = await ShareSession.find({ ownerId: req.authUser._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('ownerId', 'displayName avatar');
    res.json({ success: true, sessions: sessions.map(serialize) });
  } catch (error) {
    next(error);
  }
});

router.get('/:code', async (req, res, next) => {
  try {
    const session = await ShareSession.findOne({ shareCode: req.params.code })
      .populate('ownerId', 'displayName avatar');
    if (!session || !session.isAvailable()) {
      return res.status(404).json({ success: false, message: 'This share link is inactive or expired' });
    }
    const latest = await LocationHistory.findOne({ userId: session.ownerId._id })
      .sort({ timestamp: -1 })
      .select('latitude longitude accuracy timestamp')
      .lean();
    res.json({ success: true, session: serialize(session), latestLocation: latest });
  } catch (error) {
    next(error);
  }
});

router.post('/:code/stop', requireAuth, async (req, res, next) => {
  try {
    const session = await ShareSession.findOneAndUpdate(
      { shareCode: req.params.code, ownerId: req.authUser._id },
      { $set: { isActive: false } },
      { new: true }
    );
    if (!session) return res.status(404).json({ success: false, message: 'Share session not found' });
    req.app.get('io')?.to(`share:${session.shareCode}`).emit('share-session-ended');
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
