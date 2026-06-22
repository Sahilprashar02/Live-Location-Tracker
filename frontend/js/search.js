/**
 * search.js — Place search and reverse geocoding using Nominatim (OpenStreetMap)
 * Free, no API key required.
 */
export const SearchManager = (() => {
  let map = null;
  let searchMarker = null;
  let searchCircle = null;
  let debounceTimer = null;
  let poiLayer = null;
  let activePOI = null;
  const DEBOUNCE_MS = 350;
  const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
  const STORAGE_KEY = 'llt_recent_searches';
  const MAX_RECENT = 8;

  // DOM references (set during init)
  let searchInput = null;
  let searchResults = null;
  let searchClear = null;
  let searchContainer = null;
  let contextMenu = null;

  /**
   * Initialize the search module
   */
  const init = (mapInstance) => {
    map = mapInstance;
    poiLayer = L.layerGroup().addTo(map);
    searchInput = document.getElementById('search-input');
    searchResults = document.getElementById('search-results');
    searchClear = document.getElementById('search-clear');
    searchContainer = document.getElementById('search-container');
    contextMenu = document.getElementById('map-context-menu');

    if (!searchInput || !searchResults) return;

    // Input handler with debounce
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.trim();
      searchClear.style.display = query ? 'flex' : 'none';

      // Clear POI filters when typing in search input
      clearPOI();

      if (!query) {
        showRecentSearches();
        return;
      }

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => searchPlaces(query), DEBOUNCE_MS);
    });

    // Focus → show recent searches or results
    searchInput.addEventListener('focus', () => {
      const query = searchInput.value.trim();
      if (!query) {
        showRecentSearches();
      }
      searchResults.classList.add('open');
    });

    // Clear button
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      searchClear.style.display = 'none';
      clearSearchMarker();
      showRecentSearches();
      searchInput.focus();
    });

    // Close results when clicking outside
    document.addEventListener('click', (e) => {
      if (!searchContainer?.contains(e.target)) {
        searchResults.classList.remove('open');
      }
      if (contextMenu && !contextMenu.contains(e.target)) {
        contextMenu.classList.remove('open');
      }
    });

    // Keyboard navigation
    searchInput.addEventListener('keydown', (e) => {
      const items = searchResults.querySelectorAll('.search-result-item');
      const active = searchResults.querySelector('.search-result-item.focused');
      let idx = Array.from(items).indexOf(active);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (active) active.classList.remove('focused');
        idx = (idx + 1) % items.length;
        items[idx]?.classList.add('focused');
        items[idx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (active) active.classList.remove('focused');
        idx = idx <= 0 ? items.length - 1 : idx - 1;
        items[idx]?.classList.add('focused');
        items[idx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (active) {
          active.click();
        } else if (items.length > 0) {
          items[0].click();
        }
      } else if (e.key === 'Escape') {
        searchResults.classList.remove('open');
        searchInput.blur();
      }
    });

    // Right-click / long-press context menu for "What's here?"
    setupContextMenu();
  };

  /**
   * Fetch search results with map viewport bias and query fallbacks
   */
  const fetchWithFallback = async (query) => {
    const parts = query.split(',').map((p) => p.trim()).filter(Boolean);
    const candidates = [];

    // Helper to clean road suffix abbreviations (strict OSM Nominatim matching requires this)
    const cleanRoadSuffix = (str) => {
      return str
        .replace(/\b(rd|road)\b/gi, '')
        .replace(/\b(st|street)\b/gi, '')
        .replace(/\b(ln|lane)\b/gi, '')
        .replace(/\b(ave|avenue)\b/gi, '')
        .replace(/\b(dr|drive)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    // Prioritized Candidate 1: Cleaned full address
    candidates.push(cleanRoadSuffix(query));
    candidates.push(query);

    if (parts.length >= 4) {
      // Prioritized Candidate 2: Cleaned Street Name + City + State (highly reliable)
      candidates.push(cleanRoadSuffix(`${parts[2]}, ${parts.slice(-2).join(', ')}`));
      candidates.push(cleanRoadSuffix(`${parts[1]}, ${parts.slice(-2).join(', ')}`));
    }

    if (parts.length >= 3) {
      // Prioritized Candidate 3: Cleaned street-level address (without building info)
      candidates.push(cleanRoadSuffix(parts.slice(2).join(', ')));
      candidates.push(cleanRoadSuffix(parts.slice(1).join(', ')));
      
      // Raw fallback variants
      candidates.push(parts.slice(2).join(', '));
      candidates.push(parts.slice(1).join(', '));
    }

    if (parts.length === 2 || parts.length === 3) {
      candidates.push(cleanRoadSuffix(parts[parts.length - 1]));
    }

    // Deduplicate candidate list
    const uniqueCandidates = [...new Set(candidates)].filter(Boolean);
    console.log('[Search] Prioritized candidate queries to try:', uniqueCandidates);

    for (let i = 0; i < uniqueCandidates.length && i < 6; i++) {
      const currentQuery = uniqueCandidates[i];
      const params = new URLSearchParams({
        q: currentQuery,
        format: 'json',
        addressdetails: '1',
        limit: '6',
        'accept-language': 'en',
      });

      if (map) {
        const bounds = map.getBounds();
        const viewbox = `${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()},${bounds.getSouth()}`;
        params.append('viewbox', viewbox);
        params.append('bounded', '0');
      }
      params.append('countrycodes', 'in');

      try {
        console.log(`[Search] Fetching (attempt ${i + 1}): ${currentQuery}`);
        const res = await fetch(`${NOMINATIM_BASE}/search?${params}`, {
          headers: { 'User-Agent': 'LiveLocationTracker/1.0' },
        });
        if (res.ok) {
          const results = await res.json();
          const filtered = results.filter((r) => {
            if (currentQuery.length > 10 && (r.type === 'administrative' || r.type === 'city' || r.type === 'state')) {
              const nameLower = r.display_name.split(',')[0].toLowerCase();
              return currentQuery.toLowerCase().includes(nameLower);
            }
            return true;
          });

          if (filtered && filtered.length > 0) {
            console.log(`[Search] Succeeded on attempt ${i + 1} with query: ${currentQuery}`);
            return filtered;
          }
        }
      } catch (err) {
        console.error('Nominatim fetch attempt failed:', err);
      }
    }

    return [];
  };

  /**
   * Search places using Nominatim
   */
  const searchPlaces = async (query) => {
    showLoading();

    try {
      const coordinates = query.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
      if (coordinates) {
        const lat = Number(coordinates[1]);
        const lon = Number(coordinates[2]);
        if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
          selectPlace(lat, lon, `${lat.toFixed(6)}, ${lon.toFixed(6)}`);
          return;
        }
      }

      const results = await fetchWithFallback(query);
      console.log(`[Search] Final search results:`, results);
      renderSearchResults(results, query);
    } catch (err) {
      console.error('Search error:', err);
      renderError('Search failed. Try again.');
    }
  };

  /**
   * Reverse geocode — get address from coordinates
   */
  const reverseGeocode = async (lat, lng) => {
    try {
      const params = new URLSearchParams({
        lat: lat.toString(),
        lon: lng.toString(),
        format: 'json',
        addressdetails: '1',
        zoom: '18',
        'accept-language': 'en',
      });

      const res = await fetch(`${NOMINATIM_BASE}/reverse?${params}`, {
        headers: { 'User-Agent': 'LiveLocationTracker/1.0' },
      });

      if (!res.ok) throw new Error('Reverse geocode failed');
      return await res.json();
    } catch (err) {
      console.error('Reverse geocode error:', err);
      return null;
    }
  };

  /**
   * Render search results dropdown
   */
  const renderSearchResults = (results, query) => {
    if (results.length === 0) {
      searchResults.innerHTML = `
        <div class="search-empty">
          <span class="search-empty-icon">🔍</span>
          <p>No results found for "${query}"</p>
        </div>
      `;
      searchResults.classList.add('open');
      return;
    }

    searchResults.innerHTML = results
      .map(
        (r) => `
        <button class="search-result-item" data-lat="${r.lat}" data-lon="${r.lon}" data-name="${escapeHtml(r.display_name)}">
          <div class="search-result-icon">${getPlaceIcon(r.type, r.class)}</div>
          <div class="search-result-text">
            <span class="search-result-name">${formatPlaceName(r)}</span>
            <span class="search-result-addr">${formatAddress(r)}</span>
          </div>
        </button>
      `
      )
      .join('');

    // Add click handlers
    searchResults.querySelectorAll('.search-result-item').forEach((item) => {
      item.addEventListener('click', () => {
        const lat = parseFloat(item.dataset.lat);
        const lon = parseFloat(item.dataset.lon);
        const name = item.dataset.name;
        selectPlace(lat, lon, name);
      });
    });

    searchResults.classList.add('open');
  };

  /**
   * Show recent searches
   */
  const showRecentSearches = () => {
    const recent = getRecentSearches();

    if (recent.length === 0) {
      searchResults.innerHTML = `
        <div class="search-empty">
          <span class="search-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </span>
          <p>Search for places, addresses, or coordinates</p>
        </div>
      `;
    } else {
      searchResults.innerHTML = `
        <div class="search-section-label">Recent</div>
        ${recent
          .map(
            (r) => `
          <button class="search-result-item" data-lat="${r.lat}" data-lon="${r.lon}" data-name="${escapeHtml(r.name)}">
            <div class="search-result-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div class="search-result-text">
              <span class="search-result-name">${escapeHtml(r.name.split(',')[0])}</span>
              <span class="search-result-addr">${escapeHtml(r.name)}</span>
            </div>
          </button>
        `
          )
          .join('')}
      `;

      searchResults.querySelectorAll('.search-result-item').forEach((item) => {
        item.addEventListener('click', () => {
          const lat = parseFloat(item.dataset.lat);
          const lon = parseFloat(item.dataset.lon);
          const name = item.dataset.name;
          selectPlace(lat, lon, name);
        });
      });
    }

    searchResults.classList.add('open');
  };

  /**
   * Select a place and fly to it on the map
   */
  const selectPlace = (lat, lon, name) => {
    // Update input
    searchInput.value = name.split(',')[0];
    searchResults.classList.remove('open');
    searchClear.style.display = 'flex';

    // Save to recent
    saveRecentSearch({ lat, lon, name });

    // Fly to location
    map.flyTo([lat, lon], 16, { duration: 1.5 });

    // Place a search marker
    placeSearchMarker(lat, lon, name);
  };

  /**
   * Place a marker at search result
   */
  const placeSearchMarker = (lat, lon, name) => {
    clearSearchMarker();

    const icon = L.divIcon({
      className: 'search-marker',
      html: `
        <div class="search-marker-pin">
          <svg viewBox="0 0 24 24" fill="var(--accent-cyan)" stroke="none">
            <path d="M12 0C7.03 0 3 4.03 3 9c0 7.5 9 15 9 15s9-7.5 9-15c0-4.97-4.03-9-9-9zm0 12.75c-2.07 0-3.75-1.68-3.75-3.75S9.93 5.25 12 5.25s3.75 1.68 3.75 3.75-1.68 3.75-3.75 3.75z"/>
          </svg>
        </div>
        <div class="search-marker-pulse"></div>
      `,
      iconSize: [36, 45],
      iconAnchor: [18, 45],
      popupAnchor: [0, -45],
    });

    searchMarker = L.marker([lat, lon], { icon }).addTo(map);
    searchMarker.bindPopup(
      `<div class="popup-name">${escapeHtml(name.split(',')[0])}</div>
       <div class="popup-coords">${lat.toFixed(5)}, ${lon.toFixed(5)}</div>`,
      { closeButton: true, className: 'dark-popup' }
    ).openPopup();
  };

  /**
   * Clear search marker from map
   */
  const clearSearchMarker = () => {
    if (searchMarker) {
      map.removeLayer(searchMarker);
      searchMarker = null;
    }
    if (searchCircle) {
      map.removeLayer(searchCircle);
      searchCircle = null;
    }
  };

  /**
   * Setup right-click context menu for "What's here?"
   */
  const setupContextMenu = () => {
    if (!contextMenu) return;

    map.on('contextmenu', async (e) => {
      const { lat, lng } = e.latlng;

      // Position context menu
      const point = map.latLngToContainerPoint(e.latlng);
      contextMenu.style.left = `${point.x}px`;
      contextMenu.style.top = `${point.y}px`;
      contextMenu.classList.add('open');

      // Update coordinates display
      const coordsEl = contextMenu.querySelector('.context-coords');
      if (coordsEl) {
        coordsEl.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      }

      // "What's here?" button
      const whatsHereBtn = contextMenu.querySelector('#btn-whats-here');
      if (whatsHereBtn) {
        whatsHereBtn.onclick = async () => {
          contextMenu.classList.remove('open');
          const result = await reverseGeocode(lat, lng);
          if (result && result.display_name) {
            placeSearchMarker(lat, lng, result.display_name);
            searchInput.value = result.display_name.split(',')[0];
            searchClear.style.display = 'flex';
          } else {
            placeSearchMarker(lat, lng, `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
          }
        };
      }

      // "Copy coordinates" button
      const copyBtn = contextMenu.querySelector('#btn-copy-coords');
      if (copyBtn) {
        copyBtn.onclick = () => {
          contextMenu.classList.remove('open');
          navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`).catch(() => {});
        };
      }

      // "Directions to here" button
      const directionsBtn = contextMenu.querySelector('#btn-directions-here');
      if (directionsBtn) {
        directionsBtn.onclick = () => {
          contextMenu.classList.remove('open');
          window.dispatchEvent(new CustomEvent('directions-requested', {
            detail: { lat, lng, name: `${lat.toFixed(5)}, ${lng.toFixed(5)}` },
          }));
        };
      }
    });

    // Close context menu on map click
    map.on('click', () => {
      contextMenu?.classList.remove('open');
    });

    // Close context menu on map move
    map.on('movestart', () => {
      contextMenu?.classList.remove('open');
    });
  };

  // ========== HELPERS ==========

  const showLoading = () => {
    searchResults.innerHTML = `
      <div class="search-loading">
        <div class="search-spinner"></div>
        <span>Searching...</span>
      </div>
    `;
    searchResults.classList.add('open');
  };

  const renderError = (message) => {
    searchResults.innerHTML = `
      <div class="search-empty">
        <span class="search-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 24px; height: 24px; color: var(--danger); margin-bottom: 8px;">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </span>
        <p>${message}</p>
      </div>
    `;
    searchResults.classList.add('open');
  };

  const getPlaceIcon = (type, cls) => {
    const defaultPin = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
    const building = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="9" y1="22" x2="9" y2="16"/><line x1="15" y1="22" x2="15" y2="16"/><path d="M9 16h6"/><path d="M8 6h.01M16 6h.01M8 10h.01M16 10h.01"/></svg>`;
    const house = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
    const road = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>`;
    const food = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 110 8h-1M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4Z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>`;
    const nature = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M12 5a3 3 0 00-3-3h0a3 3 0 00-3 3M12 5a3 3 0 013-3h0a3 3 0 013 3"/></svg>`;
    const transit = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="16" rx="2"/><path d="M4 11h16M12 3v8M8 19l-2 3M16 19l2 3"/></svg>`;
    const shop = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>`;
    const hospital = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`;
 
    const group = type || cls || '';
    if (['city', 'town', 'suburb', 'hotel', 'bank', 'school', 'university', 'temple', 'church', 'mosque'].includes(group)) return building;
    if (['village', 'residential'].includes(group)) return house;
    if (['road', 'highway'].includes(group)) return road;
    if (['restaurant', 'cafe'].includes(group)) return food;
    if (['park', 'garden', 'river', 'lake', 'mountain', 'peak'].includes(group)) return nature;
    if (['station', 'airport', 'bus_stop'].includes(group)) return transit;
    if (['shop', 'supermarket'].includes(group)) return shop;
    if (['hospital'].includes(group)) return hospital;
    
    return defaultPin;
  };

  const formatPlaceName = (result) => {
    const parts = result.display_name.split(',');
    return escapeHtml(parts[0].trim());
  };

  const formatAddress = (result) => {
    const parts = result.display_name.split(',').slice(1, 4);
    return escapeHtml(parts.join(',').trim());
  };

  const escapeHtml = (text) => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  const getRecentSearches = () => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  };

  const saveRecentSearch = (search) => {
    const recent = getRecentSearches().filter(
      (r) => !(Math.abs(r.lat - search.lat) < 0.0001 && Math.abs(r.lon - search.lon) < 0.0001)
    );
    recent.unshift(search);
    if (recent.length > MAX_RECENT) recent.pop();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
  };

  const togglePOI = async (type) => {
    if (activePOI === type) {
      clearPOI();
      return;
    }

    clearPOI();
    activePOI = type;
    
    // Set active pill state in UI
    document.querySelectorAll('.explore-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.poi === type);
    });

    showLoadingPOI(type);

    try {
      const results = await fetchPOI(type);
      plotPOI(results, type);
    } catch (err) {
      console.error('[Explore POI] Error fetching POIs:', err);
      showPOIError(type, 'Search failed. Try again.');
    }
  };

  const clearPOI = () => {
    activePOI = null;
    if (poiLayer) poiLayer.clearLayers();
    document.querySelectorAll('.explore-btn').forEach((btn) => btn.classList.remove('active'));
    if (searchResults) searchResults.classList.remove('open');
  };

  const fetchPOI = async (type) => {
    if (!map) return [];
    const bounds = map.getBounds();
    const viewbox = `${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()},${bounds.getSouth()}`;
    
    const queries = {
      fuel: 'fuel station',
      hospital: 'hospital',
      restaurant: 'restaurant'
    };

    const params = new URLSearchParams({
      q: queries[type] || type,
      format: 'json',
      addressdetails: '1',
      limit: '25',
      viewbox: viewbox,
      bounded: '1',
      countrycodes: 'in'
    });

    const res = await fetch(`${NOMINATIM_BASE}/search?${params}`, {
      headers: { 'User-Agent': 'LiveLocationTracker/1.0' },
    });

    if (!res.ok) throw new Error('POI fetch failed');
    return await res.json();
  };

  const plotPOI = (results, type) => {
    restoreButtonTexts();
    if (poiLayer) poiLayer.clearLayers();

    if (!results || results.length === 0) {
      showPOIInfo(`No nearby ${type}s found in this view.`);
      return;
    }

    const icons = {
      fuel: '⛽',
      hospital: '🏥',
      restaurant: '🍔'
    };
    const iconChar = icons[type] || '📍';

    results.forEach((r) => {
      const lat = parseFloat(r.lat);
      const lon = parseFloat(r.lon);
      const name = r.display_name.split(',')[0].trim();

      const icon = L.divIcon({
        className: `poi-marker ${type}`,
        html: `<span>${iconChar}</span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14],
      });

      const marker = L.marker([lat, lon], { icon }).addTo(poiLayer);
      marker.bindPopup(
        `<div class="popup-name">${escapeHtml(name)}</div>
         <div class="popup-coords" style="font-size:0.65rem; color:var(--text-muted); margin-top:2px;">${escapeHtml(r.display_name.split(',').slice(1, 4).join(',').trim())}</div>
         <button class="btn-primary-small" style="font-size:0.6rem; padding:3px 6px; margin-top:6px; display:inline-block;" onclick="window.dispatchEvent(new CustomEvent('directions-requested', { detail: { lat: ${lat}, lng: ${lon}, name: '${escapeHtml(name)}' } }))">Directions</button>`,
        { closeButton: true, className: 'dark-popup' }
      );
    });
  };

  const showLoadingPOI = (type) => {
    const btn = document.querySelector(`.explore-btn[data-poi="${type}"]`);
    if (btn) {
      const label = btn.querySelector('span');
      if (label) label.textContent = 'Searching...';
    }
  };

  const showPOIInfo = (message) => {
    restoreButtonTexts();
    searchResults.innerHTML = `<div style="padding:12px; font-size:0.72rem; color:var(--text-muted); text-align:center;">${escapeHtml(message)}</div>`;
    searchResults.classList.add('open');
  };

  const showPOIError = (type, message) => {
    restoreButtonTexts();
    searchResults.innerHTML = `<div style="padding:12px; font-size:0.72rem; color:var(--danger); text-align:center;">${escapeHtml(message)}</div>`;
    searchResults.classList.add('open');
  };

  const restoreButtonTexts = () => {
    const labels = {
      fuel: 'Petrol',
      hospital: 'Hospitals',
      restaurant: 'Food'
    };
    document.querySelectorAll('.explore-btn').forEach((btn) => {
      const type = btn.dataset.poi;
      const label = btn.querySelector('span');
      if (label && labels[type]) {
        label.textContent = labels[type];
      }
    });
  };

  return { init, searchPlaces, reverseGeocode, clearSearchMarker, togglePOI, clearPOI };
})();
