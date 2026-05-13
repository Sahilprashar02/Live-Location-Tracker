/**
 * map.js — Leaflet map initialization and marker management
 */
const MapManager = (() => {
  let map = null;
  const markers = {};
  let currentUserId = null;

  // Dark map tiles — CartoDB Dark Matter
  const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const TILE_ATTR = '&copy; OpenStreetMap &copy; CARTO';
  const DEFAULT_CENTER = [20.5937, 78.9629]; // India center
  const DEFAULT_ZOOM = 5;

  /**
   * Create a custom Leaflet divIcon with user avatar
   */
  const createMarkerIcon = (avatar, isSelf) => {
    return L.divIcon({
      className: 'custom-marker',
      html: `
        <div class="marker-pulse"></div>
        <img
          class="marker-avatar ${isSelf ? 'self' : ''}"
          src="${avatar || 'https://ui-avatars.com/api/?name=U&background=1a1a2e&color=00d2ff&size=36'}"
          alt="user"
          onerror="this.src='https://ui-avatars.com/api/?name=U&background=1a1a2e&color=00d2ff&size=36'"
        />
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
      popupAnchor: [0, -24],
    });
  };

  /**
   * Initialize the Leaflet map
   */
  const init = (userId) => {
    currentUserId = userId;

    map = L.map('map', {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: false,
    });

    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTR,
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(map);

    // Reposition zoom control
    map.zoomControl.setPosition('bottomright');

    return map;
  };

  /**
   * Add or update a marker for a user
   */
  const addOrUpdateMarker = (data) => {
    const { userId, displayName, avatar, latitude, longitude } = data;
    const isSelf = userId === currentUserId;
    const latlng = [latitude, longitude];

    if (markers[userId]) {
      // Smoothly update position
      markers[userId].setLatLng(latlng);
      markers[userId].setIcon(createMarkerIcon(avatar, isSelf));
      markers[userId]._popup?.setContent(createPopupContent(displayName, latitude, longitude, isSelf));
    } else {
      // Create new marker
      const marker = L.marker(latlng, {
        icon: createMarkerIcon(avatar, isSelf),
        title: displayName,
      }).addTo(map);

      marker.bindPopup(createPopupContent(displayName, latitude, longitude, isSelf), {
        closeButton: false,
        className: 'dark-popup',
      });

      markers[userId] = marker;
    }

    // If it's the current user's first location, center map
    if (isSelf && !markers[userId]._hasCentered) {
      map.setView(latlng, 15, { animate: true });
      markers[userId]._hasCentered = true;
    }
  };

  const createPopupContent = (name, lat, lng, isSelf) => {
    return `
      <div class="popup-name">${isSelf ? '📍 You' : name}</div>
      <div class="popup-coords">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
    `;
  };

  /**
   * Remove a user's marker from the map
   */
  const removeMarker = (userId) => {
    if (markers[userId]) {
      map.removeLayer(markers[userId]);
      delete markers[userId];
    }
  };

  /**
   * Get count of active markers (excluding self)
   */
  const getOtherMarkersCount = () => {
    return Object.keys(markers).filter((id) => id !== currentUserId).length;
  };

  /**
   * Fit map bounds to show all markers
   */
  const fitToMarkers = () => {
    const markerKeys = Object.keys(markers);
    if (markerKeys.length === 0) return;

    const group = L.featureGroup(Object.values(markers));
    map.fitBounds(group.getBounds().pad(0.2), { animate: true, maxZoom: 14 });
  };

  /**
   * Get the map instance
   */
  const getMap = () => map;

  return { init, addOrUpdateMarker, removeMarker, getOtherMarkersCount, fitToMarkers, getMap };
})();
