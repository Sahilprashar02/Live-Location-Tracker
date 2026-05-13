/**
 * socket.js — Socket.IO client connection and event handling
 */
export const SocketManager = (() => {
  let socket = null;
  let isConnected = false;

  // Callbacks set by app.js
  let onLocationUpdate = null;
  let onUserDisconnected = null;
  let onUserConnected = null;
  let onActiveUsers = null;
  let onConnectionChange = null;
  let onError = null;

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

    const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:3000'
      : 'https://live-location-tracker-unpn.onrender.com';

    const token = localStorage.getItem('auth_token');

    socket = io(API_BASE, {
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
      console.log('🟢 Socket connected:', socket.id);
    });

    socket.on('disconnect', (reason) => {
      isConnected = false;
      onConnectionChange(false);
      console.log('🔴 Socket disconnected:', reason);
    });

    socket.on('connect_error', (err) => {
      isConnected = false;
      onConnectionChange(false);
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

  return { connect, sendLocation, disconnect, getStatus };
})();
