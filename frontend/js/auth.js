/**
 * auth.js — Authentication UI logic
 */
export const AuthManager = (() => {
  // Use Render backend URL in production, localhost in development
  const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : 'https://live-location-tracker-unpn.onrender.com';

  /**
   * Check if user is currently authenticated
   */
  const checkAuth = async () => {
    // 1. Handle token from URL (if just redirected back from login)
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');
    if (tokenFromUrl) {
      localStorage.setItem('auth_token', tokenFromUrl);
      // Clean up the URL (remove token from address bar)
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // 2. Prepare request with token if available
    const token = localStorage.getItem('auth_token');
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const res = await fetch(`${API_BASE}/auth/me`, { 
        credentials: 'include',
        headers
      });
      if (res.ok) {
        const data = await res.json();
        return data.success ? data.user : null;
      }
      return null;
    } catch (err) {
      console.error('Auth check failed:', err);
      return null;
    }
  };

  /**
   * Redirect to Google OAuth login
   */
  const login = () => {
    window.location.href = `${API_BASE}/auth/google`;
  };

  /**
   * Logout and redirect
   */
  const logout = async () => {
    try {
      localStorage.removeItem('auth_token');
      window.location.href = `${API_BASE}/auth/logout`;
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  /**
   * Update the UI with user info
   */
  const updateUserUI = (user) => {
    const avatarEl = document.getElementById('user-avatar');
    const nameEl = document.getElementById('user-name');

    if (avatarEl && user.avatar) {
      avatarEl.src = user.avatar;
      avatarEl.onerror = () => {
        avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName)}&background=1a1a2e&color=00d2ff&size=40`;
      };
    }
    if (nameEl) {
      nameEl.textContent = user.displayName;
    }
  };

  return { checkAuth, login, logout, updateUserUI };
})();
