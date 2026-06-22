import { AuthManager } from './auth.js';
import { SocketManager } from './socket.js';
import { MapManager } from './map.js';

export const SharingManager = (() => {
  const api = (path, options = {}) => fetch(`${AuthManager.getApiBase()}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...AuthManager.getAuthHeaders(),
      ...(options.headers || {}),
    },
  });

  let toast = () => {};

  const init = ({ showToast }) => {
    toast = showToast;
    document.getElementById('btn-share-location')?.addEventListener('click', openPanel);
    document.getElementById('btn-close-community')?.addEventListener('click', closePanel);
    document.getElementById('btn-create-share')?.addEventListener('click', createShare);
    document.getElementById('btn-add-friend')?.addEventListener('click', addFriend);
    document.querySelectorAll('[data-community-tab]').forEach((button) => {
      button.addEventListener('click', () => switchTab(button.dataset.communityTab));
    });
    refreshAll();
  };

  const openPanel = () => {
    document.getElementById('community-panel')?.classList.add('open');
    document.getElementById('directions-panel')?.classList.remove('open');
    document.getElementById('users-sidebar')?.classList.add('collapsed');
    refreshAll();
  };

  const closePanel = () => document.getElementById('community-panel')?.classList.remove('open');

  const switchTab = (tab) => {
    document.querySelectorAll('[data-community-tab]').forEach((button) => {
      button.classList.toggle('active', button.dataset.communityTab === tab);
    });
    document.querySelectorAll('.community-view').forEach((view) => {
      view.classList.toggle('active', view.id === `community-${tab}`);
    });
  };

  const createShare = async () => {
    const duration = document.getElementById('share-duration')?.value || '1h';
    const response = await api('/api/share/create', {
      method: 'POST',
      body: JSON.stringify({ duration }),
    });
    const data = await response.json();
    if (!response.ok) return toast(data.message || 'Could not create share link', 'error');
    showShareLink(data.session);
    loadSessions();
  };

  const showShareLink = (session) => {
    const link = `${window.location.origin}/track/${session.shareCode}`;
    const output = document.getElementById('share-link-output');
    if (!output) return;
    output.hidden = false;
    output.querySelector('input').value = link;
    output.querySelector('[data-copy-share]').onclick = async () => {
      await navigator.clipboard.writeText(link);
      toast('Share link copied', 'success');
    };
    const qr = document.getElementById('share-qr');
    qr.innerHTML = '';
    if (window.QRCode) {
      new window.QRCode(qr, { text: link, width: 112, height: 112, colorDark: '#101024', colorLight: '#ffffff' });
    }
  };

  const loadSessions = async () => {
    const response = await api('/api/share/my-sessions');
    if (!response.ok) return;
    const { sessions } = await response.json();
    const list = document.getElementById('share-sessions-list');
    if (!list) return;
    list.innerHTML = sessions.length ? sessions.map((session) => `
      <div class="compact-card">
        <div><strong>${session.isActive ? 'Live link' : 'Ended'}</strong><small>${formatExpiry(session)}</small></div>
        ${session.isActive ? `<button data-stop-share="${session.shareCode}" class="btn-danger-quiet">Stop</button>` : ''}
      </div>
    `).join('') : '<p class="panel-empty">No share links yet.</p>';
    list.querySelectorAll('[data-stop-share]').forEach((button) => {
      button.onclick = async () => {
        await api(`/api/share/${button.dataset.stopShare}/stop`, { method: 'POST' });
        loadSessions();
      };
    });
  };

  const addFriend = async () => {
    const input = document.getElementById('friend-email');
    const email = input?.value.trim();
    if (!email) return;
    const response = await api('/api/friends/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    const data = await response.json();
    toast(response.ok ? 'Friend request sent' : data.message, response.ok ? 'success' : 'error');
    if (response.ok) input.value = '';
    loadFriends();
  };

  const loadFriends = async () => {
    const response = await api('/api/friends');
    if (!response.ok) return;
    const data = await response.json();
    const list = document.getElementById('friends-list');
    if (!list) return;
    const rows = [
      ...data.incoming.map((item) => friendRow(item, 'incoming')),
      ...data.friends.map((item) => friendRow(item, 'friend')),
      ...data.outgoing.map((item) => friendRow(item, 'outgoing')),
    ];
    list.innerHTML = rows.join('') || '<p class="panel-empty">Add a friend by email.</p>';
    list.querySelectorAll('[data-accept-friend]').forEach((button) => {
      button.onclick = async () => {
        await api(`/api/friends/accept/${button.dataset.acceptFriend}`, { method: 'POST' });
        loadFriends();
      };
    });
    list.querySelectorAll('[data-remove-friend]').forEach((button) => {
      button.onclick = async () => {
        await api(`/api/friends/${button.dataset.removeFriend}`, { method: 'DELETE' });
        loadFriends();
      };
    });
    window.dispatchEvent(new CustomEvent('friends-updated', { detail: data.friends }));
  };

  const friendRow = (item, type) => {
    const user = item.user;
    const action = type === 'incoming'
      ? `<button class="btn-primary-small" data-accept-friend="${item.relationshipId}">Accept</button>`
      : type === 'friend'
        ? `<button class="btn-danger-quiet" data-remove-friend="${user._id}">Remove</button>`
        : '<small>Pending</small>';
    return `<div class="compact-card friend-card">
      <img src="${user.avatar || ''}" alt="">
      <div><strong>${escapeHtml(user.displayName)}</strong><small>${escapeHtml(user.email || '')}</small></div>
      ${action}
    </div>`;
  };

  const initViewer = async (shareCode, map) => {
    const response = await fetch(`${AuthManager.getApiBase()}/api/share/${encodeURIComponent(shareCode)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Share link unavailable');
    const banner = document.getElementById('tracking-banner');
    banner.hidden = false;
    banner.querySelector('[data-tracking-name]').textContent = data.session.owner.displayName;
    if (data.latestLocation) {
      MapManager.addOrUpdateMarker({
        ...data.latestLocation,
        userId: data.session.owner.id,
        displayName: data.session.owner.displayName,
        avatar: data.session.owner.avatar,
      });
      map.setView([data.latestLocation.latitude, data.latestLocation.longitude], 16);
    }
    SocketManager.connectShare(shareCode, {
      onLocationUpdate: (location) => {
        MapManager.addOrUpdateMarker(location);
        map.panTo([location.latitude, location.longitude], { animate: true });
      },
      onEnded: () => {
        banner.querySelector('[data-tracking-state]').textContent = 'Sharing ended';
      },
    });
  };

  const refreshAll = () => Promise.all([loadSessions(), loadFriends()]);
  const formatExpiry = (session) => !session.isActive ? 'No longer active'
    : session.expiresAt ? `Expires ${new Date(session.expiresAt).toLocaleString()}` : 'Until turned off';
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[char]));

  return { init, initViewer, openPanel, loadFriends };
})();
