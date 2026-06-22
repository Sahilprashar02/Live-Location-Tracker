const { v4: uuidv4 } = require('uuid');
const { producer, TOPIC } = require('../config/kafka');
const ShareSession = require('../models/ShareSession');
const Geofence = require('../models/Geofence');

// Track active users: socketId -> { userId, displayName, avatar, lastUpdate, lastLocationAt }
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

  io.on('connection', async (socket) => {
    if (socket.data.shareGuest) {
      const { shareCode } = socket.data.shareGuest;
      socket.join(`share:${shareCode}`);
      socket.emit('share-session-joined', { shareCode });
      return;
    }

    // Derive userId from JWT user (set in server.js) or session user
    const userId = socket.request.user?._id?.toString() || 
                   socket.request.session?.passport?.user?.toString();

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
    socket.join('authenticated');
    socket.join(`user:${userInfo.userId}`);

    // Check if this is the first socket for this user (to avoid redundant broadcasts)
    const isFirstSocket = !Array.from(activeUsers.values()).some(u => u.userId === userInfo.userId);

    // Track this socket as active
    activeUsers.set(socket.id, userInfo);

    console.log(`🟢 User connected: ${user.displayName} (Socket: ${socket.id}, First: ${isFirstSocket})`);

    // Send current active users to the newly connected client (deduplicated by userId)
    const uniqueUsers = Array.from(new Map(
      Array.from(activeUsers.values()).map(u => [u.userId, u])
    ).values());

    socket.emit('active-users', uniqueUsers.map((u) => ({
      userId: u.userId,
      displayName: u.displayName,
      avatar: u.avatar,
    })));

    // Notify others only if this is the user's first connection
    if (isFirstSocket) {
      socket.to('authenticated').emit('user-connected', {
        userId: userInfo.userId,
        displayName: userInfo.displayName,
        avatar: userInfo.avatar,
      });
    }

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
        activeUsers.set(socket.id, userInfo);

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

        const watchedGeofences = await Geofence.find({
          targetUserId: userInfo.userId,
          isActive: true,
        });
        for (const fence of watchedGeofences) {
          const distance = haversineMeters(
            data.latitude,
            data.longitude,
            fence.center.lat,
            fence.center.lng
          );
          const nextState = distance <= fence.radius ? 'inside' : 'outside';
          const changed = fence.lastState !== 'unknown' && fence.lastState !== nextState;
          const triggerMatches = fence.triggerOn === 'both'
            || (fence.triggerOn === 'enter' && nextState === 'inside')
            || (fence.triggerOn === 'exit' && nextState === 'outside');

          if (changed && triggerMatches) {
            io.to(`user:${fence.userId}`).emit('geofence-alert', {
              geofenceId: fence._id,
              name: fence.name,
              targetUserId: userInfo.userId,
              targetName: userInfo.displayName,
              event: nextState === 'inside' ? 'entered' : 'exited',
              latitude: data.latitude,
              longitude: data.longitude,
              timestamp: now,
            });
          }

          if (fence.lastState !== nextState) {
            fence.lastState = nextState;
            await fence.save();
          }
        }

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

    socket.on('join-share-session', async ({ shareCode } = {}) => {
      const session = await ShareSession.findOne({ shareCode, isActive: true }).lean();
      if (!session || (session.expiresAt && session.expiresAt <= new Date())) {
        return socket.emit('error-message', { message: 'Share session is inactive or expired' });
      }
      socket.join(`share:${shareCode}`);
    });

    socket.on('leave-share-session', ({ shareCode } = {}) => {
      if (shareCode) socket.leave(`share:${shareCode}`);
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      console.log(`🔴 Socket disconnected: ${user.displayName} (${socket.id}) - ${reason}`);
      
      // Remove only this specific socket
      activeUsers.delete(socket.id);
      
      // Check if the user has any other active sockets
      const hasOtherSockets = Array.from(activeUsers.values()).some(u => u.userId === userInfo.userId);
      
      if (!hasOtherSockets) {
        rateLimitMap.delete(userInfo.userId);
        // Only broadcast disconnected if NO sockets remain for this user
        io.to('authenticated').emit('user-disconnected', {
          userId: userInfo.userId,
          displayName: userInfo.displayName
        });
      }
    });
  });

  // Periodic cleanup of stale sockets (no update in 30 seconds)
  setInterval(() => {
    const now = Date.now();
    const STALE_THRESHOLD = 30000; // 30 seconds

    for (const [socketId, info] of activeUsers.entries()) {
      if (info.lastLocationAt && now - info.lastLocationAt > STALE_THRESHOLD) {
        console.log(`🧹 Removing stale socket for user: ${info.displayName} (${socketId})`);
        
        activeUsers.delete(socketId);
        
        // Disconnect the specific stale socket
        const staleSocket = io.sockets.sockets.get(socketId);
        if (staleSocket) {
          staleSocket.disconnect(true);
        }

        // Check if user still has other active sockets
        const hasOtherSockets = Array.from(activeUsers.values()).some(u => u.userId === info.userId);
        if (!hasOtherSockets) {
          rateLimitMap.delete(info.userId);
          io.to('authenticated').emit('user-disconnected', { userId: info.userId });
        }
      }
    }
  }, 10000); // Check every 10 seconds

  console.log('🔌 Socket.IO handler initialized');
};

const haversineMeters = (lat1, lng1, lat2, lng2) => {
  const toRad = (degrees) => degrees * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

module.exports = { initSocketHandler, activeUsers };
