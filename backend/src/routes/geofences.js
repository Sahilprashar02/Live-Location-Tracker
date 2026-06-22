const express = require('express');
const Geofence = require('../models/Geofence');
const Friend = require('../models/Friend');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const geofences = await Geofence.find({ userId: req.authUser._id })
      .populate('targetUserId', 'displayName avatar')
      .sort({ createdAt: -1 });
    res.json({ success: true, geofences });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const isFriend = await Friend.exists({
      userId: req.authUser._id,
      friendId: req.body.targetUserId,
      status: 'accepted',
    });
    if (!isFriend) {
      return res.status(403).json({ success: false, message: 'Alerts can only target accepted friends' });
    }
    const geofence = await Geofence.create({
      userId: req.authUser._id,
      targetUserId: req.body.targetUserId,
      center: req.body.center,
      radius: req.body.radius,
      name: req.body.name,
      triggerOn: req.body.triggerOn,
    });
    res.status(201).json({ success: true, geofence });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const allowed = ['name', 'radius', 'triggerOn', 'isActive'];
    const update = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
    const geofence = await Geofence.findOneAndUpdate(
      { _id: req.params.id, userId: req.authUser._id },
      { $set: update },
      { new: true, runValidators: true }
    );
    if (!geofence) return res.status(404).json({ success: false, message: 'Geofence not found' });
    res.json({ success: true, geofence });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await Geofence.deleteOne({ _id: req.params.id, userId: req.authUser._id });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
