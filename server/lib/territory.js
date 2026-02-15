/**
 * Territory Engine: Loop-only capture (Paper.io style), 50m grid, Web Mercator.
 * Territory is claimed ONLY when an activity forms a closed loop (first–last point ≤ LOOP_CLOSE_METERS).
 * Used by POST /api/strava/sync, POST /api/strava/resync, and GET /api/territory.
 */

const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

const CELL_SIZE_METERS = 50;
const LOOP_CLOSE_METERS = 100;
const COOLDOWN_HOURS = 12;

/** Max candidate cells for one loop (bbox span) to avoid runaway; still process but log warn if exceeded */
const MAX_LOOP_CELLS_WARN = 50000;

// Web Mercator (EPSG:3857) — meters at equator scale
const HALF_EARTH = 20037508.3439;

export function lngLatToMercator(lng, lat) {
  const x = (lng * HALF_EARTH) / 180;
  const y = Math.log(Math.tan((90 + lat) * (Math.PI / 360))) * (HALF_EARTH / Math.PI);
  return { x, y };
}

export function getCellId(cellX, cellY) {
  return `${cellX}:${cellY}`;
}

export function mercatorToCell(x, y) {
  const cellX = Math.floor(x / CELL_SIZE_METERS);
  const cellY = Math.floor(y / CELL_SIZE_METERS);
  return { cellX, cellY };
}

/** Distance between two points in Web Mercator meters */
function distanceMeters(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Decode Google/Strava polyline to [lat, lng] pairs.
 */
function decodePolyline(encoded) {
  if (!encoded || typeof encoded !== 'string') return [];
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
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
 * Convert [[lat,lng],...] to [lng,lat] and then to mercator {x,y}.
 */
function pointsToMercator(pointsLatLng) {
  return pointsLatLng.map(([lat, lng]) => {
    const m = lngLatToMercator(lng, lat);
    return { lng, lat, ...m };
  });
}

/**
 * Clean polygon: remove consecutive duplicates, ensure closed (append first at end).
 * Returns array of [lng, lat] or null if invalid (< 4 points after cleaning).
 */
/** pointsLatLng: [[lat, lng], ...] from decodePolyline. Returns [[lng, lat], ...] or null. */
function cleanPolygonPoints(pointsLatLng) {
  if (!pointsLatLng || pointsLatLng.length < 3) return null;
  const out = [];
  let last = null;
  for (const p of pointsLatLng) {
    const lat = p[0];
    const lng = p[1];
    if (last != null && last[0] === lng && last[1] === lat) continue;
    last = [lng, lat];
    out.push(last);
  }
  if (out.length < 3) return null;
  const first = out[0];
  const lastPt = out[out.length - 1];
  if (first[0] !== lastPt[0] || first[1] !== lastPt[1]) {
    out.push([first[0], first[1]]);
  }
  return out.length >= 4 ? out : null;
}

/**
 * Point-in-polygon (ray casting) in Mercator. Polygon is array of {x, y}.
 */
function pointInPolygon(px, py, polygon) {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * From activity polyline: if closed loop (first–last ≤ LOOP_CLOSE_METERS), return set of cells inside the polygon.
 * Otherwise return empty set.
 * Returns Array<{ cellId, cellX, cellY }> (deduplicated).
 */
function polygonToCells(pointsLatLng, polygonLngLat) {
  if (!polygonLngLat || polygonLngLat.length < 4) return [];
  // polygonLngLat is [[lng, lat], ...]; pointsToMercator expects [[lat, lng], ...]
  const mercator = pointsToMercator(polygonLngLat.map(([lng, lat]) => [lat, lng]));
  const first = mercator[0];
  const last = mercator[mercator.length - 1];
  if (distanceMeters(first, last) > LOOP_CLOSE_METERS) return [];
  const polygon = mercator.map((p) => ({ x: p.x, y: p.y }));

  let minX = first.x, maxX = first.x, minY = first.y, maxY = first.y;
  for (let i = 1; i < polygon.length; i++) {
    const p = polygon[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const cellXMin = Math.floor(minX / CELL_SIZE_METERS);
  const cellXMax = Math.floor(maxX / CELL_SIZE_METERS);
  const cellYMin = Math.floor(minY / CELL_SIZE_METERS);
  const cellYMax = Math.floor(maxY / CELL_SIZE_METERS);

  const totalCandidates = (cellXMax - cellXMin + 1) * (cellYMax - cellYMin + 1);
  if (totalCandidates > MAX_LOOP_CELLS_WARN && DEBUG) {
    console.log('[territory] polygonToCells: large loop', totalCandidates, 'candidate cells');
  }

  const seen = new Set();
  const cells = [];
  for (let cellX = cellXMin; cellX <= cellXMax; cellX++) {
    for (let cellY = cellYMin; cellY <= cellYMax; cellY++) {
      const centerX = (cellX + 0.5) * CELL_SIZE_METERS;
      const centerY = (cellY + 0.5) * CELL_SIZE_METERS;
      if (!pointInPolygon(centerX, centerY, polygon)) continue;
      const cellId = getCellId(cellX, cellY);
      if (seen.has(cellId)) continue;
      seen.add(cellId);
      cells.push({ cellId, cellX, cellY });
    }
  }
  return cells;
}

/**
 * Apply loop-only territory claims for one activity.
 * Returns { gainedCellIds, lostCellIds, defendedCellIds, cellsCreated, claimsCreated }.
 */
export async function applyLoopClaims(prisma, userId, activity) {
  const gainedCellIds = [];
  const lostCellIds = [];
  const defendedCellIds = [];
  /** previousOwnerId -> { cellIds: string[], cellCoords: { cellX, cellY }[] } for conquest notifications */
  const lostByPreviousOwner = new Map();
  let cellsCreated = 0;
  let claimsCreated = 0;

  const polyline = activity.summaryPolyline;
  if (!polyline || typeof polyline !== 'string') {
    if (DEBUG) console.log('[territory] applyLoopClaims: no polyline for activity', activity.id);
    return { gainedCellIds, lostCellIds, defendedCellIds, cellsCreated, claimsCreated };
  }

  const pointsLatLng = decodePolyline(polyline);
  const polygonLngLat = cleanPolygonPoints(pointsLatLng);
  if (!polygonLngLat) {
    if (DEBUG) console.log('[territory] applyLoopClaims: not a valid polygon (clean)', activity.id);
    return { gainedCellIds, lostCellIds, defendedCellIds, cellsCreated, claimsCreated };
  }

  const pointsMercator = pointsToMercator(pointsLatLng);
  const first = pointsMercator[0];
  const last = pointsMercator[pointsMercator.length - 1];
  if (distanceMeters(first, last) > LOOP_CLOSE_METERS) {
    if (DEBUG) console.log('[territory] applyLoopClaims: not a closed loop (first–last > ', LOOP_CLOSE_METERS, 'm)', activity.id);
    return { gainedCellIds, lostCellIds, defendedCellIds, cellsCreated, claimsCreated };
  }

  const cells = polygonToCells(pointsLatLng, polygonLngLat);
  if (DEBUG) console.log('[territory] applyLoopClaims: loop cells', cells.length, 'activity', activity.id);

  let loopPolygonGeojson = null;
  if (cells.length > 0) {
    const ring = polygonLngLat.map(([lng, lat]) => [lng, lat]);
    loopPolygonGeojson = { type: 'Polygon', coordinates: [ring] };
    const lngs = ring.map((c) => c[0]);
    const lats = ring.map((c) => c[1]);
    const loopMinLng = Math.min(...lngs);
    const loopMinLat = Math.min(...lats);
    const loopMaxLng = Math.max(...lngs);
    const loopMaxLat = Math.max(...lats);
    await prisma.activity.update({
      where: { id: activity.id },
      data: {
        loopPolygonGeojson,
        loopMinLng,
        loopMinLat,
        loopMaxLng,
        loopMaxLat,
      },
    });
  }

  const now = new Date();
  const lockedUntilNew = new Date(now.getTime() + COOLDOWN_HOURS * 60 * 60 * 1000);

  for (const { cellId, cellX, cellY } of cells) {
    const existing = await prisma.territoryCell.findUnique({ where: { cellId } });

    if (!existing) {
      await prisma.territoryCell.create({
        data: {
          cellId,
          cellX,
          cellY,
          ownerUserId: userId,
          lockedUntil: lockedUntilNew,
          lastClaimedAt: now,
          lastActivityId: activity.id,
        },
      });
      cellsCreated++;
      await prisma.territoryClaim.create({
        data: {
          cellId,
          cellX,
          cellY,
          claimerUserId: userId,
          previousOwnerUserId: null,
          activityId: activity.id,
          reason: 'LOOP_CAPTURE',
        },
      });
      claimsCreated++;
      gainedCellIds.push(cellId);
      continue;
    }

    if (existing.ownerUserId === userId) {
      await prisma.territoryCell.update({
        where: { cellId },
        data: {
          lockedUntil: lockedUntilNew,
          lastClaimedAt: now,
          lastActivityId: activity.id,
        },
      });
      await prisma.territoryClaim.create({
        data: {
          cellId,
          cellX,
          cellY,
          claimerUserId: userId,
          previousOwnerUserId: userId,
          activityId: activity.id,
          reason: 'LOOP_DEFEND_REFRESH',
        },
      });
      claimsCreated++;
      defendedCellIds.push(cellId);
      continue;
    }

    if (existing.lockedUntil > now) continue;

    const previousOwnerId = existing.ownerUserId;
    await prisma.territoryCell.update({
      where: { cellId },
      data: {
        ownerUserId: userId,
        lockedUntil: lockedUntilNew,
        lastClaimedAt: now,
        lastActivityId: activity.id,
      },
    });
    await prisma.territoryClaim.create({
      data: {
        cellId,
        cellX,
        cellY,
        claimerUserId: userId,
        previousOwnerUserId: previousOwnerId,
        activityId: activity.id,
        reason: 'LOOP_CAPTURE',
      },
    });
    claimsCreated++;
    gainedCellIds.push(cellId);
    lostCellIds.push(cellId);
    let entry = lostByPreviousOwner.get(previousOwnerId);
    if (!entry) {
      entry = { cellIds: [], cellCoords: [] };
      lostByPreviousOwner.set(previousOwnerId, entry);
    }
    entry.cellIds.push(cellId);
    entry.cellCoords.push({ cellX, cellY });
  }

  if (lostByPreviousOwner.size > 0) {
    const claimer = await prisma.user.findUnique({ where: { id: userId }, select: { nickname: true } });
    for (const [previousOwnerId, { cellIds: lostCellIdsForOwner, cellCoords }] of lostByPreviousOwner) {
      const countLost = lostCellIdsForOwner.length;
      const cellIdsMeta = lostCellIdsForOwner.slice(0, 100);

      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      let sumLng = 0, sumLat = 0;
      for (const { cellX, cellY } of cellCoords) {
        const cx = cellX * CELL_SIZE_METERS + CELL_SIZE_METERS / 2;
        const cy = cellY * CELL_SIZE_METERS + CELL_SIZE_METERS / 2;
        const { lng, lat } = mercatorToLngLat(cx, cy);
        minLng = Math.min(minLng, lng); minLat = Math.min(minLat, lat);
        maxLng = Math.max(maxLng, lng); maxLat = Math.max(maxLat, lat);
        sumLng += lng; sumLat += lat;
      }
      const bbox = cellCoords.length > 0
        ? { minLng, minLat, maxLng, maxLat }
        : null;
      const centroid = cellCoords.length > 0
        ? { lng: sumLng / cellCoords.length, lat: sumLat / cellCoords.length }
        : null;

      const isFriend = await prisma.friendship.findFirst({
        where: {
          OR: [
            { userId: previousOwnerId, friendId: userId },
            { userId, friendId: previousOwnerId },
          ],
        },
      });
      const attackerNickname = isFriend && claimer?.nickname ? claimer.nickname : null;
      const body = attackerNickname
        ? `${attackerNickname} conquered part of your territory.`
        : 'Some of your land was taken while you were away.';

      await prisma.notification.create({
        data: {
          userId: previousOwnerId,
          type: 'TERRITORY_CONQUERED',
          title: 'Your territory was conquered!',
          body,
          meta: {
            cellIds: cellIdsMeta,
            countLost,
            bbox,
            centroid,
            attackerUserId: userId,
            ...(attackerNickname && { attackerNickname }),
          },
        },
      });
    }
  }

  if (DEBUG) {
    console.log('[territory] applyLoopClaims done:', { cellsCreated, claimsCreated, gained: gainedCellIds.length, lost: lostCellIds.length, defended: defendedCellIds.length });
  }
  return { gainedCellIds, lostCellIds, defendedCellIds, cellsCreated, claimsCreated, loopPolygonGeojson };
}

/**
 * Convert bbox [minLng, minLat, maxLng, maxLat] to cell range (cellXMin, cellXMax, cellYMin, cellYMax) in Web Mercator.
 */
export function bboxToCellRange(minLng, minLat, maxLng, maxLat) {
  const sw = lngLatToMercator(minLng, minLat);
  const ne = lngLatToMercator(maxLng, maxLat);
  const cellXMin = Math.floor(Math.min(sw.x, ne.x) / CELL_SIZE_METERS);
  const cellXMax = Math.floor(Math.max(sw.x, ne.x) / CELL_SIZE_METERS);
  const cellYMin = Math.floor(Math.min(sw.y, ne.y) / CELL_SIZE_METERS);
  const cellYMax = Math.floor(Math.max(sw.y, ne.y) / CELL_SIZE_METERS);
  return { cellXMin, cellXMax, cellYMin, cellYMax };
}

export function getCellSize() {
  return CELL_SIZE_METERS;
}

/** Mercator (x,y) back to lng,lat (degrees). */
export function mercatorToLngLat(x, y) {
  const lng = (x * 180) / HALF_EARTH;
  const lat = (360 / Math.PI) * Math.atan(Math.exp((y * Math.PI) / HALF_EARTH)) - 90;
  return { lng, lat };
}

/** Get GeoJSON polygon coordinates for a cell (50m × 50m in Mercator). */
export function cellToGeoJSONRing(cellX, cellY) {
  const x0 = cellX * CELL_SIZE_METERS;
  const y0 = cellY * CELL_SIZE_METERS;
  const x1 = (cellX + 1) * CELL_SIZE_METERS;
  const y1 = (cellY + 1) * CELL_SIZE_METERS;
  const sw = mercatorToLngLat(x0, y0);
  const se = mercatorToLngLat(x1, y0);
  const ne = mercatorToLngLat(x1, y1);
  const nw = mercatorToLngLat(x0, y1);
  return [
    [sw.lng, sw.lat],
    [se.lng, se.lat],
    [ne.lng, ne.lat],
    [nw.lng, nw.lat],
    [sw.lng, sw.lat],
  ];
}
