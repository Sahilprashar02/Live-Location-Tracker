const { createConsumer, TOPIC } = require('../config/kafka');
const ShareSession = require('../models/ShareSession');
const Friend = require('../models/Friend');

// Simple LRU-like dedup cache (max 10,000 entries)
const processedEvents = new Map();
const MAX_CACHE_SIZE = 10000;
let broadcastConsumer = null;

const addToCache = (eventId) => {
  if (processedEvents.size >= MAX_CACHE_SIZE) {
    // Delete oldest entry
    const firstKey = processedEvents.keys().next().value;
    processedEvents.delete(firstKey);
  }
  processedEvents.set(eventId, Date.now());
};

/**
 * Broadcast Consumer
 * Consumer Group: broadcast-group
 *
 * Reads location events from Kafka and broadcasts them
 * to all connected Socket.IO clients in real-time.
 */
const startBroadcastConsumer = async (io) => {
  const consumer = createConsumer('broadcast-group');
  broadcastConsumer = consumer;

  try {
    await consumer.connect();
    console.log('✅ Broadcast consumer connected');

    await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const locationEvent = JSON.parse(message.value.toString());

          // Deduplication check
          if (processedEvents.has(locationEvent.eventId)) {
            return;
          }
          addToCache(locationEvent.eventId);

          const payload = {
            userId: locationEvent.userId,
            displayName: locationEvent.displayName,
            avatar: locationEvent.avatar,
            latitude: locationEvent.latitude,
            longitude: locationEvent.longitude,
            accuracy: locationEvent.accuracy,
            timestamp: locationEvent.timestamp,
          };

          // Send coordinates only to the owner and accepted friends.
          io.to(`user:${locationEvent.userId}`).emit('location-update', payload);
          const friendLinks = await Friend.find({
            friendId: locationEvent.userId,
            status: 'accepted',
          }).select('userId').lean();
          friendLinks.forEach(({ userId }) => {
            io.to(`user:${userId}`).emit('location-update', payload);
          });

          // Share-link viewers receive only the owner they explicitly opened.
          const activeShares = await ShareSession.find({
            ownerId: locationEvent.userId,
            isActive: true,
            $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
          }).select('shareCode').lean();
          activeShares.forEach(({ shareCode }) => {
            io.to(`share:${shareCode}`).emit('share-location-update', payload);
          });
        } catch (error) {
          console.error('❌ Broadcast consumer message error:', error.message);
        }
      },
    });

    console.log('🔊 Broadcast consumer is running');
  } catch (error) {
    console.error('❌ Broadcast consumer failed to start:', error.message);
    throw error;
  }

  return consumer;
};

const stopBroadcastConsumer = async () => {
  if (!broadcastConsumer) return;

  await broadcastConsumer.disconnect();
  broadcastConsumer = null;
  console.log('✅ Broadcast consumer disconnected');
};

module.exports = { startBroadcastConsumer, stopBroadcastConsumer };
