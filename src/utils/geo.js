/**
 * Geo helpers for TerritoryMap: MapTiler key, FeatureCollections, bounds, formatting.
 * Structured so you can later plug in Strava (convert polyline/stream to coordinates here).
 */

import bbox from '@turf/bbox';

/**
 * Get MapTiler API key from env. Checks in order:
 * - Vite: import.meta.env.VITE_MAPTILER_KEY
 * - CRA: process.env.REACT_APP_MAPTILER_KEY
 * - Next: process.env.NEXT_PUBLIC_MAPTILER_KEY
 * @returns {string}
 * @throws {Error} if no key is set
 */
export function getMapTilerKey() {
  const key =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAPTILER_KEY) ||
    (typeof process !== 'undefined' && process.env?.REACT_APP_MAPTILER_KEY) ||
    (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_MAPTILER_KEY);
  if (!key || typeof key !== 'string' || key.trim() === '') {
    throw new Error(
      'MapTiler API key is missing. Set one of: VITE_MAPTILER_KEY (Vite), REACT_APP_MAPTILER_KEY (CRA), or NEXT_PUBLIC_MAPTILER_KEY (Next.js) in your .env'
    );
  }
  return key.trim();
}

/**
 * Format meters to km string (e.g. "2.5 km" or "450 m").
 * @param {number} [meters]
 * @returns {string}
 */
export function formatDistanceKm(meters) {
  if (meters == null || Number.isNaN(meters)) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

/**
 * Format square meters to km² string (e.g. "0.12 km²").
 * @param {number} [meters2]
 * @returns {string}
 */
export function formatAreaKm2(meters2) {
  if (meters2 == null || Number.isNaN(meters2)) return '—';
  if (meters2 < 1e6) return `${Math.round(meters2).toLocaleString()} m²`;
  return `${(meters2 / 1e6).toFixed(2)} km²`;
}

/**
 * Build GeoJSON FeatureCollections for routes and territories.
 * Each feature has id = userId + "-route" | "-territory" and properties:
 * userId, userName, distanceMeters, areaMeters2 (where applicable), color.
 *
 * @param {Array<{ userId: string, userName: string, coordinates: Array<[lng, lat]>, distanceMeters?: number, color?: string }>} routes
 * @param {Array<{ userId: string, userName: string, polygon: Array<Array<[lng, lat]>>, areaMeters2?: number, color?: string }>} territories
 * @returns {{ routes: import('geojson').FeatureCollection, territories: import('geojson').FeatureCollection }}
 */
export function makeFeatureCollections(routes, territories) {
  const routeFeatures = (routes || []).map((r) => {
    const coords = r.coordinates && r.coordinates.length ? r.coordinates : [];
    const feature = {
      type: 'Feature',
      id: `${r.userId}-route`,
      geometry: {
        type: 'LineString',
        coordinates: coords,
      },
      properties: {
        userId: r.userId,
        userName: r.userName ?? '',
        distanceMeters: r.distanceMeters,
        color: r.color ?? null,
      },
    };
    return feature;
  });

  const territoryFeatures = (territories || []).map((t) => {
    const rings = t.polygon && t.polygon.length ? t.polygon : [];
    const feature = {
      type: 'Feature',
      id: `${t.userId}-territory`,
      geometry: {
        type: 'Polygon',
        coordinates: rings,
      },
      properties: {
        userId: t.userId,
        userName: t.userName ?? '',
        areaMeters2: t.areaMeters2,
        color: t.color ?? null,
      },
    };
    return feature;
  });

  return {
    routes: {
      type: 'FeatureCollection',
      features: routeFeatures,
    },
    territories: {
      type: 'FeatureCollection',
      features: territoryFeatures,
    },
  };
}

/**
 * Decode Google/Strava encoded polyline to [lat, lng] pairs.
 * @param {string} encoded
 * @returns {Array<[number, number]>} [[lat, lng], ...]
 */
export function decodePolyline(encoded) {
  if (!encoded || typeof encoded !== 'string') return [];
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let b;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : result >> 1;
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : result >> 1;
    lng += dlng;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/**
 * Decode polyline to GeoJSON LineString coordinates [[lng, lat], ...].
 * @param {string} encoded
 * @returns {Array<[number, number]>}
 */
export function decodePolylineToLngLat(encoded) {
  return decodePolyline(encoded).map(([lat, lng]) => [lng, lat]);
}

/**
 * Compute bounding box [minLng, minLat, maxLng, maxLat] from routes and territories.
 * Uses @turf/bbox when possible; otherwise manual from coordinates.
 * @param {Array<{ coordinates?: Array<[lng, lat]> }>} routes
 * @param {Array<{ polygon?: Array<Array<[lng, lat]>> }>} territories
 * @returns {[number, number, number, number] | null} bbox or null if no coords
 */
export function computeBounds(routes, territories) {
  const { routes: routesFc, territories: territoriesFc } = makeFeatureCollections(routes || [], territories || []);
  const allFeatures = [...routesFc.features, ...territoriesFc.features].filter(
    (f) => f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'Polygon')
  );
  if (allFeatures.length === 0) return null;
  try {
    const combined = { type: 'FeatureCollection', features: allFeatures };
    return bbox(combined);
  } catch (_) {
    return null;
  }
}
