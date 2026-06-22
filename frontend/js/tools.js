/**
 * tools.js — Advanced map tools: measurement, drop pin, coordinates, fullscreen
 */
export const ToolsManager = (() => {
  let map = null;
  let activeTool = null; // 'measure-distance' | 'measure-area' | 'drop-pin' | null

  // Measurement state
  let measurePoints = [];
  let measureMarkers = [];
  let measureLine = null;
  let measurePolygon = null;
  let measureLabels = [];

  // Drop pin state
  let droppedPins = [];

  // Coordinate tracker
  let coordsEl = null;

  /**
   * Initialize tools
   */
  const init = (mapInstance) => {
    map = mapInstance;

    // Live coordinates display
    coordsEl = document.getElementById('live-coords');
    if (coordsEl) {
      map.on('mousemove', (e) => {
        coordsEl.textContent = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
      });
      map.on('mouseout', () => {
        coordsEl.textContent = '—';
      });
    }

    // Fullscreen button
    const fullscreenBtn = document.getElementById('btn-fullscreen');
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', toggleFullscreen);
      document.addEventListener('fullscreenchange', updateFullscreenIcon);
    }

    // Measure distance button
    const measureDistBtn = document.getElementById('btn-measure-distance');
    if (measureDistBtn) {
      measureDistBtn.addEventListener('click', () => toggleTool('measure-distance'));
    }

    // Measure area button
    const measureAreaBtn = document.getElementById('btn-measure-area');
    if (measureAreaBtn) {
      measureAreaBtn.addEventListener('click', () => toggleTool('measure-area'));
    }

    // Drop pin button
    const dropPinBtn = document.getElementById('btn-drop-pin');
    if (dropPinBtn) {
      dropPinBtn.addEventListener('click', () => toggleTool('drop-pin'));
    }

    // Clear measurements button
    const clearBtn = document.getElementById('btn-clear-tools');
    if (clearBtn) {
      clearBtn.addEventListener('click', clearAll);
    }

    // Map click handler for tools
    map.on('click', onMapClick);

    // Escape to deactivate tool
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && activeTool) {
        deactivateTool();
      }
    });
  };

  /**
   * Toggle a tool on/off
   */
  const toggleTool = (tool) => {
    if (activeTool === tool) {
      deactivateTool();
    } else {
      activateTool(tool);
    }
  };

  /**
   * Activate a tool
   */
  const activateTool = (tool) => {
    deactivateTool(); // Clean up previous tool
    activeTool = tool;

    // Update button states
    document.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });

    // Change cursor
    const mapContainer = map.getContainer();
    mapContainer.style.cursor = 'crosshair';

    // Show tool info
    const toolInfo = document.getElementById('tool-info');
    if (toolInfo) {
      const messages = {
        'measure-distance': 'Click points on map to measure distance. Press Escape to finish.',
        'measure-area': 'Click points to draw a polygon. Press Escape to finish.',
        'drop-pin': 'Click on map to drop a pin.',
      };
      toolInfo.textContent = messages[tool] || '';
      toolInfo.style.display = 'block';
    }
  };

  /**
   * Deactivate current tool
   */
  const deactivateTool = () => {
    activeTool = null;

    document.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.classList.remove('active');
    });

    const mapContainer = map.getContainer();
    mapContainer.style.cursor = '';

    const toolInfo = document.getElementById('tool-info');
    if (toolInfo) toolInfo.style.display = 'none';

    // Finalize area measurement if we have points
    if (measurePolygon && measurePoints.length >= 3) {
      finalizeMeasureArea();
    }
  };

  /**
   * Handle map click based on active tool
   */
  const onMapClick = (e) => {
    if (!activeTool) return;

    const { lat, lng } = e.latlng;

    switch (activeTool) {
      case 'measure-distance':
        addMeasurePoint(lat, lng);
        updateMeasureLine();
        break;
      case 'measure-area':
        addMeasurePoint(lat, lng);
        updateMeasurePolygon();
        break;
      case 'drop-pin':
        dropPin(lat, lng);
        deactivateTool();
        break;
    }
  };

  /**
   * Add a point for measurement
   */
  const addMeasurePoint = (lat, lng) => {
    measurePoints.push([lat, lng]);

    // Add point marker
    const marker = L.circleMarker([lat, lng], {
      radius: 5,
      fillColor: '#00d2ff',
      fillOpacity: 1,
      color: '#fff',
      weight: 2,
    }).addTo(map);

    measureMarkers.push(marker);

    // Add distance label if more than 1 point
    if (measurePoints.length > 1) {
      const prevPoint = measurePoints[measurePoints.length - 2];
      const dist = map.distance(
        L.latLng(prevPoint[0], prevPoint[1]),
        L.latLng(lat, lng)
      );
      const totalDist = calculateTotalDistance();

      const midLat = (prevPoint[0] + lat) / 2;
      const midLng = (prevPoint[1] + lng) / 2;

      const label = L.tooltip({
        permanent: true,
        direction: 'center',
        className: 'measure-label',
      })
        .setLatLng([midLat, midLng])
        .setContent(formatMeasureDistance(dist))
        .addTo(map);

      measureLabels.push(label);

      // Update total distance display
      const totalEl = document.getElementById('measure-total');
      if (totalEl) {
        totalEl.textContent = `Total: ${formatMeasureDistance(totalDist)}`;
        totalEl.style.display = 'block';
      }
    }
  };

  /**
   * Update the measurement line
   */
  const updateMeasureLine = () => {
    if (measureLine) {
      map.removeLayer(measureLine);
    }

    if (measurePoints.length < 2) return;

    measureLine = L.polyline(measurePoints, {
      color: '#00d2ff',
      weight: 3,
      opacity: 0.8,
      dashArray: '8, 8',
    }).addTo(map);
  };

  /**
   * Update the measurement polygon
   */
  const updateMeasurePolygon = () => {
    if (measurePolygon) {
      map.removeLayer(measurePolygon);
    }

    if (measurePoints.length < 2) return;

    measurePolygon = L.polygon(measurePoints, {
      color: '#7a2bff',
      fillColor: '#7a2bff',
      fillOpacity: 0.15,
      weight: 2,
      dashArray: '6, 6',
    }).addTo(map);

    // Update area display
    if (measurePoints.length >= 3) {
      const area = calculateArea();
      const totalEl = document.getElementById('measure-total');
      if (totalEl) {
        totalEl.textContent = `Area: ${formatArea(area)}`;
        totalEl.style.display = 'block';
      }
    }
  };

  /**
   * Finalize area measurement
   */
  const finalizeMeasureArea = () => {
    if (measurePolygon) {
      measurePolygon.setStyle({ dashArray: null, fillOpacity: 0.2 });
    }
  };

  /**
   * Drop a custom pin on the map
   */
  const dropPin = async (lat, lng) => {
    const icon = L.divIcon({
      className: 'dropped-pin',
      html: `
        <div class="dropped-pin-marker">
          <svg viewBox="0 0 24 24" fill="#ff5252" stroke="none">
            <path d="M12 0C7.03 0 3 4.03 3 9c0 7.5 9 15 9 15s9-7.5 9-15c0-4.97-4.03-9-9-9zm0 12.75c-2.07 0-3.75-1.68-3.75-3.75S9.93 5.25 12 5.25s3.75 1.68 3.75 3.75-1.68 3.75-3.75 3.75z"/>
          </svg>
        </div>
      `,
      iconSize: [30, 38],
      iconAnchor: [15, 38],
      popupAnchor: [0, -38],
    });

    const marker = L.marker([lat, lng], { icon, draggable: true }).addTo(map);

    // Try to reverse geocode
    let placeName = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&accept-language=en`,
        { headers: { 'User-Agent': 'LiveLocationTracker/1.0' } }
      );
      const data = await res.json();
      if (data.display_name) {
        placeName = data.display_name.split(',').slice(0, 2).join(',');
      }
    } catch {}

    marker.bindPopup(
      `<div class="popup-name">📌 Dropped Pin</div>
       <div class="popup-coords">${placeName}</div>
       <div class="popup-coords">${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
       <button class="popup-remove-btn" onclick="this.closest('.leaflet-popup').querySelector('.leaflet-popup-close-button')?.click()">Remove pin</button>`,
      { closeButton: true, className: 'dark-popup' }
    ).openPopup();

    // Update coords on drag
    marker.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      marker.setPopupContent(
        `<div class="popup-name">📌 Dropped Pin</div>
         <div class="popup-coords">${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}</div>`
      );
    });

    droppedPins.push(marker);
  };

  /**
   * Clear all measurements and pins
   */
  const clearAll = () => {
    // Clear measurement points
    measurePoints = [];
    measureMarkers.forEach((m) => map.removeLayer(m));
    measureMarkers = [];
    measureLabels.forEach((l) => map.removeLayer(l));
    measureLabels = [];

    if (measureLine) { map.removeLayer(measureLine); measureLine = null; }
    if (measurePolygon) { map.removeLayer(measurePolygon); measurePolygon = null; }

    // Clear pins
    droppedPins.forEach((p) => map.removeLayer(p));
    droppedPins = [];

    // Hide total
    const totalEl = document.getElementById('measure-total');
    if (totalEl) totalEl.style.display = 'none';

    deactivateTool();
  };

  /**
   * Toggle fullscreen
   */
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.();
    }
  };

  const updateFullscreenIcon = () => {
    const btn = document.getElementById('btn-fullscreen');
    if (!btn) return;
    const isFS = !!document.fullscreenElement;
    btn.title = isFS ? 'Exit fullscreen' : 'Fullscreen';
    btn.innerHTML = isFS
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <path d="M4 14h6v6m10-6h-6v6M4 10h6V4m10 6h-6V4"/>
         </svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
         </svg>`;
  };

  // ========== HELPERS ==========

  const calculateTotalDistance = () => {
    let total = 0;
    for (let i = 1; i < measurePoints.length; i++) {
      total += map.distance(
        L.latLng(measurePoints[i - 1][0], measurePoints[i - 1][1]),
        L.latLng(measurePoints[i][0], measurePoints[i][1])
      );
    }
    return total;
  };

  const calculateArea = () => {
    // Shoelace formula for approximate area on a sphere
    if (measurePoints.length < 3) return 0;

    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371000; // Earth radius in meters
    let area = 0;
    const n = measurePoints.length;

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += toRad(measurePoints[j][1] - measurePoints[i][1]) *
        (2 + Math.sin(toRad(measurePoints[i][0])) + Math.sin(toRad(measurePoints[j][0])));
    }

    area = Math.abs(area * R * R / 2);
    return area;
  };

  const formatMeasureDistance = (meters) => {
    if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
    return `${Math.round(meters)} m`;
  };

  const formatArea = (sqMeters) => {
    if (sqMeters >= 1_000_000) return `${(sqMeters / 1_000_000).toFixed(2)} km²`;
    if (sqMeters >= 10_000) return `${(sqMeters / 10_000).toFixed(2)} ha`;
    return `${Math.round(sqMeters)} m²`;
  };

  return { init, toggleTool, clearAll, toggleFullscreen };
})();
