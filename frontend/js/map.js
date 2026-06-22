/**
 * map.js — Leaflet map initialization, marker management, and layer switching
 */
export const MapManager = (() => {
  let map = null;
  const markers = {};
  let currentUserId = null;
  let activeTileLayer = null;

  // ========== TILE LAYERS ==========
  const TILE_LAYERS = {
    dark: {
      name: 'Dark',
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attr: '&copy; OpenStreetMap &copy; CARTO',
      icon: '🌙',
      preview: 'https://a.basemaps.cartocdn.com/dark_all/6/32/21.png',
      subdomains: 'abcd',
      maxZoom: 19,
    },
    standard: {
      name: 'Standard',
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attr: '&copy; OpenStreetMap contributors',
      icon: '🗺️',
      preview: 'https://a.tile.openstreetmap.org/6/32/21.png',
      subdomains: 'abc',
      maxZoom: 19,
    },
    satellite: {
      name: 'Satellite',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attr: '&copy; Esri &mdash; Esri, i-cubed, USDA, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP',
      icon: '🛰️',
      preview: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/6/21/32',
      subdomains: [],
      maxZoom: 18,
    },
    terrain: {
      name: 'Terrain',
      url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      attr: '&copy; OpenStreetMap &copy; OpenTopoMap (CC-BY-SA)',
      icon: '⛰️',
      preview: 'https://a.tile.opentopomap.org/6/32/21.png',
      subdomains: 'abc',
      maxZoom: 17,
    },
    light: {
      name: 'Light',
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      attr: '&copy; OpenStreetMap &copy; CARTO',
      icon: '☀️',
      preview: 'https://a.basemaps.cartocdn.com/light_all/6/32/21.png',
      subdomains: 'abcd',
      maxZoom: 19,
    },
  };

  const DEFAULT_CENTER = [20.5937, 78.9629]; // India center
  const DEFAULT_ZOOM = 5;
  const STORAGE_KEY = 'llt_preferred_layer';

  /**
   * Get user's preferred layer from localStorage
   */
  const getPreferredLayer = () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved && TILE_LAYERS[saved] ? saved : 'dark';
  };

  /**
   * Save preferred layer to localStorage
   */
  const savePreferredLayer = (layerId) => {
    localStorage.setItem(STORAGE_KEY, layerId);
  };

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
   * Switch the active tile layer
   */
  const switchLayer = (layerId) => {
    if (!map || !TILE_LAYERS[layerId]) return;

    const layerConfig = TILE_LAYERS[layerId];

    // Remove current tile layer
    if (activeTileLayer) {
      map.removeLayer(activeTileLayer);
    }

    // Add new tile layer
    const tileOptions = {
      attribution: layerConfig.attr,
      maxZoom: layerConfig.maxZoom,
    };
    if (layerConfig.subdomains && layerConfig.subdomains.length > 0) {
      tileOptions.subdomains = layerConfig.subdomains;
    }

    activeTileLayer = L.tileLayer(layerConfig.url, tileOptions).addTo(map);

    // Update UI active state
    document.querySelectorAll('.layer-option').forEach((el) => {
      el.classList.toggle('active', el.dataset.layer === layerId);
    });

    // Update body class for light/dark layer theming
    document.body.classList.toggle('light-map-active', layerId === 'light' || layerId === 'standard' || layerId === 'terrain');

    savePreferredLayer(layerId);
  };

  /**
   * Build the layer picker UI
   */
  const buildLayerPicker = () => {
    const currentLayer = getPreferredLayer();

    const picker = document.getElementById('layer-picker');
    if (!picker) return;

    const grid = picker.querySelector('.layer-grid');
    if (!grid) return;

    grid.innerHTML = Object.entries(TILE_LAYERS)
      .map(
        ([id, layer]) => `
        <button class="layer-option ${id === currentLayer ? 'active' : ''}" data-layer="${id}" title="${layer.name}">
          <div class="layer-preview">
            <img src="${layer.preview}" alt="${layer.name}" loading="lazy" onerror="this.style.display='none'"/>
          </div>
          <div class="layer-label">
            <span class="layer-icon">${layer.icon}</span>
            <span class="layer-name">${layer.name}</span>
          </div>
        </button>
      `
      )
      .join('');

    // Add click handlers
    grid.querySelectorAll('.layer-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchLayer(btn.dataset.layer);
      });
    });
  };

  /**
   * Toggle the layer picker visibility
   */
  const toggleLayerPicker = () => {
    const picker = document.getElementById('layer-picker');
    if (picker) {
      picker.classList.toggle('open');
    }
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

    // Set initial tile layer from user preference
    const preferredLayer = getPreferredLayer();
    const layerConfig = TILE_LAYERS[preferredLayer];

    const tileOptions = {
      attribution: layerConfig.attr,
      maxZoom: layerConfig.maxZoom,
    };
    if (layerConfig.subdomains && layerConfig.subdomains.length > 0) {
      tileOptions.subdomains = layerConfig.subdomains;
    }

    activeTileLayer = L.tileLayer(layerConfig.url, tileOptions).addTo(map);

    // Apply light map class if needed
    document.body.classList.toggle('light-map-active', preferredLayer === 'light' || preferredLayer === 'standard' || preferredLayer === 'terrain');

    // Reposition zoom control
    map.zoomControl.setPosition('bottomright');

    // Build layer picker UI
    buildLayerPicker();

    // Setup layer picker toggle button
    const toggleBtn = document.getElementById('btn-layer-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLayerPicker();
      });
    }

    // Close layer picker when clicking outside
    document.addEventListener('click', (e) => {
      const picker = document.getElementById('layer-picker');
      const toggleBtn = document.getElementById('btn-layer-toggle');
      if (
        picker &&
        picker.classList.contains('open') &&
        !picker.contains(e.target) &&
        e.target !== toggleBtn &&
        !toggleBtn?.contains(e.target)
      ) {
        picker.classList.remove('open');
      }
    });

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
      <div class="popup-name">${isSelf ? 'You' : name}</div>
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

  return { init, addOrUpdateMarker, removeMarker, getOtherMarkersCount, fitToMarkers, getMap, switchLayer, toggleLayerPicker };
})();
