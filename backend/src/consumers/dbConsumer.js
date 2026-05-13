const { createConsumer, TOPIC } = require('../config/kafka');
const LocationHistory = require('../models/LocationHistory');
const User = require('../models/User');

// Batch buffer for efficient DB writes
let writeBuffer = [];
const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 5000;
let flushTimer = null;
let dbConsumer = null;

/**
 * Flush the buffer to MongoDB using insertMany for efficiency.
 * This is why Kafka helps — instead of writing to DB on every socket event,
 * we batch writes for much better throughput.
 */
const flushBuffer = async () => {
  if (writeBuffer.length === 0) return;

  const batch = [...writeBuffer];
  writeBuffer = [];

  try {
    // Batch insert location history
    await LocationHistory.insertMany(batch, { ordered: false });

    // Update lastSeen for all unique users in the batch
    const userIds = [...new Set(batch.map((e) => e.userId))];
    await User.updateMany(
      { _id: { $in: userIds } },
      { $set: { lastSeen: new Date() } }
    );

    console.log(`💾 Flushed ${batch.length} location events to DB`);
  } catch (error) {
    if (error.code === 11000) {
      // Duplicate key error (duplicate eventIds) — expected, safe to ignore
      const inserted = error.insertedDocs?.length || batch.length - (error.writeErrors?.length || 0);
      console.log(`💾 Flushed ${inserted} events (${error.writeErrors?.length || 0} duplicates skipped)`);
    } else {
      console.error('❌ DB flush error:', error.message);
      // Put failed items back in the buffer for retry
      writeBuffer.unshift(...batch);
    }
  }
};

/**
 * Database Consumer
 * Consumer Group: db-processor-group
 *
 * Reads location events from Kafka and persists them to MongoDB.
 * Uses batch writes for efficiency — this is the key reason Kafka is
 * in the architecture. Instead of writing to DB on every socket event
 * (which would be O(n) DB operations per second where n = active users),
 * we buffer events and batch-write them periodically.
 */
const startDBConsumer = async () => {
  const consumer = createConsumer('db-processor-group');
  dbConsumer = consumer;

  try {
    await consumer.connect();
    console.log('✅ DB consumer connected');

    await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

    // Start periodic flush timer
    flushTimer = setInterval(flushBuffer, FLUSH_INTERVAL_MS);

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const event = JSON.parse(message.value.toString());

          // Add to write buffer
          writeBuffer.push({
            userId: event.userId,
            displayName: event.displayName,
            latitude: event.latitude,
            longitude: event.longitude,
            accuracy: event.accuracy,
            eventId: event.eventId,
            timestamp: new Date(event.timestamp),
            processedAt: new Date(),
          });

          // Flush if buffer is full
          if (writeBuffer.length >= BATCH_SIZE) {
            await flushBuffer();
          }
        } catch (error) {
          console.error('❌ DB consumer message error:', error.message);
        }
      },
    });

    console.log('💾 DB consumer is running');
  } catch (error) {
    console.error('❌ DB consumer failed to start:', error.message);
    throw error;
  }

  return consumer;
};

/**
 * Cleanup: flush remaining buffer and clear timer
 */
const stopDBConsumer = async () => {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushBuffer();

  if (dbConsumer) {
    await dbConsumer.disconnect();
    dbConsumer = null;
    console.log('✅ DB consumer disconnected');
  }
};

module.exports = { startDBConsumer, stopDBConsumer };
