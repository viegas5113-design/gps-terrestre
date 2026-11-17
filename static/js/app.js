/**
 * GPS Terrestre Pro - Aplicação Principal (PWA Móvel)
 */
(function () {
  'use strict';

  const {
    haversineMeters,
    bearingDegrees,
    cardinalPT,
    formatDuration,
    formatDistance,
    formatCoords,
    calcSunTimes,
    buildGPX,
    buildKML,
    renderElevationSVG
  } = window.GeoUtils;

  const STORAGE_WPTS = 'gps_terrestre_wpts_v1';
  const STORAGE_TRACKS = 'gps_terrestre_tracks_v1';
  const STORAGE_CFG = 'gps_terrestre_cfg_v1';
  const STORAGE_CAR = 'gps_terrestre_car_v1';
  const STORAGE_FAVS = 'gps_terrestre_favs_v1';
  const STORAGE_ROAD_CACHE = 'gps_terrestre_road_cache_v1';

  const state = {
    lat: null,
    lon: null,
    alt: null,
    acc: null,
    speedKmh: 0,
    gpsHeading: null,
    compassHeading: null,
    autoFollow: true,
    headingUp: false,
    voiceOn: true,
    speedUnitIdx: 0, // 0=km/h, 1=mph, 2=m/s
    coordFmt: 'DD',
    speedLimit: 0,
    roadSpeedLimit: 0,
    nearestRadarDist: null,
    muteSpeedAlert: false,
    lastSpeedBeep: 0,
    lastRadarBeep: 0,
    autoNightMode: true,
    manualTheme: null,
    fuelConsumption: 6.0,
    layerIdx: 0,
    wakeLock: null,

    // Trip computer
    trip: {
      odoMeters: 0,
      maxSpeedKmh: 0,
      movingSec: 0,
      gainMeters: 0,
      lastAlt: null,
      lastPos: null,
      lastTime: null
    },

    // Track recording
    rec: {
      active: false,
      paused: false,
      points: [],
      distMeters: 0,
      gainMeters: 0,
      startTime: null,
      elapsedSec: 0,
      lastAlt: null,
      timerId: null
    },

    // Navigation
    nav: {
      active: false,
      mode: 'driving',
      target: null, // { lat, lon, name }
      steps: [],
      stepIdx: 0,
      routeCoords: [],
      totalDist: 0,
      totalDur: 0,
      lastSpokenIdx: -1
    },

    // Measure
    measure: {
      active: false,
      points: []
    },

    // Pending waypoint
    pendingWpt: null,
    wptFilter: 'all',

    waypoints: [],
    tracks: [],
    favorites: [],
    carPos: null,
    autoRecord: true
  };

  // --- DOM Helpers ---
  const $ = (id) => document.getElementById(id);

  function showToast(msg, ms = 2600) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), ms);
  }

  function showArrivalBanner(msg, ms = 6000) {
    const el = $('arrivalBanner');
    if (!el) return showToast(msg, ms);
    $('arrivalBannerText').textContent = msg;
    el.classList.add('visible');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('visible'), ms);
  }

  function syncAutoRecordUI() {
    if ($('cfgAutoRecord')) $('cfgAutoRecord').checked = !!state.autoRecord;
    if ($('cfgAutoRecordTracks')) $('cfgAutoRecordTracks').checked = !!state.autoRecord;
  }

  function syncRouteAndRecUI() {
    const btnRoute = $('btnSearchGo');
    if (btnRoute) {
      if (state.nav.active) {
        btnRoute.textContent = '❌ Parar Rota';
        btnRoute.className = 'btn btn-danger';
      } else {
        btnRoute.textContent = '▶️ Iniciar';
        btnRoute.className = 'btn btn-primary';
      }
    }

    const btnRec = $('btnStartRecSheet');
    if (btnRec) {
      if (state.rec.active) {
        btnRec.textContent = '⏹ Desligar';
        btnRec.className = 'btn btn-danger';
      } else {
        btnRec.textContent = '⏺️ Gravar';
        btnRec.className = 'btn btn-primary';
      }
    }

    const btnClearRoute = $('btnClearRouteMap');
    if (btnClearRoute) {
      const hasPath = Boolean(
        state.nav.active ||
        destMarker ||
        routePolyline.getLatLngs().length > 0 ||
        directLine.getLatLngs().length > 0 ||
        importedTrackLayer.getLatLngs().length > 0
      );
      btnClearRoute.style.display = hasPath ? 'inline-flex' : 'none';
    }
  }

  function applyNightMode() {
    let isNight;
    if (state.manualTheme === 'day' || state.manualTheme === 'night') {
      isNight = state.manualTheme === 'night';
    } else if (state.autoNightMode) {
      const lat = state.lat != null ? state.lat : 37.10;
      const lon = state.lon != null ? state.lon : -8.67;
      const sun = calcSunTimes(lat, lon, new Date());
      const now = new Date();
      const nowHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      if (sun.sunrise !== '--:--' && sun.sunset !== '--:--') {
        isNight = nowHHMM >= sun.sunset || nowHHMM < sun.sunrise;
      } else {
        const h = now.getHours();
        isNight = h >= 19 || h < 7;
      }
    } else {
      isNight = !document.body.classList.contains('theme-day');
    }
    document.body.classList.toggle('theme-day', !isNight);
    document.body.classList.toggle('night-drive', isNight);
    if ($('btnTheme')) {
      $('btnTheme').textContent = isNight ? '☀️' : '🌙';
      $('btnTheme').title = isNight ? 'Mudar para Modo Dia' : 'Mudar para Modo Noite';
    }
  }

  function loadStorage() {
    try {
      state.waypoints = JSON.parse(localStorage.getItem(STORAGE_WPTS) || '[]');
      state.tracks = JSON.parse(localStorage.getItem(STORAGE_TRACKS) || '[]');
      state.favorites = JSON.parse(localStorage.getItem(STORAGE_FAVS) || '[]');
      state.carPos = JSON.parse(localStorage.getItem(STORAGE_CAR) || 'null');
      const cfg = JSON.parse(localStorage.getItem(STORAGE_CFG) || '{}');
      if (cfg.coordFmt) state.coordFmt = cfg.coordFmt;
      if (cfg.speedLimit != null) state.speedLimit = Number(cfg.speedLimit) || 0;
      if (cfg.autoRecord != null) state.autoRecord = Boolean(cfg.autoRecord);
      if (cfg.muteSpeedAlert != null) state.muteSpeedAlert = Boolean(cfg.muteSpeedAlert);
      if (cfg.autoNightMode != null) state.autoNightMode = Boolean(cfg.autoNightMode);
      if (cfg.manualTheme) state.manualTheme = cfg.manualTheme;
      if (cfg.fuelConsumption != null) state.fuelConsumption = Math.max(0.5, Number(cfg.fuelConsumption) || 6.0);
    } catch (e) {
      console.warn('Erro ao ler localStorage', e);
    }
    $('cfgCoordFmt').value = state.coordFmt;
    $('cfgSpeedLimit').value = state.speedLimit;
    if ($('cfgMuteSpeedAlert')) $('cfgMuteSpeedAlert').checked = !!state.muteSpeedAlert;
    if ($('cfgAutoNight')) $('cfgAutoNight').checked = !!state.autoNightMode;
    if ($('cfgFuelConsumption')) $('cfgFuelConsumption').value = state.fuelConsumption.toFixed(1);
    $('hudCoordFmt').textContent = state.coordFmt;
    syncAutoRecordUI();
    applyNightMode();
  }

  function saveWaypoints() {
    localStorage.setItem(STORAGE_WPTS, JSON.stringify(state.waypoints));
  }

  function saveTracks() {
    localStorage.setItem(STORAGE_TRACKS, JSON.stringify(state.tracks));
  }

  function saveFavorites() {
    localStorage.setItem(STORAGE_FAVS, JSON.stringify(state.favorites));
  }

  function saveCfg() {
    localStorage.setItem(
      STORAGE_CFG,
      JSON.stringify({
        coordFmt: state.coordFmt,
        speedLimit: state.speedLimit,
        autoRecord: state.autoRecord,
        muteSpeedAlert: state.muteSpeedAlert,
        autoNightMode: state.autoNightMode,
        manualTheme: state.manualTheme,
        fuelConsumption: state.fuelConsumption,
        theme: document.body.classList.contains('theme-day') ? 'day' : 'night'
      })
    );
  }

  // --- Map Initialization ---
  const map = L.map('mapa', {
    zoomControl: false,
    attributionControl: true
  }).setView([38.7223, -9.1393], 7); // Portugal default before GPS lock

  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

  const baseLayers = [
    {
      name: 'OSM Estradas',
      layer: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
      })
    },
    {
      name: 'Topo & Trilhos',
      layer: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        attribution: '© OpenTopoMap'
      })
    },
    {
      name: 'Satélite',
      layer: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: '© Esri'
      })
    },
    {
      name: 'Ciclovias',
      layer: L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© CyclOSM'
      })
    }
  ];

  baseLayers[0].layer.addTo(map);

  const wptCluster = L.markerClusterGroup({ maxClusterRadius: 40 });
  map.addLayer(wptCluster);

  const recPolyline = L.polyline([], { color: '#ef4444', weight: 4, opacity: 0.9 }).addTo(map);
  const routePolyline = L.polyline([], { color: '#10b981', weight: 5, opacity: 0.9 }).addTo(map);
  const directLine = L.polyline([], { color: '#38bdf8', weight: 3, dashArray: '8,8' }).addTo(map);
  const importedTrackLayer = L.polyline([], { color: '#f59e0b', weight: 4, opacity: 0.9 }).addTo(map);
  let destMarker = null;
  const measureLine = L.polyline([], { color: '#f59e0b', weight: 3, dashArray: '6,6' }).addTo(map);
  const measureMarkers = L.layerGroup().addTo(map);

  let accCircle = null;
  let userMarker = null;
  let carMarker = null;
  let tempPinMarker = null;

  function createArrowIcon(deg) {
    const rot = deg != null && !isNaN(deg) ? deg : 0;
    return L.divIcon({
      className: 'user-gps-arrow',
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      html: `<svg width="34" height="34" viewBox="0 0 34 34" style="transform:rotate(${rot}deg);filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6));">
        <polygon points="17,3 28,29 17,22 6,29" fill="#10b981" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round"/>
      </svg>`
    });
  }

  map.on('dragstart', () => {
    state.autoFollow = false;
    $('btnCenterGps').classList.remove('active');
  });

  // Tap on map: measure mode OR drop pin popup
  map.on('click', (e) => {
    const { lat, lng } = e.latlng;
    if (state.measure.active) {
      state.measure.points.push([lat, lng]);
      L.circleMarker([lat, lng], { radius: 5, color: '#f59e0b', fillOpacity: 1 }).addTo(measureMarkers);
      updateMeasureUI();
      return;
    }

    if (tempPinMarker) map.removeLayer(tempPinMarker);
    tempPinMarker = L.marker([lat, lng]).addTo(map);
    const distTxt = state.lat != null ? formatDistance(haversineMeters(state.lat, state.lon, lat, lng)) : '--';
    const html = `
      <div style="min-width:170px;font-family:sans-serif;">
        <div style="font-weight:700;margin-bottom:4px;">📍 Ponto no Mapa</div>
        <div style="font-size:11px;color:#475569;margin-bottom:8px;">${lat.toFixed(5)}, ${lng.toFixed(5)} · Dist: ${distTxt}</div>
        <div style="display:flex;gap:6px;">
          <button onclick="window._gpsApp.routeTo(${lat},${lng},'Destino no Mapa')" style="flex:1;padding:6px;border:none;border-radius:6px;background:#10b981;color:#052e16;font-weight:700;cursor:pointer;">🧭 Ir</button>
          <button onclick="window._gpsApp.openSaveWpt(${lat},${lng})" style="flex:1;padding:6px;border:none;border-radius:6px;background:#0f172a;color:#fff;font-weight:700;cursor:pointer;">⭐ Guardar</button>
        </div>
      </div>
    `;
    tempPinMarker.bindPopup(html).openPopup();
  });

  // --- Audio & Voice ---
  function beepAlert() {
    if (state.muteSpeedAlert) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.12;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(() => { osc.stop(); ctx.close(); }, 180);
    } catch (_) {}
  }

  // --- Road Speed Limit & Speed Cameras (Overpass OSM + Cache) ---
  let lastRoadQueryPos = null;
  let lastRoadQueryTime = 0;
  let roadCacheMem = null;

  function getRoadCache() {
    if (roadCacheMem) return roadCacheMem;
    try {
      roadCacheMem = JSON.parse(localStorage.getItem(STORAGE_ROAD_CACHE) || '{}');
    } catch (_) {
      roadCacheMem = {};
    }
    return roadCacheMem;
  }

  function parseOsmMaxspeed(val) {
    if (!val) return 0;
    const s = String(val).trim().toLowerCase();
    if (s === 'pt:urban' || s === 'urban') return 50;
    if (s === 'pt:rural' || s === 'rural') return 90;
    if (s === 'pt:motorway' || s === 'motorway') return 120;
    const m = s.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  function applyRoadInfo(info, lat, lon) {
    state.roadSpeedLimit = info.maxspeed || 0;
    let nearest = null;
    if (Array.isArray(info.cameras)) {
      info.cameras.forEach((c) => {
        const d = haversineMeters(lat, lon, c.lat, c.lon);
        if (d <= 600 && (nearest == null || d < nearest)) nearest = d;
      });
    }
    state.nearestRadarDist = nearest;
    updateSpeedAndRadarUI(state.speedKmh);
  }

  async function fetchRoadLimitsAndRadars(lat, lon) {
    const now = Date.now();
    const moved = lastRoadQueryPos ? haversineMeters(lastRoadQueryPos.lat, lastRoadQueryPos.lon, lat, lon) : 9999;
    if (moved < 220 && now - lastRoadQueryTime < 25000) return;

    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    const cache = getRoadCache();
    const cached = cache[key];
    if (cached && now - cached.ts < 86400000) {
      lastRoadQueryPos = { lat, lon };
      lastRoadQueryTime = now;
      applyRoadInfo(cached, lat, lon);
      return;
    }

    if (navigator.onLine === false) return;
    lastRoadQueryPos = { lat, lon };
    lastRoadQueryTime = now;

    const query = `[out:json][timeout:8];(way(around:70,${lat},${lon})["highway"]["maxspeed"];node(around:800,${lat},${lon})["highway"="speed_camera"];);out center tags;`;
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query)
      });
      if (!res.ok) return;
      const data = await res.json();
      let maxspeed = 0;
      const cameras = [];
      (data.elements || []).forEach((el) => {
        if (el.type === 'node' && el.tags && el.tags.highway === 'speed_camera') {
          cameras.push({ lat: el.lat, lon: el.lon });
        } else if (el.type === 'way' && el.tags && el.tags.maxspeed && !maxspeed) {
          maxspeed = parseOsmMaxspeed(el.tags.maxspeed);
        }
      });
      const entry = { maxspeed, cameras, ts: now };
      cache[key] = entry;
      const keys = Object.keys(cache);
      if (keys.length > 80) delete cache[keys[0]];
      try { localStorage.setItem(STORAGE_ROAD_CACHE, JSON.stringify(cache)); } catch (_) {}
      applyRoadInfo(entry, lat, lon);
    } catch (_) {}
  }

  function updateSpeedAndRadarUI(spdKmh) {
    const activeLimit = state.speedLimit > 0 ? state.speedLimit : state.roadSpeedLimit;
    const wrap = $('speedLimitWrap');
    const sign = $('speedLimitSign');
    const radar = $('radarBadge');
    if (!wrap || !sign || !radar) return;

    const showWrap = activeLimit > 0 || state.nearestRadarDist != null;
    wrap.style.display = showWrap ? 'flex' : 'none';

    if (activeLimit > 0) {
      sign.style.display = 'grid';
      sign.textContent = String(activeLimit);
      const isOver = spdKmh > activeLimit;
      sign.classList.toggle('overspeed', isOver);
      $('hudCard').classList.toggle('speed-alert', isOver);
      if (isOver && Date.now() - state.lastSpeedBeep > 6000) {
        state.lastSpeedBeep = Date.now();
        beepAlert();
      }
    } else {
      sign.style.display = 'none';
      sign.classList.remove('overspeed');
      $('hudCard').classList.remove('speed-alert');
    }

    if (state.nearestRadarDist != null) {
      radar.style.display = 'inline-block';
      radar.textContent = `📷 Radar ${Math.round(state.nearestRadarDist)} m`;
      if (Date.now() - state.lastRadarBeep > 20000) {
        state.lastRadarBeep = Date.now();
        beepAlert();
      }
    } else {
      radar.style.display = 'none';
    }
  }

  function speakPT(text) {
    if (!state.voiceOn || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-PT';
      u.rate = 1.05;
      window.speechSynthesis.speak(u);
    } catch (_) {}
  }

  // --- GPS Watch ---
  function startGPS() {
    if (!('geolocation' in navigator)) {
      $('gpsBadge').className = 'gps-badge err';
      $('gpsBadgeTxt').textContent = 'Sem GPS';
      return;
    }

    navigator.geolocation.watchPosition(
      onPosition,
      (err) => {
        $('gpsBadge').className = 'gps-badge err';
        $('gpsBadgeTxt').textContent = err.code === 1 ? 'GPS Bloqueado' : 'Sem Sinal';
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  }

  function onPosition(pos) {
    const c = pos.coords;
    const now = Date.now();
    const lat = c.latitude;
    const lon = c.longitude;
    const alt = c.altitude;
    const acc = c.accuracy;
    const spdMs = c.speed != null && !isNaN(c.speed) ? Math.max(0, c.speed) : 0;
    const spdKmh = spdMs * 3.6;

    state.lat = lat;
    state.lon = lon;
    state.alt = alt;
    state.acc = acc;
    state.speedKmh = spdKmh;
    if (c.heading != null && !isNaN(c.heading) && spdKmh > 2.5) {
      state.gpsHeading = c.heading;
    }

    $('gpsBadge').className = 'gps-badge ok';
    $('gpsBadgeTxt').textContent = `GPS ±${Math.round(acc)}m`;

    // Trip computer updates
    if (state.trip.lastPos) {
      const d = haversineMeters(state.trip.lastPos.lat, state.trip.lastPos.lon, lat, lon);
      if (d > 2 && d < 500 && acc < 45) {
        state.trip.odoMeters += d;
      }
      if (spdKmh > 1.5 && state.trip.lastTime) {
        state.trip.movingSec += Math.min(10, (now - state.trip.lastTime) / 1000);
      }
    }
    state.trip.lastPos = { lat, lon };
    state.trip.lastTime = now;
    if (spdKmh > state.trip.maxSpeedKmh) state.trip.maxSpeedKmh = spdKmh;

    if (alt != null && !isNaN(alt)) {
      if (state.trip.lastAlt != null) {
        const diffAlt = alt - state.trip.lastAlt;
        if (diffAlt > 1.5 && diffAlt < 50) {
          state.trip.gainMeters += diffAlt;
          state.trip.lastAlt = alt;
        } else if (diffAlt < -1.5) {
          state.trip.lastAlt = alt;
        }
      } else {
        state.trip.lastAlt = alt;
      }
    }

    // Speed limit & radar alert (road maxspeed + manual speedLimit)
    fetchRoadLimitsAndRadars(lat, lon);
    updateSpeedAndRadarUI(spdKmh);
    if (state.autoNightMode && !state.manualTheme) applyNightMode();

    // Track recording
    if (state.rec.active && !state.rec.paused) {
      const pts = state.rec.points;
      const last = pts[pts.length - 1];
      const stepD = last ? haversineMeters(last.lat, last.lon, lat, lon) : 999;
      if (!last || stepD >= 4) {
        if (last) state.rec.distMeters += stepD;
        if (alt != null && !isNaN(alt)) {
          if (state.rec.lastAlt != null && alt - state.rec.lastAlt > 1.5) {
            state.rec.gainMeters += alt - state.rec.lastAlt;
            state.rec.lastAlt = alt;
          } else if (state.rec.lastAlt == null || alt < state.rec.lastAlt - 1.5) {
            state.rec.lastAlt = alt;
          }
        }
        pts.push({ lat, lon, ele: alt, time: now });
        recPolyline.addLatLng([lat, lon]);
      }
    }

    // Update map marker
    const activeHeading = state.gpsHeading != null ? state.gpsHeading : state.compassHeading;
    if (!userMarker) {
      userMarker = L.marker([lat, lon], { icon: createArrowIcon(activeHeading), zIndexOffset: 1000 }).addTo(map);
      accCircle = L.circle([lat, lon], { radius: acc, color: '#10b981', fillOpacity: 0.12, weight: 1 }).addTo(map);
      map.setView([lat, lon], 16);
    } else {
      userMarker.setLatLng([lat, lon]);
      userMarker.setIcon(createArrowIcon(activeHeading));
      accCircle.setLatLng([lat, lon]).setRadius(acc);
      if (state.autoFollow) {
        map.panTo([lat, lon], { animate: true, duration: 0.5 });
      }
    }

    if (state.headingUp && activeHeading != null) {
      $('mapa').style.transform = `rotate(${-activeHeading}deg)`;
    } else {
      $('mapa').style.transform = 'rotate(0deg)';
    }

    updateHUD();
    if (state.nav.active) updateNavigationProgress();
  }

  function updateHUD() {
    const units = [
      { label: 'km/h', mult: 1, dec: 0 },
      { label: 'mph', mult: 0.621371, dec: 0 },
      { label: 'm/s', mult: 1 / 3.6, dec: 1 }
    ];
    const u = units[state.speedUnitIdx];
    $('hudSpeed').textContent = (state.speedKmh * u.mult).toFixed(u.dec);
    $('hudSpeedUnit').textContent = u.label;

    const hdg = state.gpsHeading != null ? state.gpsHeading : state.compassHeading;
    $('hudHeading').textContent = hdg != null ? `${Math.round(hdg)}°` : '---°';
    $('hudCardinal').textContent = cardinalPT(hdg);

    const [c1, c2] = formatCoords(state.lat, state.lon, state.coordFmt);
    $('hudCoords').innerHTML = `<div>${c1}</div><div>${c2}</div>`;
    $('hudCoordFmt').textContent = state.coordFmt;

    $('hudAlt').textContent = state.alt != null ? `${Math.round(state.alt)} m` : '-- m';
    $('hudGain').textContent = `+${Math.round(state.trip.gainMeters)} m`;
    $('hudAcc').textContent = state.acc != null ? `±${Math.round(state.acc)} m` : '±-- m';
    $('hudOdo').textContent = `${(state.trip.odoMeters / 1000).toFixed(2)} km`;

    // Instruments sheet updates
    $('instHeading').textContent = hdg != null ? `${Math.round(hdg)}°` : '---°';
    $('instCardinal').textContent = cardinalPT(hdg);
    if (hdg != null) $('compassDial').style.transform = `rotate(${-hdg}deg)`;

    $('tripOdo').textContent = `${(state.trip.odoMeters / 1000).toFixed(2)} km`;
    $('tripMaxSpd').textContent = `${Math.round(state.trip.maxSpeedKmh)} km/h`;
    const avgKmh = state.trip.movingSec > 5 ? (state.trip.odoMeters / 1000) / (state.trip.movingSec / 3600) : 0;
    $('tripAvgSpd').textContent = `${Math.round(avgKmh)} km/h`;
    $('tripMoveTime').textContent = formatDuration(state.trip.movingSec);
    $('instAltGain').textContent = `${state.alt != null ? Math.round(state.alt) : '--'} m / +${Math.round(state.trip.gainMeters)}m`;

    if (state.lat != null) {
      const sun = calcSunTimes(state.lat, state.lon);
      $('instSun').textContent = `${sun.sunrise} / ${sun.sunset}`;
    }
  }

  // --- Compass Sensor ---
  function handleOrientation(ev) {
    let hdg = null;
    if (ev.webkitCompassHeading != null) {
      hdg = ev.webkitCompassHeading;
    } else if (ev.alpha != null) {
      hdg = (360 - ev.alpha) % 360;
    }
    if (hdg != null && !isNaN(hdg)) {
      state.compassHeading = hdg;
      if (state.speedKmh <= 2.5) updateHUD();
    }
  }

  function initCompass() {
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    } else if ('DeviceOrientationEvent' in window) {
      window.addEventListener('deviceorientation', handleOrientation, true);
    }
  }

  $('btnCalibrateCompass').addEventListener('click', async () => {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res === 'granted') {
          initCompass();
          showToast('Bússola ativada!');
        } else {
          showToast('Permissão de bússola recusada.');
        }
      } catch (e) {
        showToast('Erro ao ativar bússola.');
      }
    } else {
      initCompass();
      showToast('Sensor de bússola ativo. Faça um movimento em "8" para calibrar.');
    }
  });

  // --- Search & Routing (Photon + Nominatim PT + OSRM) ---
  let searchAbortController = null;
  let searchDebounceTimer = null;

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatPhotonResult(f) {
    const coords = f && f.geometry && f.geometry.coordinates;
    if (!coords || coords.length < 2) return null;
    const p = f.properties || {};
    const streetFull = [p.street, p.housenumber].filter(Boolean).join(' ');
    const title = p.name || streetFull || p.city || p.town || p.village || p.municipality || 'Local';
    const subParts = [];
    if (streetFull && streetFull !== title) subParts.push(streetFull);
    if (p.postcode) subParts.push(p.postcode);
    const locality = p.city || p.town || p.village || p.municipality;
    if (locality && locality !== title) subParts.push(locality);
    if (p.state && p.state !== locality) subParts.push(p.state);
    if (p.country) subParts.push(p.country);
    return {
      title,
      subtitle: subParts.join(', ') || p.osm_value || 'Portugal',
      lat: parseFloat(coords[1]),
      lon: parseFloat(coords[0])
    };
  }

  function formatNominatimResult(item) {
    const lat = parseFloat(item.lat);
    const lon = parseFloat(item.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
    const parts = (item.display_name || '').split(',').map((s) => s.trim()).filter(Boolean);
    const title = parts[0] || 'Local';
    const subtitle = parts.slice(1).join(', ') || item.display_name || '';
    return { title, subtitle, lat, lon };
  }

  async function searchLocation(query) {
    const q = query.trim();
    const box = $('searchResults');
    if (!q) {
      box.innerHTML = '';
      return;
    }

    // Direct lat,lon check
    const coordMatch = q.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lon = parseFloat(coordMatch[2]);
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        routeTo(lat, lon, `${lat.toFixed(4)}, ${lngOrLon(lon)}`);
        return;
      }
    }

    if (navigator.onLine === false) {
      box.innerHTML = '<div class="list-card"><div class="list-card-sub">📡 Sem ligação à internet. Ligue o Wi-Fi ou dados móveis para pesquisar moradas.</div></div>';
      return;
    }

    if (searchAbortController) searchAbortController.abort();
    searchAbortController = new AbortController();
    const { signal } = searchAbortController;

    box.innerHTML = '<div class="list-card-sub">🔍 A pesquisar moradas e locais...</div>';

    const biasLat = state.lat != null ? state.lat : 37.10;
    const biasLon = state.lon != null ? state.lon : -8.67;
    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${biasLat}&lon=${biasLon}&limit=6`;
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=pt&addressdetails=1&limit=6&q=${encodeURIComponent(q)}`;

    try {
      const [photonRes, nomRes] = await Promise.allSettled([
        fetch(photonUrl, { signal }).then((r) => {
          if (!r.ok) throw new Error('Photon HTTP ' + r.status);
          return r.json();
        }),
        fetch(nominatimUrl, { signal }).then((r) => {
          if (!r.ok) throw new Error('Nominatim HTTP ' + r.status);
          return r.json();
        })
      ]);

      if (signal.aborted) return;

      const anySuccess = photonRes.status === 'fulfilled' || nomRes.status === 'fulfilled';
      if (!anySuccess) {
        box.innerHTML = '<div class="list-card"><div class="list-card-sub">📡 Sem ligação à internet ou serviço de pesquisa indisponível.</div></div>';
        return;
      }

      const raw = [];
      if (photonRes.status === 'fulfilled' && Array.isArray(photonRes.value?.features)) {
        photonRes.value.features.forEach((f) => {
          const item = formatPhotonResult(f);
          if (item) raw.push(item);
        });
      }
      if (nomRes.status === 'fulfilled' && Array.isArray(nomRes.value)) {
        nomRes.value.forEach((n) => {
          const item = formatNominatimResult(n);
          if (item) raw.push(item);
        });
      }

      // Deduplicate nearby results with matching or very close coordinates
      const merged = [];
      raw.forEach((item) => {
        const isDup = merged.some((existing) => {
          const d = haversineMeters(existing.lat, existing.lon, item.lat, item.lon);
          return d < 60 || (d < 200 && existing.title.toLowerCase() === item.title.toLowerCase());
        });
        if (!isDup) merged.push(item);
      });

      const results = merged.slice(0, 8);
      if (!results.length) {
        box.innerHTML = `<div class="list-card"><div class="list-card-sub">Nenhum resultado encontrado para "${escapeHtml(q)}". Tente incluir a cidade ou verificar o nome.</div></div>`;
        return;
      }

      box.innerHTML = '';
      results.forEach((item) => {
        const dist = state.lat != null ? formatDistance(haversineMeters(state.lat, state.lon, item.lat, item.lon)) : '';
        const div = document.createElement('div');
        div.className = 'list-card search-result-card';
        div.innerHTML = `
          <div class="list-card-top">
            <div>
              <div class="list-card-title">${escapeHtml(item.title)}</div>
              <div class="list-card-sub">${escapeHtml(item.subtitle)}${dist ? ' · ' + dist : ''}</div>
            </div>
            <button class="btn btn-sm btn-primary">Ir</button>
          </div>
        `;
        div.addEventListener('click', () => {
          routeTo(item.lat, item.lon, item.title);
        });
        box.appendChild(div);
      });
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      box.innerHTML = '<div class="list-card"><div class="list-card-sub">📡 Erro na pesquisa (sem internet?).</div></div>';
    }
  }

  function lngOrLon(v) { return v.toFixed(4); }

  function maneuverPT(step) {
    const m = step.maneuver || {};
    const type = m.type || '';
    const mod = m.modifier || '';
    const road = step.name ? ` para ${step.name}` : '';
    if (type === 'arrive') return { icon: '🏁', text: 'Chegou ao destino' };
    if (type === 'depart') return { icon: '🚀', text: `Siga${road}` };
    if (type === 'roundabout' || type === 'rotary') {
      return { icon: '🔄', text: `Na rotunda, saia na ${m.exit || 1}ª saída${road}` };
    }
    if (mod.includes('left')) return { icon: '⬅️', text: `Vire à esquerda${road}` };
    if (mod.includes('right')) return { icon: '➡️', text: `Vire à direita${road}` };
    if (mod.includes('uturn')) return { icon: '↩️', text: `Inverta a marcha${road}` };
    return { icon: '⬆️', text: `Continue em frente${road}` };
  }

  async function routeTo(destLat, destLon, destName) {
    closeAllSheets();
    if (state.lat == null) {
      map.setView([destLat, destLon], 15);
      showToast('A aguardar sinal GPS para calcular rota.');
      return;
    }

    state.nav.active = true;
    state.nav.target = { lat: destLat, lon: destLon, name: destName };
    state.nav.lastSpokenIdx = -1;
    state.nav.stepIdx = 0;

    if (destMarker) map.removeLayer(destMarker);
    destMarker = L.marker([destLat, destLon], {
      icon: L.divIcon({ className: 'dest-pin', iconSize: [28, 28], iconAnchor: [14, 24], html: '<div style="font-size:22px;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.6));">🏁</div>' })
    }).addTo(map).bindPopup(`<strong>🏁 ${escapeHtml(destName)}</strong>`);

    if (state.autoRecord && !state.rec.active) {
      startRecording({ silent: true });
    }

    if (state.nav.mode === 'direct') {
      routePolyline.setLatLngs([]);
      directLine.setLatLngs([[state.lat, state.lon], [destLat, destLon]]);
      state.nav.steps = [];
      $('navBanner').classList.add('visible');
      updateNavigationProgress();
      syncRouteAndRecUI();
      speakPT(`A navegar em linha reta para ${destName}`);
      return;
    }

    directLine.setLatLngs([]);
    const profile = state.nav.mode === 'cycling' ? 'bike' : state.nav.mode === 'foot' ? 'foot' : 'car';
    const url = `https://router.project-osrm.org/route/v1/${profile}/${state.lon},${state.lat};${destLon},${destLat}?overview=full&geometries=geojson&steps=true`;

    try {
      showToast('A calcular rota...');
      const res = await fetch(url);
      const data = await res.json();
      if (data.code !== 'Ok' || !data.routes.length) throw new Error('No route');

      const route = data.routes[0];
      const coords = route.geometry.coordinates.map((c) => [c[1], c[0]]);
      routePolyline.setLatLngs(coords);
      map.fitBounds(routePolyline.getBounds(), { padding: [60, 60] });

      state.nav.routeCoords = coords;
      state.nav.steps = route.legs[0].steps || [];
      state.nav.totalDist = route.distance;
      state.nav.totalDur = route.duration;

      renderRouteSteps(state.nav.steps);
      $('navBanner').classList.add('visible');
      updateNavigationProgress();
      syncRouteAndRecUI();
      speakPT(`Rota calculada para ${destName}. ${formatDistance(route.distance)}.`);
    } catch (e) {
      // Fallback to direct bearing
      state.nav.mode = 'direct';
      directLine.setLatLngs([[state.lat, state.lon], [destLat, destLon]]);
      $('navBanner').classList.add('visible');
      updateNavigationProgress();
      syncRouteAndRecUI();
      showToast('Rota online indisponível. A usar linha reta.');
    }
  }

  function renderRouteSteps(steps) {
    const box = $('routeStepsBox');
    const list = $('routeStepsList');
    if (!steps.length) {
      box.style.display = 'none';
      return;
    }
    box.style.display = 'block';
    list.innerHTML = steps.map((s) => {
      const m = maneuverPT(s);
      return `<div class="list-card"><div>${m.icon} <strong>${m.text}</strong></div><div class="list-card-sub">${formatDistance(s.distance)}</div></div>`;
    }).join('');
  }

  function calcTripSummary(distMeters, durationSec) {
    const km = (distMeters || 0) / 1000;
    const avgKmh = durationSec > 0 ? km / (durationSec / 3600) : 0;
    const fuelL = km * ((state.fuelConsumption || 6.0) / 100);
    return { km, avgKmh, fuelL };
  }

  function handleDestinationArrival(target) {
    const destName = target.name || 'Destino';
    const recDist = state.rec.active ? state.rec.distMeters : state.trip.odoMeters;
    const recDur = state.rec.active ? state.rec.elapsedSec : state.trip.movingSec;
    const summary = calcTripSummary(recDist, recDur);
    speakPT(`Chegou ao seu destino: ${destName}`);
    cancelNavigation();
    if (state.rec.active) {
      stopAndSaveRec({ auto: true, autoName: destName });
      showArrivalBanner(
        `✅ Chegou a ${destName} — Gravado · ${formatDistance(recDist)} · Méd: ${summary.avgKmh.toFixed(0)} km/h · ⛽ ${summary.fuelL.toFixed(2)} L`,
        8000
      );
    } else {
      showArrivalBanner(`🏁 Chegou ao destino: ${destName} (${formatDistance(recDist)} · ⛽ ${summary.fuelL.toFixed(2)} L)`, 7000);
    }
  }

  function updateNavigationProgress() {
    if (!state.nav.active || state.lat == null || !state.nav.target) return;
    const t = state.nav.target;
    const directD = haversineMeters(state.lat, state.lon, t.lat, t.lon);
    const brg = bearingDegrees(state.lat, state.lon, t.lat, t.lon);

    if (state.nav.mode === 'direct' || !state.nav.steps.length) {
      directLine.setLatLngs([[state.lat, state.lon], [t.lat, t.lon]]);
      $('navIcon').textContent = '🧭';
      $('navInstr').textContent = `Rumo ${Math.round(brg)}° (${cardinalPT(brg)})`;
      $('navSub').textContent = `Destino: ${t.name}`;
      $('navDist').textContent = formatDistance(directD);
      const spd = Math.max(4, state.speedKmh || (state.nav.mode === 'foot' ? 5 : 40));
      const mins = Math.round((directD / 1000 / spd) * 60);
      $('navEtr').textContent = `${mins} min`;
      const eta = new Date(Date.now() + mins * 60000);
      $('navEta').textContent = eta.toTimeString().slice(0, 5);
      if (directD <= 35 && state.speedKmh <= 6) {
        handleDestinationArrival(t);
      }
      return;
    }

    // Advance turn-by-turn step when close to maneuver
    const steps = state.nav.steps;
    let idx = state.nav.stepIdx;
    while (idx < steps.length - 1) {
      const loc = steps[idx].maneuver.location; // [lon, lat]
      const dStep = haversineMeters(state.lat, state.lon, loc[1], loc[0]);
      if (dStep < 28) {
        idx++;
      } else {
        break;
      }
    }
    state.nav.stepIdx = idx;
    const curStep = steps[idx];
    const m = maneuverPT(curStep);
    const loc = curStep.maneuver.location;
    const dNext = haversineMeters(state.lat, state.lon, loc[1], loc[0]);

    $('navIcon').textContent = m.icon;
    $('navInstr').textContent = m.text;
    $('navSub').textContent = `Em ${formatDistance(dNext)} · ${t.name}`;

    if (idx !== state.nav.lastSpokenIdx && dNext < 180) {
      state.nav.lastSpokenIdx = idx;
      speakPT(`${m.text} em ${Math.round(dNext)} metros`);
    }

    // Remaining distance & duration from current step onward
    let remDist = dNext;
    let remDur = 0;
    for (let i = idx; i < steps.length; i++) {
      remDist += steps[i].distance;
      remDur += steps[i].duration;
    }
    $('navDist').textContent = formatDistance(remDist);
    const mins = Math.max(1, Math.round(remDur / 60));
    $('navEtr').textContent = `${mins} min`;
    const eta = new Date(Date.now() + mins * 60000);
    $('navEta').textContent = eta.toTimeString().slice(0, 5);

    if (directD <= 35 && state.speedKmh <= 6) {
      handleDestinationArrival(t);
    }
  }

  function cancelNavigation(opts = {}) {
    state.nav.active = false;
    state.nav.target = null;
    state.nav.steps = [];
    state.nav.routeCoords = [];
    routePolyline.setLatLngs([]);
    directLine.setLatLngs([]);
    importedTrackLayer.setLatLngs([]);
    if (destMarker) {
      map.removeLayer(destMarker);
      destMarker = null;
    }
    $('navBanner').classList.remove('visible');
    $('routeStepsBox').style.display = 'none';
    if (opts && opts.discardRec && state.rec.active) {
      discardRecording(true);
    }
    syncRouteAndRecUI();
  }

  // --- Track Recorder ---
  function startRecording(opts = {}) {
    if (state.rec.active) return;
    state.rec = {
      active: true,
      paused: false,
      points: [],
      distMeters: 0,
      gainMeters: 0,
      startTime: Date.now(),
      elapsedSec: 0,
      lastAlt: state.alt,
      timerId: null
    };
    recPolyline.setLatLngs([]);
    if (state.lat != null) {
      state.rec.points.push({ lat: state.lat, lon: state.lon, ele: state.alt, time: Date.now() });
      recPolyline.addLatLng([state.lat, state.lon]);
    }
    $('recBar').classList.add('visible');
    $('dockRecBtn').classList.add('recording');
    $('recStatusTxt').textContent = 'A gravar';
    $('btnRecPause').textContent = '⏸';
    $('recDist').textContent = '0.00 km';
    $('recTime').textContent = '00:00';
    $('recGain').textContent = '+0m';

    state.rec.timerId = setInterval(() => {
      if (!state.rec.paused) {
        state.rec.elapsedSec++;
        $('recDist').textContent = `${(state.rec.distMeters / 1000).toFixed(2)} km`;
        $('recTime').textContent = formatDuration(state.rec.elapsedSec);
        $('recGain').textContent = `+${Math.round(state.rec.gainMeters)}m`;
      }
    }, 1000);
    if (!opts.silent) {
      closeAllSheets();
      showToast('⏺️ Gravação de percurso iniciada');
    }
    syncRouteAndRecUI();
  }

  function discardRecording(quiet = false) {
    if (!state.rec.active) return;
    clearInterval(state.rec.timerId);
    state.rec.active = false;
    state.rec.paused = false;
    recPolyline.setLatLngs([]);
    $('recBar').classList.remove('visible');
    $('dockRecBtn').classList.remove('recording');
    syncRouteAndRecUI();
    syncRouteAndRecUI();
    if (!quiet) showToast('⏹ Gravação desligada');
  }

  function togglePauseRec() {
    if (!state.rec.active) return;
    state.rec.paused = !state.rec.paused;
    $('recStatusTxt').textContent = state.rec.paused ? 'Em pausa' : 'A gravar';
    $('btnRecPause').textContent = state.rec.paused ? '▶' : '⏸';
  }

  function stopAndSaveRec(opts = {}) {
    if (!state.rec.active) return;
    clearInterval(state.rec.timerId);
    state.rec.active = false;
    $('recBar').classList.remove('visible');
    $('dockRecBtn').classList.remove('recording');
    syncRouteAndRecUI();

    const isAuto = Boolean(opts && opts.auto);
    if (isAuto && state.rec.points.length === 1 && state.lat != null) {
      state.rec.points.push({ lat: state.lat, lon: state.lon, ele: state.alt, time: Date.now() });
    }

    if (state.rec.points.length < 2) {
      if (!isAuto) showToast('Percurso demasiado curto para guardar.');
      return;
    }

    const now = new Date();
    const dateStr = now.toLocaleDateString('pt-PT');
    const timeStr = now.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    const defaultName = opts && opts.autoName
      ? `${opts.autoName} (${dateStr} ${timeStr})`
      : `Percurso ${dateStr} ${timeStr}`;

    const name = isAuto ? defaultName : prompt('Nome do percurso:', defaultName);
    if (!name) return;

    state.tracks.unshift({
      id: Date.now(),
      name,
      date: now.toISOString(),
      distMeters: state.rec.distMeters,
      durationSec: state.rec.elapsedSec,
      gainMeters: state.rec.gainMeters,
      points: state.rec.points
    });
    saveTracks();
    renderTracksList();
    syncRouteAndRecUI();
    if (!isAuto) {
      showToast(`💾 Percurso "${name}" guardado!`);
    }
  }

  function renderTracksList() {
    const list = $('tracksList');
    if (!state.tracks.length) {
      list.innerHTML = '<div class="list-card-sub">Nenhum percurso gravado ou importado ainda.</div>';
      return;
    }
    list.innerHTML = '';
    state.tracks.forEach((t) => {
      const when = t.date ? new Date(t.date).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '';
      const sum = calcTripSummary(t.distMeters, t.durationSec);
      const div = document.createElement('div');
      div.className = 'list-card';
      div.innerHTML = `
        <div class="list-card-top">
          <div>
            <div class="list-card-title">🥾 ${escapeHtml(t.name)}</div>
            <div class="list-card-sub">${when ? escapeHtml(when) + ' · ' : ''}${formatDistance(t.distMeters)} · ${formatDuration(t.durationSec)} · ${sum.avgKmh.toFixed(1)} km/h · ⛽ ${sum.fuelL.toFixed(2)} L · +${Math.round(t.gainMeters || 0)}m</div>
          </div>
        </div>
        <div class="chip-row">
          <button class="btn btn-sm btn-primary" data-act="show">🗺️ Ver</button>
          <button class="btn btn-sm" data-act="profile">📈 Perfil</button>
          <button class="btn btn-sm" data-act="gpx">📤 GPX</button>
          <button class="btn btn-sm" data-act="kml">KML</button>
          <button class="btn btn-sm btn-danger" data-act="del">🗑️</button>
        </div>
      `;
      div.querySelector('[data-act="show"]').onclick = () => {
        const latlngs = t.points.map((p) => [p.lat, p.lon]);
        importedTrackLayer.setLatLngs(latlngs);
        map.fitBounds(importedTrackLayer.getBounds(), { padding: [40, 40] });
        syncRouteAndRecUI();
        closeAllSheets();
      };
      div.querySelector('[data-act="profile"]').onclick = () => {
        $('profileTitle').textContent = `📈 ${t.name}`;
        $('profileSvg').innerHTML = renderElevationSVG(t.points);
        $('trackProfileBox').style.display = 'block';
      };
      div.querySelector('[data-act="gpx"]').onclick = () => {
        downloadText(`${t.name}.gpx`, buildGPX({ tracks: [t], name: t.name }), 'application/gpx+xml');
      };
      div.querySelector('[data-act="kml"]').onclick = () => {
        downloadText(`${t.name}.kml`, buildKML(t), 'application/vnd.google-earth.kml+xml');
      };
      div.querySelector('[data-act="del"]').onclick = () => {
        state.tracks = state.tracks.filter((x) => x.id !== t.id);
        saveTracks();
        renderTracksList();
      };
      list.appendChild(div);
    });
  }

  // --- Waypoints & Car Marker ---
  function renderWaypointsMap() {
    wptCluster.clearLayers();
    state.waypoints.forEach((w) => {
      const m = L.marker([w.lat, w.lon], {
        icon: L.divIcon({
          className: 'wpt-pin',
          iconSize: [28, 28],
          iconAnchor: [14, 14],
          html: `<div style="font-size:20px;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.6));">${w.category || '📍'}</div>`
        })
      });
      m.bindPopup(`
        <strong>${w.category || '📍'} ${w.name}</strong><br>
        <small>${w.lat.toFixed(5)}, ${w.lon.toFixed(5)}</small><br>
        ${w.notes ? `<small>${w.notes}</small><br>` : ''}
        <button onclick="window._gpsApp.routeTo(${w.lat},${w.lon},'${w.name.replace(/'/g, '')}')" style="margin-top:6px;padding:5px 10px;border:none;border-radius:6px;background:#10b981;color:#052e16;font-weight:700;cursor:pointer;">🧭 Navegar</button>
      `);
      wptCluster.addLayer(m);
    });

    if (carMarker) {
      map.removeLayer(carMarker);
      carMarker = null;
    }
    if (state.carPos) {
      carMarker = L.marker([state.carPos.lat, state.carPos.lon], {
        icon: L.divIcon({ className: 'car-pin', iconSize: [30, 30], iconAnchor: [15, 15], html: '<div style="font-size:22px;">🚗</div>' })
      }).addTo(map).bindPopup(`
        <strong>🚗 Carro Estacionado</strong><br>
        <small>${state.carPos.lat.toFixed(5)}, ${state.carPos.lon.toFixed(5)}</small><br>
        <div style="display:flex;gap:6px;margin-top:6px;">
          <button onclick="window._gpsApp.routeTo(${state.carPos.lat},${state.carPos.lon},'Carro Estacionado')" style="padding:5px 10px;border:none;border-radius:6px;background:#10b981;color:#052e16;font-weight:700;cursor:pointer;">🧭 Ir</button>
          <button onclick="window._gpsApp.clearCar()" style="padding:5px 10px;border:none;border-radius:6px;background:#ef4444;color:#fff;font-weight:700;cursor:pointer;">❌ Tirar Carro</button>
        </div>
      `);
      $('quickCarBox').style.display = 'block';
      $('quickCarSub').textContent = `${state.carPos.lat.toFixed(5)}, ${state.carPos.lon.toFixed(5)}`;
      if ($('btnClearCarMap')) $('btnClearCarMap').style.display = 'inline-flex';
    } else {
      $('quickCarBox').style.display = 'none';
      if ($('btnClearCarMap')) $('btnClearCarMap').style.display = 'none';
    }
  }

  function renderWaypointsList() {
    const list = $('waypointsList');
    const filtered = state.wptFilter === 'all'
      ? state.waypoints
      : state.waypoints.filter((w) => w.category === state.wptFilter);

    if (!filtered.length) {
      list.innerHTML = '<div class="list-card-sub">Sem pontos nesta categoria.</div>';
      return;
    }

    list.innerHTML = '';
    filtered.forEach((w) => {
      const dist = state.lat != null ? formatDistance(haversineMeters(state.lat, state.lon, w.lat, w.lon)) : '--';
      const div = document.createElement('div');
      div.className = 'list-card';
      div.innerHTML = `
        <div class="list-card-top">
          <div>
            <div class="list-card-title">${w.category || '📍'} ${w.name}</div>
            <div class="list-card-sub">${dist} · ${w.lat.toFixed(5)}, ${w.lon.toFixed(5)}</div>
          </div>
        </div>
        <div class="chip-row">
          <button class="btn btn-sm btn-primary" data-act="go">🧭 Ir</button>
          <button class="btn btn-sm" data-act="view">👁️ Mapa</button>
          <button class="btn btn-sm btn-danger" data-act="del">🗑️</button>
        </div>
      `;
      div.querySelector('[data-act="go"]').onclick = () => routeTo(w.lat, w.lon, w.name);
      div.querySelector('[data-act="view"]').onclick = () => { map.setView([w.lat, w.lon], 16); closeAllSheets(); };
      div.querySelector('[data-act="del"]').onclick = () => {
        state.waypoints = state.waypoints.filter((x) => x.id !== w.id);
        saveWaypoints();
        renderWaypointsMap();
        renderWaypointsList();
      };
      list.appendChild(div);
    });
  }

  function openSaveWpt(lat, lon) {
    if (lat == null || lon == null) {
      if (state.lat == null) {
        showToast('A aguardar sinal GPS...');
        return;
      }
      lat = state.lat;
      lon = state.lon;
    }
    state.pendingWpt = { lat, lon, ele: state.alt };
    $('wptNameInput').value = '';
    $('wptNotesInput').value = '';
    $('wptCoordPreview').textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    openSheet('sheetAddWpt');
  }

  // --- File Import/Export ---
  function downloadText(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result;
        let geo;
        if (file.name.toLowerCase().endsWith('.gpx')) {
          const dom = new DOMParser().parseFromString(text, 'text/xml');
          geo = toGeoJSON.gpx(dom);
        } else if (file.name.toLowerCase().endsWith('.kml')) {
          const dom = new DOMParser().parseFromString(text, 'text/xml');
          geo = toGeoJSON.kml(dom);
        } else {
          geo = JSON.parse(text);
        }

        let addedWpts = 0, addedTrks = 0;
        for (const f of geo.features || []) {
          if (!f.geometry) continue;
          if (f.geometry.type === 'Point') {
            const [lon, lat, ele] = f.geometry.coordinates;
            state.waypoints.unshift({
              id: Date.now() + Math.random(),
              name: (f.properties && f.properties.name) || 'Ponto Importado',
              category: '🏔️',
              notes: (f.properties && f.properties.desc) || '',
              lat, lon, ele
            });
            addedWpts++;
          } else if (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') {
            const coords = f.geometry.type === 'LineString'
              ? f.geometry.coordinates
              : f.geometry.coordinates.flat();
            const pts = coords.map((c) => ({ lat: c[1], lon: c[0], ele: c[2] }));
            let dist = 0, gain = 0;
            for (let i = 1; i < pts.length; i++) {
              dist += haversineMeters(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
              if (pts[i].ele != null && pts[i - 1].ele != null && pts[i].ele > pts[i - 1].ele) {
                gain += pts[i].ele - pts[i - 1].ele;
              }
            }
            state.tracks.unshift({
              id: Date.now() + Math.random(),
              name: (f.properties && f.properties.name) || file.name,
              date: new Date().toISOString(),
              distMeters: dist,
              durationSec: 0,
              gainMeters: gain,
              points: pts
            });
            addedTrks++;
          }
        }
        saveWaypoints();
        saveTracks();
        renderWaypointsMap();
        renderWaypointsList();
        renderTracksList();
        showToast(`Importado: ${addedTrks} percursos, ${addedWpts} pontos!`);
      } catch (e) {
        showToast('Erro ao importar ficheiro.');
      }
    };
    reader.readAsText(file);
  }

  // --- Measure Tool ---
  function updateMeasureUI() {
    const pts = state.measure.points;
    measureLine.setLatLngs(pts);
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      total += haversineMeters(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    }
    $('measureVal').textContent = formatDistance(total);
  }

  // --- Sheets ---
  function openSheet(id) {
    closeAllSheets();
    $(id).classList.add('open');
  }

  function closeAllSheets() {
    document.querySelectorAll('.sheet-backdrop').forEach((el) => el.classList.remove('open'));
  }

  // --- Event Bindings ---
  document.querySelectorAll('.dock-btn[data-sheet]').forEach((btn) => {
    btn.addEventListener('click', () => openSheet(btn.dataset.sheet));
  });
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', closeAllSheets);
  });
  document.querySelectorAll('.sheet-backdrop').forEach((bg) => {
    bg.addEventListener('click', (e) => {
      if (e.target === bg) closeAllSheets();
    });
  });

  $('hudSpeedBox').addEventListener('click', () => {
    state.speedUnitIdx = (state.speedUnitIdx + 1) % 3;
    updateHUD();
  });

  $('hudCoordsBox').addEventListener('click', () => {
    const fmts = ['DD', 'DMS', 'DDM', 'UTM'];
    state.coordFmt = fmts[(fmts.indexOf(state.coordFmt) + 1) % fmts.length];
    $('cfgCoordFmt').value = state.coordFmt;
    saveCfg();
    updateHUD();
  });

  $('btnCopyCoordsNow').addEventListener('click', async () => {
    if (state.lat == null) return showToast('Sem GPS.');
    const txt = `${state.lat.toFixed(6)}, ${state.lon.toFixed(6)}`;
    await navigator.clipboard.writeText(txt);
    showToast(`Copiado: ${txt}`);
  });

  $('btnVoice').addEventListener('click', () => {
    state.voiceOn = !state.voiceOn;
    $('btnVoice').classList.toggle('active', state.voiceOn);
    showToast(state.voiceOn ? 'Voz de navegação ligada' : 'Voz desligada');
  });

  $('btnWakeLock').addEventListener('click', async () => {
    if (!('wakeLock' in navigator)) return showToast('Wake Lock não suportado.');
    if (state.wakeLock) {
      await state.wakeLock.release();
      state.wakeLock = null;
      $('btnWakeLock').classList.remove('active');
      showToast('Ecrã pode apagar normalmente');
    } else {
      try {
        state.wakeLock = await navigator.wakeLock.request('screen');
        $('btnWakeLock').classList.add('active');
        showToast('💡 Ecrã mantido sempre ligado');
      } catch (_) {}
    }
  });

  $('btnMirror').addEventListener('click', () => {
    document.body.classList.toggle('hud-mirror');
    $('btnMirror').classList.toggle('active');
  });

  $('btnTheme').addEventListener('click', () => {
    const currentlyNight = document.body.classList.contains('night-drive') || !document.body.classList.contains('theme-day');
    state.manualTheme = currentlyNight ? 'day' : 'night';
    applyNightMode();
    saveCfg();
    showToast(state.manualTheme === 'night' ? '🌙 Modo Noturno ativo' : '☀️ Modo Dia ativo');
  });

  $('btnFullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  $('btnLayerCycle').addEventListener('click', () => {
    map.removeLayer(baseLayers[state.layerIdx].layer);
    state.layerIdx = (state.layerIdx + 1) % baseLayers.length;
    baseLayers[state.layerIdx].layer.addTo(map);
    $('layerLabel').textContent = baseLayers[state.layerIdx].name;
    showToast(`Mapa: ${baseLayers[state.layerIdx].name}`);
  });

  $('btnHeadingUp').addEventListener('click', () => {
    state.headingUp = !state.headingUp;
    $('btnHeadingUp').classList.toggle('active', state.headingUp);
    if (!state.headingUp) $('mapa').style.transform = 'rotate(0deg)';
    showToast(state.headingUp ? 'Modo Rumo em Cima (Heading-Up)' : 'Modo Norte em Cima');
  });

  $('btnCenterGps').addEventListener('click', () => {
    state.autoFollow = true;
    $('btnCenterGps').classList.add('active');
    if (state.lat != null) map.setView([state.lat, state.lon], Math.max(map.getZoom(), 16));
  });

  function clearCar() {
    state.carPos = null;
    localStorage.removeItem(STORAGE_CAR);
    renderWaypointsMap();
    showToast('🚗 Marcador do carro removido!');
  }

  $('btnParkCar').addEventListener('click', () => {
    if (state.carPos && confirm('Carro já marcado! Quer navegar até ao carro? (Cancelar para atualizar posição atual)')) {
      routeTo(state.carPos.lat, state.carPos.lon, 'Carro Estacionado');
      return;
    }
    if (state.lat == null) return showToast('Sem GPS para marcar carro.');
    state.carPos = { lat: state.lat, lon: state.lon, time: Date.now() };
    localStorage.setItem(STORAGE_CAR, JSON.stringify(state.carPos));
    renderWaypointsMap();
    showToast('🚗 Posição do carro guardada!');
  });

  $('btnRouteToCar').addEventListener('click', () => {
    if (state.carPos) routeTo(state.carPos.lat, state.carPos.lon, 'Carro Estacionado');
  });

  if ($('btnClearCar')) $('btnClearCar').addEventListener('click', clearCar);
  if ($('btnClearCarMap')) $('btnClearCarMap').addEventListener('click', clearCar);

  $('btnCancelNav').addEventListener('click', () => {
    cancelNavigation({ discardRec: true });
    showToast('❌ Rota parada');
  });

  if ($('btnClearRouteMap')) {
    $('btnClearRouteMap').addEventListener('click', () => {
      cancelNavigation({ discardRec: true });
      showToast('❌ Caminho limpo do mapa');
    });
  }

  $('routeModeChips').querySelectorAll('.chip').forEach((c) => {
    c.addEventListener('click', () => {
      $('routeModeChips').querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
      c.classList.add('active');
      state.nav.mode = c.dataset.mode;
    });
  });

  $('btnSearchGo').addEventListener('click', () => {
    clearTimeout(searchDebounceTimer);
    if (state.nav.active) {
      cancelNavigation({ discardRec: true });
      showToast('❌ Rota parada');
      return;
    }
    searchLocation($('searchInput').value);
  });
  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(searchDebounceTimer);
      searchLocation($('searchInput').value);
    }
  });
  $('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchDebounceTimer);
    const val = e.target.value.trim();
    if (!val) {
      $('searchResults').innerHTML = '';
      return;
    }
    if (val.length >= 3) {
      searchDebounceTimer = setTimeout(() => searchLocation(val), 550);
    }
  });

  $('btnStartRecSheet').addEventListener('click', () => {
    if (state.rec.active) {
      discardRecording();
    } else {
      startRecording();
    }
  });
  $('btnRecPause').addEventListener('click', togglePauseRec);
  $('btnRecStop').addEventListener('click', () => stopAndSaveRec());
  if ($('btnRecDiscard')) {
    $('btnRecDiscard').addEventListener('click', () => discardRecording());
  }
  if ($('arrivalBanner')) {
    $('arrivalBanner').addEventListener('click', () => $('arrivalBanner').classList.remove('visible'));
  }
  const onAutoRecordChange = (e) => {
    state.autoRecord = Boolean(e.target.checked);
    syncAutoRecordUI();
    saveCfg();
    if (state.autoRecord && state.nav.active && !state.rec.active) {
      startRecording({ silent: true });
    }
    showToast(state.autoRecord ? '⏺️ Gravação Automática ativada' : 'Gravação Automática desativada');
  };
  if ($('cfgAutoRecordTracks')) $('cfgAutoRecordTracks').addEventListener('change', onAutoRecordChange);
  if ($('cfgAutoRecord')) $('cfgAutoRecord').addEventListener('change', onAutoRecordChange);
  $('importTrackFile').addEventListener('change', (e) => handleImportFile(e.target.files[0]));
  $('btnCloseProfile').addEventListener('click', () => { $('trackProfileBox').style.display = 'none'; });

  $('btnQuickSaveWpt').addEventListener('click', () => openSaveWpt());
  $('btnAddWptHere').addEventListener('click', () => openSaveWpt());
  $('btnExportAllGpx').addEventListener('click', () => {
    downloadText('pontos_gps_terrestre.gpx', buildGPX({ waypoints: state.waypoints, tracks: state.tracks }), 'application/gpx+xml');
  });

  $('wptCatChips').querySelectorAll('.chip').forEach((c) => {
    c.addEventListener('click', () => {
      $('wptCatChips').querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
      c.classList.add('active');
    });
  });

  $('btnConfirmSaveWpt').addEventListener('click', () => {
    if (!state.pendingWpt) return;
    const catChip = $('wptCatChips').querySelector('.chip.active');
    const w = {
      id: Date.now(),
      name: $('wptNameInput').value.trim() || 'Ponto Marcado',
      category: catChip ? catChip.dataset.cat : '⭐',
      notes: $('wptNotesInput').value.trim(),
      lat: state.pendingWpt.lat,
      lon: state.pendingWpt.lon,
      ele: state.pendingWpt.ele
    };
    state.waypoints.unshift(w);
    saveWaypoints();
    renderWaypointsMap();
    renderWaypointsList();
    closeAllSheets();
    showToast(`📍 "${w.name}" guardado!`);
  });

  $('wptFilterChips').querySelectorAll('.chip').forEach((c) => {
    c.addEventListener('click', () => {
      $('wptFilterChips').querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
      c.classList.add('active');
      state.wptFilter = c.dataset.cat;
      renderWaypointsList();
    });
  });

  $('btnResetTrip').addEventListener('click', () => {
    state.trip = { odoMeters: 0, maxSpeedKmh: 0, movingSec: 0, gainMeters: 0, lastAlt: state.alt, lastPos: state.trip.lastPos, lastTime: Date.now() };
    updateHUD();
    showToast('Computador de bordo zerado');
  });

  $('btnToggleMeasure').addEventListener('click', () => {
    state.measure.active = !state.measure.active;
    $('measurePill').classList.toggle('visible', state.measure.active);
    closeAllSheets();
    showToast(state.measure.active ? 'Toque no mapa para medir distâncias' : 'Medição terminada');
  });

  $('btnMeasureUndo').addEventListener('click', () => {
    state.measure.points.pop();
    measureMarkers.clearLayers();
    state.measure.points.forEach((p) => L.circleMarker(p, { radius: 5, color: '#f59e0b', fillOpacity: 1 }).addTo(measureMarkers));
    updateMeasureUI();
  });

  $('btnMeasureClear').addEventListener('click', () => {
    state.measure.points = [];
    state.measure.active = false;
    measureMarkers.clearLayers();
    measureLine.setLatLngs([]);
    $('measurePill').classList.remove('visible');
  });

  async function shareCurrentLocation() {
    if (state.lat == null) return showToast('A aguardar sinal GPS...');
    const latStr = state.lat.toFixed(6);
    const lonStr = state.lon.toFixed(6);
    const mapsUrl = `https://maps.google.com/?q=${latStr},${lonStr}`;
    let approxAddress = 'Localização aproximada indisponível';

    if (navigator.onLine !== false) {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 2200);
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latStr}&lon=${lonStr}&zoom=17&addressdetails=1`,
          { signal: ctrl.signal }
        );
        clearTimeout(tid);
        if (res.ok) {
          const data = await res.json();
          if (data && data.display_name) {
            approxAddress = data.display_name.split(',').slice(0, 3).map((s) => s.trim()).join(', ');
          }
        }
      } catch (_) {}
    }

    const text = `📍 Estou aqui:\nMorada aprox.: ${approxAddress}\nCoordenadas: ${latStr}, ${lonStr}\nAbrir no mapa: ${mapsUrl}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Onde Estou — GPS Terrestre', text, url: mapsUrl });
        return;
      } catch (_) {}
    }
    const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(waUrl, '_blank', 'noopener');
    try {
      await navigator.clipboard.writeText(text);
      showToast('📍 Mensagem copiada e pronta a enviar!');
    } catch (_) {}
  }

  $('btnShareLoc').addEventListener('click', shareCurrentLocation);
  if ($('btnQuickShareMap')) $('btnQuickShareMap').addEventListener('click', shareCurrentLocation);

  // --- Locais Favoritos (1 Toque) ---
  function renderFavoritesBar() {
    const list = $('favChipsList');
    if (!list) return;
    list.innerHTML = '';
    state.favorites.forEach((f) => {
      const btn = document.createElement('button');
      btn.className = 'fav-chip';
      btn.innerHTML = `${escapeHtml(f.icon || '⭐')} <span>${escapeHtml(f.name)}</span>`;
      btn.addEventListener('click', () => routeTo(f.lat, f.lon, f.name));
      list.appendChild(btn);
    });
  }

  function renderFavoritesManageList() {
    const list = $('favManageList');
    if (!list) return;
    if (!state.favorites.length) {
      list.innerHTML = '<div class="list-card-sub">Ainda não tem favoritos guardados.</div>';
      return;
    }
    list.innerHTML = '';
    state.favorites.forEach((f) => {
      const div = document.createElement('div');
      div.className = 'list-card';
      div.innerHTML = `
        <div class="list-card-top">
          <div>
            <div class="list-card-title">${escapeHtml(f.icon || '⭐')} ${escapeHtml(f.name)}</div>
            <div class="list-card-sub">${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}</div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-sm btn-primary" data-act="go">Ir</button>
            <button class="btn btn-sm btn-danger" data-act="del">🗑️</button>
          </div>
        </div>
      `;
      div.querySelector('[data-act="go"]').onclick = () => routeTo(f.lat, f.lon, f.name);
      div.querySelector('[data-act="del"]').onclick = () => {
        state.favorites = state.favorites.filter((x) => x.id !== f.id);
        saveFavorites();
        renderFavoritesBar();
        renderFavoritesManageList();
      };
      list.appendChild(div);
    });
  }

  if ($('btnOpenAddFav')) {
    $('btnOpenAddFav').addEventListener('click', () => {
      $('favNameInput').value = 'Casa';
      renderFavoritesManageList();
      openSheet('sheetAddFav');
    });
  }

  if ($('favSourceChips')) {
    $('favSourceChips').querySelectorAll('.chip').forEach((c) => {
      c.addEventListener('click', () => {
        $('favSourceChips').querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
        c.classList.add('active');
      });
    });
  }

  if ($('favIconChips')) {
    $('favIconChips').querySelectorAll('.chip').forEach((c) => {
      c.addEventListener('click', () => {
        $('favIconChips').querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
        c.classList.add('active');
        if (c.dataset.label) $('favNameInput').value = c.dataset.label;
      });
    });
  }

  if ($('btnSaveFav')) {
    $('btnSaveFav').addEventListener('click', () => {
      const srcChip = $('favSourceChips').querySelector('.chip.active');
      const src = srcChip ? srcChip.dataset.src : 'gps';
      let lat, lon;
      if (src === 'dest' && state.nav.target) {
        lat = state.nav.target.lat;
        lon = state.nav.target.lon;
      } else if (state.lat != null) {
        lat = state.lat;
        lon = state.lon;
      } else {
        const c = map.getCenter();
        lat = c.lat;
        lon = c.lng;
      }
      const iconChip = $('favIconChips').querySelector('.chip.active');
      const icon = iconChip ? iconChip.dataset.icon : '⭐';
      const name = $('favNameInput').value.trim() || (iconChip && iconChip.dataset.label) || 'Favorito';
      state.favorites.unshift({ id: Date.now(), icon, name, lat, lon });
      saveFavorites();
      renderFavoritesBar();
      renderFavoritesManageList();
      showToast(`⭐ Favorito "${name}" guardado!`);
    });
  }

  $('cfgSpeedLimit').addEventListener('change', (e) => {
    state.speedLimit = Math.max(0, Number(e.target.value) || 0);
    saveCfg();
    updateSpeedAndRadarUI(state.speedKmh);
  });

  if ($('cfgMuteSpeedAlert')) {
    $('cfgMuteSpeedAlert').addEventListener('change', (e) => {
      state.muteSpeedAlert = Boolean(e.target.checked);
      saveCfg();
      showToast(state.muteSpeedAlert ? '🔇 Aviso sonoro silenciado' : '🔊 Aviso sonoro ativado');
    });
  }

  if ($('cfgAutoNight')) {
    $('cfgAutoNight').addEventListener('change', (e) => {
      state.autoNightMode = Boolean(e.target.checked);
      if (state.autoNightMode) state.manualTheme = null;
      saveCfg();
      applyNightMode();
    });
  }

  if ($('cfgFuelConsumption')) {
    $('cfgFuelConsumption').addEventListener('change', (e) => {
      state.fuelConsumption = Math.max(0.5, Number(e.target.value) || 6.0);
      saveCfg();
      renderTracksList();
    });
  }

  $('cfgCoordFmt').addEventListener('change', (e) => {
    state.coordFmt = e.target.value;
    saveCfg();
    updateHUD();
  });

  // --- Painel GitHub & Sync Gist ---
  const STORAGE_GH_TOKEN = 'gps_terrestre_gh_token';
  const STORAGE_GH_GIST = 'gps_terrestre_gh_gist_id';

  $('btnGithubPanel').addEventListener('click', () => {
    const savedToken = localStorage.getItem(STORAGE_GH_TOKEN) || '';
    if (savedToken) $('ghTokenInput').value = savedToken;
    openSheet('sheetGithub');
  });

  $('btnCopyGhUrl').addEventListener('click', async () => {
    const url = $('ghPagesUrl').href;
    await navigator.clipboard.writeText(url);
    showToast('Link GitHub Pages copiado!');
  });

  $('btnGhBackup').addEventListener('click', async () => {
    const token = $('ghTokenInput').value.trim();
    if (!token) return showToast('Introduza um token GitHub (permissão gist).');
    localStorage.setItem(STORAGE_GH_TOKEN, token);
    const statusEl = $('ghSyncStatus');
    statusEl.textContent = 'A enviar backup para GitHub Gist...';
    const payload = {
      description: 'GPS Terrestre Pro - Backup Pontos e Percursos',
      public: false,
      files: {
        'gps_terrestre_backup.json': {
          content: JSON.stringify({
            updatedAt: new Date().toISOString(),
            waypoints: state.waypoints,
            tracks: state.tracks,
            carPos: state.carPos
          }, null, 2)
        }
      }
    };
    try {
      const gistId = localStorage.getItem(STORAGE_GH_GIST);
      const endpoint = gistId ? `https://api.github.com/gists/${gistId}` : 'https://api.github.com/gists';
      const method = gistId ? 'PATCH' : 'POST';
      const res = await fetch(endpoint, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      localStorage.setItem(STORAGE_GH_GIST, data.id);
      statusEl.textContent = `✅ Backup guardado (${new Date().toLocaleTimeString('pt-PT')})`;
      showToast('Backup guardado no GitHub!');
    } catch (err) {
      statusEl.textContent = `❌ Erro no backup: ${err.message}`;
    }
  });

  $('btnGhRestore').addEventListener('click', async () => {
    const token = $('ghTokenInput').value.trim();
    if (!token) return showToast('Introduza o token GitHub.');
    localStorage.setItem(STORAGE_GH_TOKEN, token);
    const statusEl = $('ghSyncStatus');
    statusEl.textContent = 'A procurar backup no GitHub...';
    try {
      let gistId = localStorage.getItem(STORAGE_GH_GIST);
      if (!gistId) {
        const listRes = await fetch('https://api.github.com/gists?per_page=20', {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
        });
        const list = await listRes.json();
        const found = (Array.isArray(list) ? list : []).find((g) => g.files && g.files['gps_terrestre_backup.json']);
        if (!found) throw new Error('Nenhum backup encontrado.');
        gistId = found.id;
        localStorage.setItem(STORAGE_GH_GIST, gistId);
      }
      const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const raw = data.files['gps_terrestre_backup.json'].content;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.waypoints)) state.waypoints = parsed.waypoints;
      if (Array.isArray(parsed.tracks)) state.tracks = parsed.tracks;
      if (parsed.carPos) {
        state.carPos = parsed.carPos;
        localStorage.setItem(STORAGE_CAR, JSON.stringify(state.carPos));
      }
      saveWaypoints();
      saveTracks();
      renderWaypointsMap();
      renderWaypointsList();
      renderTracksList();
      statusEl.textContent = `✅ Restaurado (${state.waypoints.length} pontos, ${state.tracks.length} percursos)`;
      showToast('Backup restaurado do GitHub!');
    } catch (err) {
      statusEl.textContent = `❌ Erro ao restaurar: ${err.message}`;
    }
  });

  // Expose popup callbacks
  window._gpsApp = { routeTo, openSaveWpt, clearCar };

  // Service Worker Registration
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // Boot
  loadStorage();
  renderFavoritesBar();
  renderWaypointsMap();
  renderWaypointsList();
  renderTracksList();
  initCompass();
  startGPS();
})();
