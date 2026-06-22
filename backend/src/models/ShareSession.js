const mongoose = require('mongoose');

const shareSessionSchema = new mongoose.Schema(
  {
    shareCode: { type: String, required: true, unique: true, index: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    expiresAt: { type: Date, default: null, index: true },
    isActive: { type: Boolean, default: true, index: true },
    allowedViewers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

shareSessionSchema.methods.isAvailable = function isAvailable() {
  return this.isActive && (!this.expiresAt || this.expiresAt > new Date());
};

module.exports = mongoose.model('ShareSession', shareSessionSchema);
