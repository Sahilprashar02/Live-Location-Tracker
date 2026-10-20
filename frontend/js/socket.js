/**
 * socket.js — Socket.IO client connection and event handling
 */
export const SocketManager = (() => {
  let socket = null;
  let isConnected = false;

  // Socket.IO cannot be proxied by Vercel rewrites, so it connects directly
  // to the backend origin. HTTP calls use the frontend origin instead (see
  // auth.js + frontend/vercel.json).
  const getSocketUrl = () => {
    const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
    const isLocalDev = window.location.hostname === 'localhost' && window.location.port !== '3000';
    return env.VITE_SOCKET_URL || env.VITE_API_BASE || (isLocalDev ? 'http://localhost:3000' : window.location.origin);
  };

  // Callbacks set by app.js
  let onLocationUpdate = null;
  let onUserDisconnected = null;
  let onUserConnected = null;
  let onActiveUsers = null;
  let onConnectionChange = null;
  let onError = null;
  let onGeofenceAlert = null;

  /**
   * Connect to the Socket.IO server
   */
  const connect = (callbacks = {}) => {
    onLocationUpdate = callbacks.onLocationUpdate || (() => {});
    onUserDisconnected = callbacks.onUserDisconnected || (() => {});
    onUserConnected = callbacks.onUserConnected || (() => {});
    onActiveUsers = callbacks.onActiveUsers || (() => {});
    onConnectionChange = callbacks.onConnectionChange || (() => {});
    onError = callbacks.onError || (() => {});
    onGeofenceAlert = callbacks.onGeofenceAlert || (() => {});

    const token = localStorage.getItem('auth_token');

    socket = io(getSocketUrl(), {
      auth: { token },
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    // Connection events
    socket.on('connect', () => {
      isConnected = true;
      onConnectionChange(true);
    });

    socket.on('disconnect', (reason) => {
      isConnected = false;
      onConnectionChange(false);
    });

    socket.on('connect_error', (err) => {
      isConnected = false;
      onConnectionChange(false, 'failed');
      console.error('❌ Socket connection error:', err.message);
      onError('Connection failed. Please try logging in again.');
    });

    // App events
    socket.on('location-update', (data) => {
      onLocationUpdate(data);
    });

    socket.on('user-disconnected', (data) => {
      onUserDisconnected(data);
    });

    socket.on('user-connected', (data) => {
      onUserConnected(data);
    });

    socket.on('active-users', (users) => {
      onActiveUsers(users);
    });

    socket.on('error-message', (data) => {
      onError(data.message);
    });

    socket.on('geofence-alert', (data) => {
      onGeofenceAlert(data);
    });

    return socket;
  };

  /**
   * Send location update to server → Kafka → consumers
   */
  const sendLocation = (latitude, longitude, accuracy) => {
    if (!socket || !isConnected) return false;

    socket.emit('send-location', {
      latitude,
      longitude,
      accuracy,
    });

    return true;
  };

  /**
   * Disconnect the socket
   */
  const disconnect = () => {
    if (socket) {
      socket.disconnect();
      socket = null;
      isConnected = false;
    }
  };

  const getStatus = () => isConnected;

  const connectShare = (shareCode, callbacks = {}) => {
    socket = io(getSocketUrl(), {
      auth: { shareCode },
      transports: ['websocket', 'polling'],
    });
    socket.on('share-location-update', (data) => callbacks.onLocationUpdate?.(data));
    socket.on('share-session-ended', () => callbacks.onEnded?.());
    socket.on('connect_error', (error) => callbacks.onError?.(error.message));
    return socket;
  };

  const getSocket = () => socket;

  return { connect, connectShare, sendLocation, disconnect, getStatus, getSocket };
})();
