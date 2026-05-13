/**
 * auth.js — Authentication UI logic
 */
const AuthManager = (() => {
  /**
   * Check if user is currently authenticated
   */
  const checkAuth = async () => {
    try {
      const res = await fetch('/auth/me', { credentials: 'include' });
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
    window.location.href = '/auth/google';
  };

  /**
   * Logout and redirect
   */
  const logout = async () => {
    try {
      window.location.href = '/auth/logout';
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
