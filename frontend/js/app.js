/**
 * app.js — Main application entry point
 * Orchestrates auth, map, socket, and geolocation
 */
(() => {
  if (window.location.hostname === 'localhost' && window.location.port === '5500') {
    window.location.replace(`http://localhost:3000${window.location.pathname}${window.location.search}${window.location.hash}`);
    return;
  }

  // DOM elements
  const loginScreen = document.getElementById('login-screen');
  const mapScreen = document.getElementById('map-screen');
  const statusDot = document.getElementById('connection-status');
  const statusText = document.getElementById('status-text');
  const onlineCount = document.getElementById('online-count');
  const userCoords = document.getElementById('user-coords');
  const usersList = document.getElementById('users-list');
  const locationPrompt = document.getElementById('location-prompt');
  const btnAllowLocation = document.getElementById('btn-allow-location');
  const btnShareLocation = document.getElementById('btn-share-location');
  const btnLogout = document.getElementById('btn-logout');
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  const btnMobileSidebar = document.getElementById('btn-mobile-sidebar');
  const usersSidebar = document.getElementById('users-sidebar');
  const mobileBadge = document.getElementById('mobile-badge');
  const toastContainer = document.getElementById('toast-container');
  const btnGoogleLogin = document.getElementById('btn-google-login');

  // State
  let currentUser = null;
  const onlineUsers = new Map(); // userId -> { displayName, avatar }
  let watchId = null;
  let lastSentTime = 0;
  let latestLocation = null;
  const SEND_INTERVAL = 5000; // Send location every 5 seconds

  // ========== TOAST NOTIFICATIONS ==========
  const showToast = (message, type = 'info') => {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('out');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  };

  // ========== ONLINE USERS LIST ==========
  const updateUsersList = () => {
    const users = Array.from(onlineUsers.entries())
      .filter(([userId]) => userId)
      .sort(([aId, a], [bId, b]) => {
        if (aId === currentUser?.id) return -1;
        if (bId === currentUser?.id) return 1;
        return String(a.displayName || '').localeCompare(String(b.displayName || ''));
      });
    const othersCount = users.filter(([id]) => id !== currentUser?.id).length;

    onlineCount.textContent = `${users.length} online`;
    mobileBadge.textContent = othersCount;

    if (users.length === 0) {
      usersList.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">👥</span>
          <p>No users online</p>
        </div>
      `;
      return;
    }

    usersList.innerHTML = users
      .map(([userId, user]) => `
        <div class="user-list-item" data-userid="${userId}">
          <img class="user-list-avatar" src="${user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName)}&background=1a1a2e&color=00d2ff&size=32`}" alt="${user.displayName}" onerror="this.src='https://ui-avatars.com/api/?name=U&background=1a1a2e&color=00d2ff&size=32'">
          <span class="user-list-name">${userId === currentUser?.id ? `${user.displayName || 'You'} (You)` : user.displayName}</span>
          <span class="user-list-dot"></span>
        </div>
      `)
      .join('');
  };

  // ========== GEOLOCATION ==========
  const startLocationTracking = () => {
    if (!('geolocation' in navigator)) {
      showToast('Geolocation is not supported by your browser', 'error');
      return;
    }

    if (watchId) {
      requestLocation();
      return;
    }

    locationPrompt.style.display = 'block';
  };

  const setShareButtonActive = () => {
    if (!btnShareLocation) return;
    btnShareLocation.classList.add('active');
    btnShareLocation.title = 'Location sharing is active';
    const label = btnShareLocation.querySelector('span');
    if (label) label.textContent = 'Sharing';
  };

  const requestLocation = () => {
    locationPrompt.style.display = 'none';
    if (watchId) return;

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        latestLocation = { latitude, longitude, accuracy };
        setShareButtonActive();

        // Update own coordinates display
        userCoords.textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

        // Show your own marker immediately. The socket/Kafka round trip updates
        // every other connected browser, but your map should not wait on it.
        MapManager.addOrUpdateMarker({
          userId: currentUser.id,
          displayName: currentUser.displayName,
          avatar: currentUser.avatar,
          latitude,
          longitude,
          accuracy,
          timestamp: Date.now(),
        });

        // Throttle sending to server
        const now = Date.now();
        if (now - lastSentTime >= SEND_INTERVAL) {
          const sent = SocketManager.sendLocation(latitude, longitude, accuracy);
          if (sent) {
            lastSentTime = now;
          }
        }
      },
      (error) => {
        console.error('Geolocation error:', error);
        switch (error.code) {
          case error.PERMISSION_DENIED:
            showToast('Location permission denied. Please enable it in your browser settings.', 'error');
            locationPrompt.style.display = 'block';
            break;
          case error.POSITION_UNAVAILABLE:
            showToast('Location information is unavailable.', 'error');
            break;
          case error.TIMEOUT:
            showToast('Location request timed out.', 'error');
            break;
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 3000,
      }
    );
  };

  // ========== SOCKET CALLBACKS ==========
  const socketCallbacks = {
    onLocationUpdate: (data) => {
      // Update marker on map
      MapManager.addOrUpdateMarker(data);

      // Track user in online list
      onlineUsers.set(data.userId, {
        displayName: data.displayName,
        avatar: data.avatar,
      });
      updateUsersList();
    },

    onUserDisconnected: (data) => {
      MapManager.removeMarker(data.userId);
      onlineUsers.delete(data.userId);
      updateUsersList();
      const name = data.displayName || 'A user';
      showToast(`${name} went offline`, 'info');
    },

    onUserConnected: (data) => {
      onlineUsers.set(data.userId, {
        displayName: data.displayName,
        avatar: data.avatar,
      });
      updateUsersList();
      showToast(`${data.displayName} came online`, 'success');
    },

    onActiveUsers: (users) => {
      onlineUsers.clear();
      onlineUsers.set(currentUser.id, {
        displayName: currentUser.displayName,
        avatar: currentUser.avatar,
      });

      users.forEach((u) => {
        onlineUsers.set(u.userId, {
          displayName: u.displayName,
          avatar: u.avatar,
        });
      });
      updateUsersList();
    },

    onConnectionChange: (connected) => {
      if (connected) {
        statusDot.className = 'status-dot connected';
        statusText.textContent = 'Connected';

        if (latestLocation) {
          const sent = SocketManager.sendLocation(
            latestLocation.latitude,
            latestLocation.longitude,
            latestLocation.accuracy
          );
          if (sent) {
            lastSentTime = Date.now();
          }
        }
      } else {
        statusDot.className = 'status-dot disconnected';
        statusText.textContent = 'Reconnecting...';
      }
    },

    onError: (message) => {
      showToast(message, 'error');
    },
  };

  // ========== SIDEBAR TOGGLE ==========
  const setupSidebar = () => {
    btnToggleSidebar.addEventListener('click', () => {
      usersSidebar.classList.toggle('collapsed');
    });

    btnMobileSidebar.addEventListener('click', () => {
      usersSidebar.classList.toggle('mobile-open');
    });

    // Close mobile sidebar when clicking outside
    document.addEventListener('click', (e) => {
      if (
        window.innerWidth <= 768 &&
        usersSidebar.classList.contains('mobile-open') &&
        !usersSidebar.contains(e.target) &&
        e.target !== btnMobileSidebar &&
        !btnMobileSidebar.contains(e.target)
      ) {
        usersSidebar.classList.remove('mobile-open');
      }
    });
  };

  // ========== INIT ==========
  const init = async () => {
    // Check authentication
    currentUser = await AuthManager.checkAuth();

    if (!currentUser) {
      // Show login screen
      loginScreen.classList.add('active');
      mapScreen.classList.remove('active');

      // Add login listener
      if (btnGoogleLogin) {
        btnGoogleLogin.addEventListener('click', () => {
          AuthManager.login();
        });
      }
      return;
    }

    // Authenticated — show map
    loginScreen.classList.remove('active');
    mapScreen.classList.add('active');

    // Update user UI
    AuthManager.updateUserUI(currentUser);
    onlineUsers.set(currentUser.id, {
      displayName: currentUser.displayName,
      avatar: currentUser.avatar,
    });
    updateUsersList();

    // Initialize map
    MapManager.init(currentUser.id);

    // Connect socket
    SocketManager.connect(socketCallbacks);

    // Start location tracking
    startLocationTracking();

    // Setup sidebar
    setupSidebar();

    // Logout handler
    btnAllowLocation.addEventListener('click', requestLocation);
    btnShareLocation.addEventListener('click', requestLocation);

    btnLogout.addEventListener('click', () => {
      if (watchId) navigator.geolocation.clearWatch(watchId);
      SocketManager.disconnect();
      AuthManager.logout();
    });
  };

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
