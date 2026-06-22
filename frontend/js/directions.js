/**
 * directions.js — Routing and directions using OSRM (free, no API key)
 * Supports car, walk, and bike profiles.
 */
export const DirectionsManager = (() => {
  let map = null;
  let routeLayer = null;
  let startMarker = null;
  let endMarker = null;
  let waypointMarkers = [];
  let isActive = false;
  let currentProfile = 'driving'; // driving | walking | cycling

  // Profile config
  const PROFILES = {
    driving: {
      name: 'Car',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 001 12v4c0 .6.4 1 1 1h2"/>
               <circle cx="7" cy="17" r="2"/>
               <path d="M9 17h6"/>
               <circle cx="17" cy="17" r="2"/>
             </svg>`,
      base: 'https://router.project-osrm.org'
    },
    walking: {
      name: 'Walk',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               <circle cx="13" cy="4" r="2"/>
               <path d="M13 18l-3-6 1-4 2 2h3"/>
               <path d="M10 8l-3 4-2 3"/>
               <path d="M12 12l1 5 3 4"/>
               <path d="M8 22l1-4 2-2"/>
             </svg>`,
      base: 'https://routing.openstreetmap.de/routed-foot'
    },
    cycling: {
      name: 'Bike',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
               <circle cx="5.5" cy="17.5" r="3.5"/>
               <circle cx="18.5" cy="17.5" r="3.5"/>
               <path d="M15 6a1 1 0 100-2 1 1 0 000 2zm-3 5.5L8.5 6H5m7 5.5L15.5 17m-3.5-5.5h6.5m-3-6h-3.5l-3 5.5"/>
             </svg>`,
      base: 'https://routing.openstreetmap.de/routed-bike'
    },
  };

  // DOM references
  let panel = null;
  let startInput = null;
  let endInput = null;
  let instructionsList = null;
  let summaryEl = null;
  let profileBtns = null;
  let startResultsEl = null;
  let endResultsEl = null;

  // State
  let startCoords = null;
  let endCoords = null;
  let userLocation = null;

  /**
   * Initialize the directions module
   */
  const init = (mapInstance) => {
    map = mapInstance;
    panel = document.getElementById('directions-panel');
    startInput = document.getElementById('directions-start');
    endInput = document.getElementById('directions-end');
    instructionsList = document.getElementById('directions-instructions');
    summaryEl = document.getElementById('directions-summary');
    startResultsEl = document.getElementById('directions-start-results');
    endResultsEl = document.getElementById('directions-end-results');

    if (!panel) return;

    // Profile buttons
    profileBtns = panel.querySelectorAll('.profile-btn');
    profileBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        currentProfile = btn.dataset.profile;
        profileBtns.forEach((b) => b.classList.toggle('active', b === btn));
        if (startCoords && endCoords) {
          fetchRoute();
        }
      });
    });

    // Close button
    const closeBtn = document.getElementById('btn-close-directions');
    if (closeBtn) {
      closeBtn.addEventListener('click', close);
    }

    // Swap button
    const swapBtn = document.getElementById('btn-swap-directions');
    if (swapBtn) {
      swapBtn.addEventListener('click', swapEndpoints);
    }

    // "Use my location" for start
    const myLocBtn = document.getElementById('btn-my-location');
    if (myLocBtn) {
      myLocBtn.addEventListener('click', () => {
        if (userLocation) {
          startCoords = { ...userLocation };
          startInput.value = 'Your location';
          if (endCoords) fetchRoute();
        }
      });
    }

    // Click on map to set start/end when directions panel is open
    map.on('click', (e) => {
      if (!isActive) return;
      const { lat, lng } = e.latlng;

      if (!startCoords) {
        setStart(lat, lng);
      } else if (!endCoords) {
        setEnd(lat, lng);
      }
    });

    // Dismiss suggestions when clicking outside
    document.addEventListener('click', (e) => {
      if (!startInput?.contains(e.target) && !startResultsEl?.contains(e.target)) {
        hideSuggestions('start');
      }
      if (!endInput?.contains(e.target) && !endResultsEl?.contains(e.target)) {
        hideSuggestions('end');
      }
    });

    // Input geocoding with debounce
    let startTimer, endTimer;
    startInput?.addEventListener('input', () => {
      clearTimeout(startTimer);
      startTimer = setTimeout(() => geocodeInput(startInput, 'start'), 400);
    });
    endInput?.addEventListener('input', () => {
      clearTimeout(endTimer);
      endTimer = setTimeout(() => geocodeInput(endInput, 'end'), 400);
    });

    // Handle keypresses (Enter to select first suggestion, Escape to dismiss)
    const handleKeydown = (e, type) => {
      const resultsEl = type === 'start' ? startResultsEl : endResultsEl;
      if (e.key === 'Enter') {
        e.preventDefault();
        const firstItem = resultsEl?.querySelector('.search-result-item');
        if (firstItem) {
          firstItem.click();
        }
      } else if (e.key === 'Escape') {
        hideSuggestions(type);
        e.target.blur();
      }
    };

    startInput?.addEventListener('keydown', (e) => handleKeydown(e, 'start'));
    endInput?.addEventListener('keydown', (e) => handleKeydown(e, 'end'));

    // Auto-resolve to first suggestion on blur (with 250ms delay to allow click events to register first)
    const handleBlur = (type) => {
      setTimeout(() => {
        const resultsEl = type === 'start' ? startResultsEl : endResultsEl;
        const inputEl = type === 'start' ? startInput : endInput;

        if (resultsEl && resultsEl.style.display === 'block') {
          const firstItem = resultsEl.querySelector('.search-result-item');
          if (firstItem) {
            if (inputEl && inputEl.value.trim().length >= 3) {
              firstItem.click();
            }
          }
        }
        hideSuggestions(type);
      }, 250);
    };

    startInput?.addEventListener('blur', () => handleBlur('start'));
    endInput?.addEventListener('blur', () => handleBlur('end'));
  };

  /**
   * Open the directions panel
   */
  const open = (destination = null) => {
    isActive = true;
    panel?.classList.add('open');

    // Close other panels to avoid layout collision
    document.getElementById('community-panel')?.classList.remove('open');
    document.getElementById('users-sidebar')?.classList.add('collapsed');

    // Auto-fill start with user's location
    if (userLocation && !startCoords) {
      startCoords = { ...userLocation };
      startInput.value = 'Your location';
    }

    // If a destination was provided (e.g., from context menu)
    if (destination) {
      setEnd(destination.lat, destination.lng, destination.name);
    }
  };

  /**
   * Close the directions panel and clean up
   */
  const close = () => {
    isActive = false;
    panel?.classList.remove('open');
    clearRoute();
    startCoords = null;
    endCoords = null;
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
    if (instructionsList) instructionsList.innerHTML = '';
    if (summaryEl) summaryEl.style.display = 'none';
  };

  /**
   * Set start point
   */
  const setStart = async (lat, lng, name = null) => {
    startCoords = { lat, lng };
    
    if (!name) {
      startInput.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      // Reverse geocode for display name
      const placeName = await reverseGeocodeSimple(lat, lng);
      if (placeName && startCoords?.lat === lat) {
        startInput.value = placeName;
      }
    } else {
      startInput.value = name;
    }

    updateMarker('start', lat, lng);

    if (endCoords) fetchRoute();
  };

  /**
   * Set end point
   */
  const setEnd = async (lat, lng, name = null) => {
    endCoords = { lat, lng };
    
    if (!name) {
      endInput.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      const placeName = await reverseGeocodeSimple(lat, lng);
      if (placeName && endCoords?.lat === lat) {
        endInput.value = placeName;
      }
    } else {
      endInput.value = name;
    }

    updateMarker('end', lat, lng);

    if (startCoords) fetchRoute();
  };

  /**
   * Swap start and end points
   */
  const swapEndpoints = () => {
    const tempCoords = startCoords;
    const tempValue = startInput?.value || '';

    startCoords = endCoords;
    endCoords = tempCoords;

    if (startInput) startInput.value = endInput?.value || '';
    if (endInput) endInput.value = tempValue;

    if (startCoords) updateMarker('start', startCoords.lat, startCoords.lng);
    if (endCoords) updateMarker('end', endCoords.lat, endCoords.lng);

    if (startCoords && endCoords) fetchRoute();
  };

  /**
   * Fetch route from OSRM
   */
  const fetchRoute = async () => {
    if (!startCoords || !endCoords) return;

    showLoading();

    const base = PROFILES[currentProfile].base;
    const coords = `${startCoords.lng},${startCoords.lat};${endCoords.lng},${endCoords.lat}`;
    const url = `${base}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Routing failed');

      const data = await res.json();

      if (data.code !== 'Ok' || !data.routes?.length) {
        showError('No route found between these points.');
        return;
      }

      const route = data.routes[0];
      drawRoute(route);
      showInstructions(route);
      showSummary(route);
    } catch (err) {
      console.error('Routing error:', err);
      showError('Failed to calculate route. Try again.');
    }
  };

  /**
   * Draw the route polyline on map
   */
  const drawRoute = (route) => {
    if (routeLayer) {
      map.removeLayer(routeLayer);
    }

    const geojson = route.geometry;

    // Route outline (wider, darker)
    const outlineLayer = L.geoJSON(geojson, {
      style: {
        color: 'rgba(0, 0, 0, 0.4)',
        weight: 10,
        opacity: 1,
        lineCap: 'round',
        lineJoin: 'round',
      },
    });

    // Route line (main color)
    const lineLayer = L.geoJSON(geojson, {
      style: {
        color: '#00d2ff',
        weight: 6,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
      },
    });

    routeLayer = L.layerGroup([outlineLayer, lineLayer]).addTo(map);

    // Fit map to show entire route
    const bounds = lineLayer.getBounds();
    map.fitBounds(bounds.pad(0.15), { animate: true, maxZoom: 16 });
  };

  /**
   * Show turn-by-turn instructions
   */
  const showInstructions = (route) => {
    if (!instructionsList) return;

    const steps = route.legs[0]?.steps || [];

    instructionsList.innerHTML = steps
      .filter((step) => step.maneuver?.type !== 'arrive' || step === steps[steps.length - 1])
      .map((step, i) => {
        const icon = getManeuverIcon(step.maneuver?.type, step.maneuver?.modifier);
        const distance = formatDistance(step.distance);
        const name = step.name || 'Unnamed road';

        return `
          <div class="direction-step" data-step="${i}">
            <div class="step-icon">${icon}</div>
            <div class="step-details">
              <span class="step-instruction">${getInstructionText(step)}</span>
              <span class="step-meta">${name} · ${distance}</span>
            </div>
          </div>
        `;
      })
      .join('');
  };

  /**
   * Show route summary (distance + time)
   */
  const showSummary = (route) => {
    if (!summaryEl) return;

    const distance = formatDistance(route.distance);
    const duration = formatDuration(route.duration);

    summaryEl.innerHTML = `
      <div class="summary-item">
        <span class="summary-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.3 8.25a2.25 2.25 0 010 3.18l-9.87 9.87a2.25 2.25 0 01-3.18 0l-6.18-6.18a2.25 2.25 0 010-3.18l9.87-9.87a2.25 2.25 0 013.18 0l6.18 6.18z"/>
            <path d="M9 6l1.5 1.5M11.5 8.5L13 10M14 11l1.5 1.5M16.5 13.5L18 15M19 16l1.5 1.5"/>
          </svg>
        </span>
        <span class="summary-value">${distance}</span>
      </div>
      <div class="summary-item">
        <span class="summary-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
        </span>
        <span class="summary-value">${duration}</span>
      </div>
      <div class="summary-item">
        <span class="summary-icon">${PROFILES[currentProfile].icon}</span>
        <span class="summary-value">${PROFILES[currentProfile].name}</span>
      </div>
    `;
    summaryEl.style.display = 'flex';
  };

  /**
   * Update start/end markers on map
   */
  const updateMarker = (type, lat, lng) => {
    const isStart = type === 'start';
    const existing = isStart ? startMarker : endMarker;

    if (existing) {
      map.removeLayer(existing);
    }

    const icon = L.divIcon({
      className: 'direction-marker',
      html: `
        <div class="direction-marker-dot ${isStart ? 'start' : 'end'}">
          ${isStart ? '●' : '◎'}
        </div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    const marker = L.marker([lat, lng], { icon, draggable: true }).addTo(map);

    // Drag to update route
    marker.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      if (isStart) {
        setStart(pos.lat, pos.lng);
      } else {
        setEnd(pos.lat, pos.lng);
      }
    });

    if (isStart) {
      startMarker = marker;
    } else {
      endMarker = marker;
    }
  };

  /**
   * Clear route and markers
   */
  const clearRoute = () => {
    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
    if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
    if (endMarker) { map.removeLayer(endMarker); endMarker = null; }
    waypointMarkers.forEach((m) => map.removeLayer(m));
    waypointMarkers = [];
  };

  /**
   * Fetch suggestions with map viewport bias and query fallbacks
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
    console.log('[Directions Autocomplete] Prioritized candidate queries to try:', uniqueCandidates);

    // Limit to maximum 6 attempts to balance speed and accuracy
    for (let i = 0; i < uniqueCandidates.length && i < 6; i++) {
      const currentQuery = uniqueCandidates[i];
      const params = new URLSearchParams({
        q: currentQuery,
        format: 'json',
        addressdetails: '1',
        limit: '5',
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
        console.log(`[Directions Autocomplete] Fetching (attempt ${i + 1}): ${currentQuery}`);
        const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
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
            console.log(`[Directions Autocomplete] Succeeded on attempt ${i + 1} with query: ${currentQuery}`);
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
   * Geocode input text to coordinates
   */
  const geocodeInput = async (inputEl, type) => {
    const query = inputEl.value.trim();
    const resultsEl = type === 'start' ? startResultsEl : endResultsEl;
    if (!resultsEl) {
      console.error(`Directions results element for ${type} is missing!`);
      return;
    }

    if (!query || query.length < 3) {
      resultsEl.style.display = 'none';
      return;
    }

    // Show searching state immediately to verify input listener is firing
    resultsEl.innerHTML = `<div style="padding: 10px; font-size: 0.72rem; color: var(--text-muted); text-align: center;">Searching for "${escapeHtml(query)}"...</div>`;
    resultsEl.style.display = 'block';

    // Check if it's coordinates (e.g., "28.6139, 77.2090")
    const coordMatch = query.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        resultsEl.style.display = 'none';
        if (type === 'start') setStart(lat, lng, query);
        else setEnd(lat, lng, query);
        return;
      }
    }

    try {
      const results = await fetchWithFallback(query);
      console.log(`[Directions Autocomplete] Final suggestion results:`, results);
      renderSuggestions(results, type);
    } catch (err) {
      console.error('[Directions Autocomplete] Geocode error:', err);
      resultsEl.innerHTML = `<div style="padding: 10px; font-size: 0.72rem; color: var(--danger); text-align: center;">Search failed: ${escapeHtml(err.message)}</div>`;
    }
  };

  /**
   * Render autocomplete suggestions
   */
  const renderSuggestions = (results, type) => {
    const resultsEl = type === 'start' ? startResultsEl : endResultsEl;
    if (!resultsEl) return;

    if (!results || results.length === 0) {
      resultsEl.innerHTML = '<div style="padding: 10px; font-size: 0.72rem; color: var(--text-muted); text-align: center;">No results found</div>';
      resultsEl.style.display = 'block';
      return;
    }

    resultsEl.innerHTML = results
      .map(
        (r) => `
        <button class="search-result-item" data-lat="${r.lat}" data-lon="${r.lon}" data-name="${escapeHtml(r.display_name)}">
          <div class="search-result-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
          </div>
          <div class="search-result-text" style="min-width: 0; flex: 1;">
            <span class="search-result-name" style="font-size: 0.78rem; font-weight: 600; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${formatPlaceName(r)}</span>
            <span class="search-result-addr" style="font-size: 0.65rem; color: var(--text-muted); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${formatAddress(r)}</span>
          </div>
        </button>
      `
      )
      .join('');

    resultsEl.style.display = 'block';

    // Add click handlers to each suggestion
    resultsEl.querySelectorAll('.search-result-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const lat = parseFloat(item.dataset.lat);
        const lon = parseFloat(item.dataset.lon);
        const name = item.dataset.name;

        if (type === 'start') {
          setStart(lat, lon, name.split(',')[0]);
        } else {
          setEnd(lat, lon, name.split(',')[0]);
        }
        resultsEl.style.display = 'none';
      });
    });
  };

  /**
   * Hide suggestion list
   */
  const hideSuggestions = (type) => {
    const resultsEl = type === 'start' ? startResultsEl : endResultsEl;
    if (resultsEl) {
      resultsEl.style.display = 'none';
    }
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


  /**
   * Simple reverse geocode for display names
   */
  const reverseGeocodeSimple = async (lat, lng) => {
    try {
      const params = new URLSearchParams({
        lat: lat.toString(), lon: lng.toString(),
        format: 'json', zoom: '16', 'accept-language': 'en',
      });
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
        headers: { 'User-Agent': 'LiveLocationTracker/1.0' },
      });
      const data = await res.json();
      return data.display_name?.split(',')[0] || null;
    } catch {
      return null;
    }
  };

  /**
   * Update user's current location (called from app.js)
   */
  const setUserLocation = (lat, lng) => {
    const isFirstTime = !userLocation;
    const oldLocation = userLocation;
    userLocation = { lat, lng };

    // Auto-re-route: If we have an active route and the starting point is set to the user's location
    if (isActive && startInput && startInput.value === 'Your location' && endCoords) {
      if (isFirstTime) {
        startCoords = { lat, lng };
        fetchRoute();
      } else {
        // Recalculate route if the user moves by more than 15 meters
        const distanceMoved = map.distance(
          L.latLng(oldLocation.lat, oldLocation.lng),
          L.latLng(lat, lng)
        );
        if (distanceMoved > 15) {
          console.log(`[Directions] User moved ${distanceMoved.toFixed(1)}m. Recalculating route...`);
          startCoords = { lat, lng };
          fetchRoute();
        }
      }
    }
    // Auto-re-route when destination point is user location (swapped case)
    else if (isActive && endInput && endInput.value === 'Your location' && startCoords) {
      if (isFirstTime) {
        endCoords = { lat, lng };
        fetchRoute();
      } else {
        const distanceMoved = map.distance(
          L.latLng(oldLocation.lat, oldLocation.lng),
          L.latLng(lat, lng)
        );
        if (distanceMoved > 15) {
          console.log(`[Directions] User moved ${distanceMoved.toFixed(1)}m. Recalculating destination...`);
          endCoords = { lat, lng };
          fetchRoute();
        }
      }
    }
  };

  // ========== HELPERS ==========

  const showLoading = () => {
    if (instructionsList) {
      instructionsList.innerHTML = `
        <div class="directions-loading">
          <div class="search-spinner"></div>
          <span>Calculating route...</span>
        </div>
      `;
    }
  };

  const showError = (message) => {
    if (instructionsList) {
      instructionsList.innerHTML = `
        <div class="directions-error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 24px; height: 24px; color: var(--danger); margin-bottom: 8px;">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <p>${message}</p>
        </div>
      `;
    }
    if (summaryEl) summaryEl.style.display = 'none';
  };

  const formatDistance = (meters) => {
    if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
    return `${Math.round(meters)} m`;
  };

  const formatDuration = (seconds) => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins} min`;
    const hrs = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hrs}h ${remainMins}m`;
  };

  const getManeuverIcon = (type, modifier) => {
    const icons = {
      'turn-right': '↱', 'turn-left': '↰',
      'sharp right': '⤴', 'sharp left': '⤵',
      'slight right': '↗', 'slight left': '↖',
      'straight': '↑', 'uturn': '↩',
      'depart': '🟢', 'arrive': '🏁',
      'roundabout': '🔄', 'rotary': '🔄',
      'merge': '↗', 'fork': '⑂',
    };
    if (type === 'depart') return icons.depart;
    if (type === 'arrive') return icons.arrive;
    if (type === 'roundabout' || type === 'rotary') return icons.roundabout;
    return icons[modifier] || icons[type] || '→';
  };

  const getInstructionText = (step) => {
    const type = step.maneuver?.type || '';
    const modifier = step.maneuver?.modifier || '';
    const name = step.name || 'the road';

    if (type === 'depart') return `Start on ${name}`;
    if (type === 'arrive') return `Arrive at destination`;
    if (type === 'turn') return `Turn ${modifier} onto ${name}`;
    if (type === 'roundabout') return `Take the roundabout to ${name}`;
    if (type === 'merge') return `Merge onto ${name}`;
    if (type === 'fork') return `Take the ${modifier} fork onto ${name}`;
    return `Continue on ${name}`;
  };

  return { init, open, close, setUserLocation, setStart, setEnd, isOpen: () => isActive };
})();
