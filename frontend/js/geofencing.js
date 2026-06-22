import { AuthManager } from './auth.js';

export const GeofencingManager = (() => {
  let map;
  let toast = () => {};
  let friends = [];
  const layers = new Map();

  const request = (path, options = {}) => fetch(`${AuthManager.getApiBase()}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...AuthManager.getAuthHeaders() },
  });

  const init = (mapInstance, { showToast }) => {
    map = mapInstance;
    toast = showToast;
    window.addEventListener('friends-updated', (event) => {
      friends = event.detail || [];
      renderFriendOptions();
    });
    document.getElementById('btn-create-geofence')?.addEventListener('click', create);
    document.getElementById('btn-enable-notifications')?.addEventListener('click', async () => {
      if (!('Notification' in window)) return toast('Notifications are not supported here', 'error');
      const permission = await Notification.requestPermission();
      toast(permission === 'granted' ? 'Notifications enabled' : 'Notifications were not enabled',
        permission === 'granted' ? 'success' : 'info');
    });
    load();
  };

  const renderFriendOptions = () => {
    const select = document.getElementById('geofence-target');
    if (!select) return;
    select.innerHTML = friends.map(({ user }) =>
      `<option value="${user._id}">${escapeHtml(user.displayName)}</option>`
    ).join('');
  };

  const create = async () => {
    const targetUserId = document.getElementById('geofence-target')?.value;
    if (!targetUserId) return toast('Add a friend before creating an alert', 'error');
    const center = map.getCenter();
    const body = {
      targetUserId,
      center: { lat: center.lat, lng: center.lng },
      radius: Number(document.getElementById('geofence-radius')?.value || 250),
      name: document.getElementById('geofence-name')?.value.trim() || 'Map alert',
      triggerOn: document.getElementById('geofence-trigger')?.value || 'both',
    };
    const response = await request('/api/geofences', { method: 'POST', body: JSON.stringify(body) });
    const data = await response.json();
    toast(response.ok ? 'Geofence created at map center' : data.message, response.ok ? 'success' : 'error');
    if (response.ok) load();
  };

  const load = async () => {
    const response = await request('/api/geofences');
    if (!response.ok) return;
    const { geofences } = await response.json();
    layers.forEach((layer) => map.removeLayer(layer));
    layers.clear();
    geofences.forEach((fence) => {
      const layer = L.circle([fence.center.lat, fence.center.lng], {
        radius: fence.radius,
        color: '#7a2bff',
        fillColor: '#7a2bff',
        fillOpacity: 0.12,
        weight: 2,
      }).addTo(map).bindTooltip(fence.name);
      layers.set(fence._id, layer);
    });
    const list = document.getElementById('geofence-list');
    if (!list) return;
    list.innerHTML = geofences.map((fence) => `
      <div class="compact-card">
        <div><strong>${escapeHtml(fence.name)}</strong><small>${fence.radius} m · ${escapeHtml(fence.targetUserId?.displayName || 'Friend')}</small></div>
        <button class="btn-danger-quiet" data-delete-geofence="${fence._id}">Delete</button>
      </div>
    `).join('') || '<p class="panel-empty">No arrival alerts yet.</p>';
    list.querySelectorAll('[data-delete-geofence]').forEach((button) => {
      button.onclick = async () => {
        await request(`/api/geofences/${button.dataset.deleteGeofence}`, { method: 'DELETE' });
        load();
      };
    });
  };

  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[char]));
  return { init, load };
})();
