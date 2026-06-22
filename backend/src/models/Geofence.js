const mongoose = require('mongoose');

const geofenceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    center: {
      lat: { type: Number, required: true, min: -90, max: 90 },
      lng: { type: Number, required: true, min: -180, max: 180 },
    },
    radius: { type: Number, required: true, min: 25, max: 100000 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    triggerOn: { type: String, enum: ['enter', 'exit', 'both'], default: 'both' },
    isActive: { type: Boolean, default: true },
    lastState: { type: String, enum: ['inside', 'outside', 'unknown'], default: 'unknown' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Geofence', geofenceSchema);
