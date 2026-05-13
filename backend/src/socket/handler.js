const { v4: uuidv4 } = require('uuid');
const { producer, TOPIC } = require('../config/kafka');

// Track active users: userId -> { socketId, displayName, avatar, lastUpdate }
const activeUsers = new Map();

// Rate limiting: userId -> lastEmitTimestamp
const rateLimitMap = new Map();
const RATE_LIMIT_MS = 3000; // Min 3 seconds between location updates

/**
 * Validate location data from the client.
 * Prevents invalid/spoofed coordinates from entering the pipeline.
 */
const validateLocationData = (data) => {
  if (!data || typeof data !== 'object') return false;
  const { latitude, longitude } = data;

  if (typeof latitude !== 'number' || typeof longitude !== 'number') return false;
  if (isNaN(latitude) || isNaN(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;

  return true;
};

/**
 * Initialize Socket.IO event handlers.
 * Auth is enforced: only users with valid sessions can connect.
 */
const initSocketHandler = (io) => {
  // Auth middleware — reject unauthenticated socket connections
  io.use((socket, next) => {
    const user = socket.request.session?.passport?.user;
    if (user) {
      next();
    } else {
      next(new Error('Authentication required'));
    }
  });

  io.on('connection', async (socket) => {
    const session = socket.request.session;
    const userId = session?.passport?.user;

    if (!userId) {
      socket.disconnect(true);
      return;
    }

    // Lazy-load user data from session (passport deserializeUser already ran)
    const User = require('../models/User');
    const user = await User.findById(userId).lean();

    if (!user) {
      console.warn(`⚠️  Socket connected but user not found: ${userId}`);
      socket.disconnect(true);
      return;
    }

    const userInfo = {
      userId: user._id.toString(),
      displayName: user.displayName,
      avatar: user.avatar,
      socketId: socket.id,
      lastUpdate: Date.now(),
      lastLocationAt: null,
    };

    // Track this user as active
    activeUsers.set(userInfo.userId, userInfo);

    console.log(`🟢 User connected: ${user.displayName} (${socket.id})`);

    // Send current active users to the newly connected client
    socket.emit('active-users', Array.from(activeUsers.values()).map((u) => ({
      userId: u.userId,
      displayName: u.displayName,
      avatar: u.avatar,
    })));

    // Notify others about new user
    socket.broadcast.emit('user-connected', {
      userId: userInfo.userId,
      displayName: userInfo.displayName,
      avatar: userInfo.avatar,
    });

    // Handle location updates
    socket.on('send-location', async (data) => {
      try {
        // Validate location data
        if (!validateLocationData(data)) {
          socket.emit('error-message', { message: 'Invalid location data' });
          return;
        }

        // Rate limiting
        const lastEmit = rateLimitMap.get(userInfo.userId);
        const now = Date.now();
        if (lastEmit && now - lastEmit < RATE_LIMIT_MS) {
          return; // Silently drop — too frequent
        }
        rateLimitMap.set(userInfo.userId, now);

        // Update active user's last update time
        userInfo.lastUpdate = now;
        userInfo.lastLocationAt = now;
        activeUsers.set(userInfo.userId, userInfo);

        // Construct Kafka event
        const locationEvent = {
          eventId: uuidv4(),
          userId: userInfo.userId,
          displayName: userInfo.displayName,
          avatar: userInfo.avatar,
          latitude: data.latitude,
          longitude: data.longitude,
          accuracy: data.accuracy || null,
          timestamp: now,
        };

        // Publish to Kafka — this is where Kafka enters the actual flow
        // The event will be consumed by:
        //   1. Broadcast consumer → pushes to all Socket.IO clients
        //   2. DB consumer → persists to MongoDB
        await producer.send({
          topic: TOPIC,
          messages: [
            {
              key: userInfo.userId, // Partition by userId for ordering
              value: JSON.stringify(locationEvent),
            },
          ],
        });
      } catch (error) {
        console.error(`❌ Error processing location from ${userInfo.displayName}:`, error.message);
        socket.emit('error-message', { message: 'Failed to process location' });
      }
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      console.log(`🔴 User disconnected: ${user.displayName} (${reason})`);
      activeUsers.delete(userInfo.userId);
      rateLimitMap.delete(userInfo.userId);

      // Broadcast to all remaining clients
      io.emit('user-disconnected', {
        userId: userInfo.userId,
      });
    });
  });

  // Periodic cleanup of stale users (no update in 30 seconds)
  setInterval(() => {
    const now = Date.now();
    const STALE_THRESHOLD = 30000; // 30 seconds

    for (const [userId, info] of activeUsers.entries()) {
      if (info.lastLocationAt && now - info.lastLocationAt > STALE_THRESHOLD) {
        console.log(`🧹 Removing stale user: ${info.displayName}`);
        activeUsers.delete(userId);
        rateLimitMap.delete(userId);
        io.emit('user-disconnected', { userId });

        // Find and disconnect the stale socket
        const staleSockets = io.sockets.sockets;
        for (const [, s] of staleSockets) {
          if (s.request?.session?.passport?.user?.toString() === userId) {
            s.disconnect(true);
          }
        }
      }
    }
  }, 10000); // Check every 10 seconds

  console.log('🔌 Socket.IO handler initialized');
};

module.exports = { initSocketHandler, activeUsers };
