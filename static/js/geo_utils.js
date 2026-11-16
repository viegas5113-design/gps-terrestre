/**
 * Utilitários Geoespaciais, Conversões de Coordenadas, Sol/Lua e Exportação GPX/KML
 */
(function (global) {
  'use strict';

  const R_EARTH = 6371000; // metros
  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * RAD;
    const dLon = (lon2 - lon1) * RAD;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R_EARTH * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function bearingDegrees(lat1, lon1, lat2, lon2) {
    const f1 = lat1 * RAD;
    const f2 = lat2 * RAD;
    const dl = (lon2 - lon1) * RAD;
    const y = Math.sin(dl) * Math.cos(f2);
    const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
    return (Math.atan2(y, x) * DEG + 360) % 360;
  }

  function cardinalPT(deg) {
    if (deg == null || isNaN(deg)) return '--';
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  }

  function formatDuration(sec) {
    if (!sec || sec < 0) return '00:00';
    const s = Math.floor(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
  }

  function formatDistance(meters) {
    if (meters == null || isNaN(meters)) return '--';
    if (meters < 1000) return `${Math.round(meters)} m`;
    if (meters < 100000) return `${(meters / 1000).toFixed(2)} km`;
    return `${(meters / 1000).toFixed(1)} km`;
  }

  function toDMS(val, isLat) {
    const abs = Math.abs(val);
    const d = Math.floor(abs);
    const mFloat = (abs - d) * 60;
    const m = Math.floor(mFloat);
    const s = ((mFloat - m) * 60).toFixed(1);
    const hemi = isLat ? (val >= 0 ? 'N' : 'S') : (val >= 0 ? 'E' : 'W');
    return `${d}° ${String(m).padStart(2, '0')}' ${String(s).padStart(4, '0')}" ${hemi}`;
  }

  function toDDM(val, isLat) {
    const abs = Math.abs(val);
    const d = Math.floor(abs);
    const m = ((abs - d) * 60).toFixed(4);
    const hemi = isLat ? (val >= 0 ? 'N' : 'S') : (val >= 0 ? 'E' : 'W');
    return `${d}° ${String(m).padStart(7, '0')}' ${hemi}`;
  }

  /**
   * Conversão WGS84 -> UTM
   */
  function toUTM(lat, lon) {
    const a = 6378137.0;
    const f = 1 / 298.257223563;
    const k0 = 0.9996;
    const e2 = f * (2 - f);
    const ep2 = e2 / (1 - e2);

    const zone = Math.floor((lon + 180) / 6) + 1;
    const lon0 = ((zone - 1) * 6 - 180 + 3) * RAD;
    const phi = lat * RAD;
    const lam = lon * RAD;

    const N = a / Math.sqrt(1 - e2 * Math.sin(phi) * Math.sin(phi));
    const T = Math.tan(phi) * Math.tan(phi);
    const C = ep2 * Math.cos(phi) * Math.cos(phi);
    const A = Math.cos(phi) * (lam - lon0);

    const M = a * (
      (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * phi -
      (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * phi) +
      (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * phi) -
      (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * phi)
    );

    const easting = k0 * N * (
      A + (1 - T + C) * Math.pow(A, 3) / 6 +
      (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5) / 120
    ) + 500000.0;

    let northing = k0 * (
      M + N * Math.tan(phi) * (
        A * A / 2 +
        (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24 +
        (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6) / 720
      )
    );
    if (lat < 0) northing += 10000000.0;

    const bands = 'CDEFGHJKLMNPQRSTUVWXX';
    const bandIdx = Math.max(0, Math.min(20, Math.floor((lat + 80) / 8)));
    const band = bands[bandIdx];

    return {
      zone: `${zone}${band}`,
      easting: Math.round(easting),
      northing: Math.round(northing),
      text: `${zone}${band} ${Math.round(easting)}E ${Math.round(northing)}N`
    };
  }

  function formatCoords(lat, lon, fmt) {
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) {
      return ['--° --\' --"', '--° --\' --"'];
    }
    switch (fmt) {
      case 'DMS':
        return [toDMS(lat, true), toDMS(lon, false)];
      case 'DDM':
        return [toDDM(lat, true), toDDM(lon, false)];
      case 'UTM': {
        const u = toUTM(lat, lon);
        return [`Zona ${u.zone}`, `${u.easting}E  ${u.northing}N`];
      }
      case 'DD':
      default:
        return [`${lat.toFixed(6)}°`, `${lon.toFixed(6)}°`];
    }
  }

  /**
   * Cálculo aproximado de Nascer e Pôr do Sol (NOAA) para qualquer coordenada e data.
   */
  function calcSunTimes(lat, lon, date = new Date()) {
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date - start;
    const dayOfYear = Math.floor(diff / 86400000);
    const lngHour = lon / 15;

    function calcEvent(isSunrise) {
      const t = dayOfYear + ((isSunrise ? 6 : 18) - lngHour) / 24;
      const M = 0.9856 * t - 3.289;
      let L = M + 1.916 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 282.634;
      L = ((L % 360) + 360) % 360;

      let RA = Math.atan(0.91764 * Math.tan(L * RAD)) * DEG;
      RA = ((RA % 360) + 360) % 360;
      const Lquad = Math.floor(L / 90) * 90;
      const RAquad = Math.floor(RA / 90) * 90;
      RA = (RA + (Lquad - RAquad)) / 15;

      const sinDec = 0.39782 * Math.sin(L * RAD);
      const cosDec = Math.cos(Math.asin(sinDec));
      const zenith = 90.833;
      const cosH = (Math.cos(zenith * RAD) - sinDec * Math.sin(lat * RAD)) / (cosDec * Math.cos(lat * RAD));

      if (cosH > 1 || cosH < -1) return null;

      let H = isSunrise ? 360 - Math.acos(cosH) * DEG : Math.acos(cosH) * DEG;
      H = H / 15;

      const T = H + RA - 0.06571 * t - 6.622;
      let UT = ((T - lngHour) % 24 + 24) % 24;
      const offsetHours = -date.getTimezoneOffset() / 60;
      const localT = ((UT + offsetHours) % 24 + 24) % 24;
      const hh = Math.floor(localT);
      const mm = Math.round((localT - hh) * 60);
      const finalH = mm === 60 ? (hh + 1) % 24 : hh;
      const finalM = mm === 60 ? 0 : mm;
      return `${String(finalH).padStart(2, '0')}:${String(finalM).padStart(2, '0')}`;
    }

    const sunrise = calcEvent(true);
    const sunset = calcEvent(false);
    return { sunrise: sunrise || '--:--', sunset: sunset || '--:--' };
  }

  /**
   * Exportação GPX 1.1 (Waypoints e Tracks)
   */
  function escapeXml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildGPX({ waypoints = [], tracks = [], name = 'GPS Terrestre Pro' }) {
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<gpx version="1.1" creator="GPS Terrestre Pro" xmlns="http://www.topografix.com/GPX/1/1">',
      `  <metadata><name>${escapeXml(name)}</name><time>${new Date().toISOString()}</time></metadata>`
    ];

    for (const w of waypoints) {
      lines.push(`  <wpt lat="${w.lat}" lon="${w.lon}">`);
      if (w.ele != null && !isNaN(w.ele)) lines.push(`    <ele>${Number(w.ele).toFixed(1)}</ele>`);
      lines.push(`    <name>${escapeXml(w.name)}</name>`);
      if (w.category) lines.push(`    <type>${escapeXml(w.category)}</type>`);
      if (w.notes) lines.push(`    <desc>${escapeXml(w.notes)}</desc>`);
      lines.push('  </wpt>');
    }

    for (const trk of tracks) {
      lines.push('  <trk>');
      lines.push(`    <name>${escapeXml(trk.name || 'Percurso')}</name>`);
      lines.push('    <trkseg>');
      for (const pt of trk.points || []) {
        lines.push(`      <trkpt lat="${pt.lat}" lon="${pt.lon}">`);
        if (pt.ele != null && !isNaN(pt.ele)) lines.push(`        <ele>${Number(pt.ele).toFixed(1)}</ele>`);
        if (pt.time) lines.push(`        <time>${new Date(pt.time).toISOString()}</time>`);
        lines.push('      </trkpt>');
      }
      lines.push('    </trkseg>');
      lines.push('  </trk>');
    }

    lines.push('</gpx>');
    return lines.join('\n');
  }

  function buildKML(track) {
    const coords = (track.points || [])
      .map((p) => `${p.lon},${p.lat},${p.ele != null ? Math.round(p.ele) : 0}`)
      .join(' ');
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<kml xmlns="http://www.opengis.net/kml/2.2">',
      '  <Document>',
      `    <name>${escapeXml(track.name || 'Percurso')}</name>`,
      '    <Placemark>',
      `      <name>${escapeXml(track.name || 'Percurso')}</name>`,
      '      <Style><LineStyle><color>ff81b910</color><width>4</width></LineStyle></Style>',
      '      <LineString><tessellate>1</tessellate><coordinates>',
      `        ${coords}`,
      '      </coordinates></LineString>',
      '    </Placemark>',
      '  </Document>',
      '</kml>'
    ].join('\n');
  }

  /**
   * Renderiza perfil de elevação em SVG responsivo.
   */
  function renderElevationSVG(points, width = 340, height = 130) {
    const valid = (points || []).filter((p) => p.ele != null && !isNaN(p.ele));
    if (valid.length < 2) {
      return '<div style="text-align:center;padding:24px;color:#94a3b8;font-size:13px;">Sem dados de altitude suficientes neste percurso.</div>';
    }

    let totalDist = 0;
    const samples = [{ d: 0, ele: valid[0].ele }];
    for (let i = 1; i < valid.length; i++) {
      totalDist += haversineMeters(valid[i - 1].lat, valid[i - 1].lon, valid[i].lat, valid[i].lon);
      samples.push({ d: totalDist, ele: valid[i].ele });
    }

    const eles = samples.map((s) => s.ele);
    const minE = Math.min(...eles);
    const maxE = Math.max(...eles);
    const spanE = Math.max(10, maxE - minE);
    const padL = 36, padR = 10, padT = 14, padB = 22;
    const w = width - padL - padR;
    const h = height - padT - padB;
    const maxD = Math.max(1, totalDist);

    const pts = samples.map((s) => {
      const x = padL + (s.d / maxD) * w;
      const y = padT + h - ((s.ele - minE) / spanE) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const areaPts = `${padL},${padT + h} ${pts.join(' ')} ${(padL + w).toFixed(1)},${padT + h}`;

    return `
      <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;display:block;background:#0f172a;border-radius:10px;">
        <defs>
          <linearGradient id="eleGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#10b981" stop-opacity="0.55"/>
            <stop offset="100%" stop-color="#10b981" stop-opacity="0.05"/>
          </linearGradient>
        </defs>
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + h}" stroke="#334155" stroke-width="1"/>
        <line x1="${padL}" y1="${padT + h}" x2="${padL + w}" y2="${padT + h}" stroke="#334155" stroke-width="1"/>
        <polygon points="${areaPts}" fill="url(#eleGrad)"/>
        <polyline points="${pts.join(' ')}" fill="none" stroke="#10b981" stroke-width="2.2" stroke-linejoin="round"/>
        <text x="4" y="${padT + 8}" fill="#94a3b8" font-size="10">${Math.round(maxE)}m</text>
        <text x="4" y="${padT + h}" fill="#94a3b8" font-size="10">${Math.round(minE)}m</text>
        <text x="${padL}" y="${height - 5}" fill="#94a3b8" font-size="10">0</text>
        <text x="${padL + w}" y="${height - 5}" fill="#94a3b8" font-size="10" text-anchor="end">${formatDistance(totalDist)}</text>
      </svg>
    `;
  }

  global.GeoUtils = {
    haversineMeters,
    bearingDegrees,
    cardinalPT,
    formatDuration,
    formatDistance,
    formatCoords,
    toUTM,
    calcSunTimes,
    buildGPX,
    buildKML,
    renderElevationSVG
  };
})(window);
