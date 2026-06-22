const express = require('express');
const mongoose = require('mongoose');
const Friend = require('../models/Friend');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/request', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, message: 'Enter a valid email address' });
    }
    const friend = await User.findOne({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    if (!friend) return res.status(404).json({ success: false, message: 'No user found with that email' });
    if (friend._id.equals(req.authUser._id)) {
      return res.status(400).json({ success: false, message: 'You cannot add yourself' });
    }
    const relationship = await Friend.findOneAndUpdate(
      { userId: req.authUser._id, friendId: friend._id },
      { $setOnInsert: { status: 'pending' } },
      { upsert: true, new: true }
    );
    res.status(201).json({ success: true, request: relationship });
  } catch (error) {
    next(error);
  }
});

router.post('/accept/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid request id' });
    }
    const incoming = await Friend.findOneAndUpdate(
      { _id: req.params.id, friendId: req.authUser._id, status: 'pending' },
      { $set: { status: 'accepted' } },
      { new: true }
    );
    if (!incoming) return res.status(404).json({ success: false, message: 'Friend request not found' });
    await Friend.findOneAndUpdate(
      { userId: req.authUser._id, friendId: incoming.userId },
      { $set: { status: 'accepted' } },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const [friends, incoming, outgoing] = await Promise.all([
      Friend.find({ userId: req.authUser._id, status: 'accepted' }).populate('friendId', 'displayName email avatar'),
      Friend.find({ friendId: req.authUser._id, status: 'pending' }).populate('userId', 'displayName email avatar'),
      Friend.find({ userId: req.authUser._id, status: 'pending' }).populate('friendId', 'displayName email avatar'),
    ]);
    res.json({
      success: true,
      friends: friends.map((r) => ({ relationshipId: r._id, user: r.friendId })),
      incoming: incoming.map((r) => ({ relationshipId: r._id, user: r.userId })),
      outgoing: outgoing.map((r) => ({ relationshipId: r._id, user: r.friendId })),
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await Friend.deleteMany({
      $or: [
        { userId: req.authUser._id, friendId: req.params.id },
        { userId: req.params.id, friendId: req.authUser._id },
      ],
    });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
