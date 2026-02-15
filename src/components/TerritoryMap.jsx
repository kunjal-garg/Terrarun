import React, { useRef, useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  getMapTilerKey,
  makeFeatureCollections,
  computeBounds,
  formatDistanceKm,
  formatAreaKm2,
} from '../utils/geo.js';

const DEFAULT_CENTER = [-122.4194, 37.7749];
const DEFAULT_ZOOM = 12;

const TERRITORY_PALETTE = [
  '#00ff88', // me (index 0 reserved; we use 'me' key)
  '#3366ff',
  '#ffaa00',
  '#9933ff',
  '#ff3366',
  '#00ccff',
  '#ff66aa',
  '#66ff99',
];
const COLOR_ME = '#00ff88';
const COLOR_OTHER = '#ff3366';
const COLOR_ME_BRIGHT = '#00ffaa';
const COLOR_OTHER_BRIGHT = '#ff5588';

function loopsToGeoJSON(loops) {
  const features = (loops || [])
    .filter((l) => l?.polygonGeojson?.coordinates)
    .map((l, i) => ({
      type: 'Feature',
      id: l.id || `loop-${i}`,
      geometry: l.polygonGeojson,
      properties: {
        id: l.id,
        colorKey: l.colorKey || 'other',
        ownerType: l.ownerType || 'other',
        friendNickname: l.friendNickname ?? undefined,
      },
    }));
  return { type: 'FeatureCollection', features };
}

function polygonFeaturesToGeoJSON(items) {
  const features = (items || [])
    .filter((item) => item?.polygonGeojson?.coordinates)
    .map((item, i) => ({
      type: 'Feature',
      id: item.activityId || `flash-${i}`,
      geometry: item.polygonGeojson,
      properties: {},
    }));
  return { type: 'FeatureCollection', features };
}

/**
 * TerritoryMap: MapLibre map with routes (LineString) and territory loop polygons.
 * Run + Game mode: loops from props (Run = me.activities with loopPolygonGeojson; Game = GET /api/territory/loops).
 * Polygon fill + glowing outline; flash gained/lost polygons after sync.
 */
const DEBOUNCE_MS = 250;

export default function TerritoryMap({
  routes = [],
  territories = [],
  loops = [],
  selectedUserId = null,
  onSelectUser,
  gameMode = 'run',
  territoryView = 'everyone',
  apiBase = '',
  flashGainedPolygons = [],
  flashLostPolygons = [],
  territoryRefreshTrigger = 0,
  onLoopsLoaded,
  conquestViewTarget = null,
  onConquestAnimationDone,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const lastBoundsKeyRef = useRef(null);
  const latestRoutesRef = useRef(routes);
  const latestTerritoriesRef = useRef(territories);
  const latestLoopsRef = useRef(loops);
  const onSelectUserRef = useRef(onSelectUser);
  const gameModeRef = useRef(gameMode);
  const apiBaseRef = useRef(apiBase);
  const territoryViewRef = useRef(territoryView);
  const onLoopsLoadedRef = useRef(onLoopsLoaded);
  const onConquestAnimationDoneRef = useRef(onConquestAnimationDone);
  const territoryDebounceRef = useRef(null);
  gameModeRef.current = gameMode;
  apiBaseRef.current = apiBase;
  territoryViewRef.current = territoryView;
  latestRoutesRef.current = routes;
  latestTerritoriesRef.current = territories;
  latestLoopsRef.current = loops;
  onSelectUserRef.current = onSelectUser;
  onLoopsLoadedRef.current = onLoopsLoaded;
  onConquestAnimationDoneRef.current = onConquestAnimationDone;

  const fetchLoops = useRef(() => {});
  fetchLoops.current = () => {
    const map = mapRef.current;
    if (!map?.getBounds || !apiBase) return;
    if (gameModeRef.current !== 'game') return;
    const b = map.getBounds();
    const bbox = `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`;
    fetch(`${apiBaseRef.current}/api/territory/loops?bbox=${encodeURIComponent(bbox)}&view=${territoryViewRef.current}`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : { loops: [] }))
      .then((data) => {
        const loopList = data.loops || [];
        const src = map.getSource('territory-loops');
        if (src) src.setData(loopsToGeoJSON(loopList));
        if (typeof onLoopsLoadedRef.current === 'function') {
          onLoopsLoadedRef.current(loopList);
        }
      })
      .catch(() => {
        if (typeof onLoopsLoadedRef.current === 'function') {
          onLoopsLoadedRef.current([]);
        }
      });
  };

  // Init map once (refs only; no recreate on re-render)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let key;
    try {
      key = getMapTilerKey();
    } catch (e) {
      console.error(e.message);
      return;
    }

    const styleUrl = `https://api.maptiler.com/maps/streets/style.json?key=${key}`;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });

    // MapTiler (and other styles) sometimes reference sprite images that aren't in the sheet (e.g. office_11).
    // Provide a 1x1 transparent pixel so the style can render and we avoid "Image could not be loaded" warnings.
    map.on('styleimagemissing', (e) => {
      const id = e.id;
      if (map.hasImage(id)) return;
      const size = 1;
      map.addImage(id, {
        width: size,
        height: size,
        data: new Uint8ClampedArray(size * size * 4),
      });
    });

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'territory-map-popup',
    });
    popupRef.current = popup;

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    const layerIds = ['routes-line', 'territories-fill', 'territories-outline'];

    map.on('load', () => {
      // Sources
      map.addSource('routes', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addSource('territories', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Base layers
      map.addLayer({
        id: 'routes-line',
        type: 'line',
        source: 'routes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 3,
          'line-opacity': 0.85,
        },
      });
      map.addLayer({
        id: 'territories-fill',
        type: 'fill',
        source: 'territories',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.25,
          'fill-outline-color': ['get', 'color'],
        },
      });
      map.addLayer({
        id: 'territories-outline',
        type: 'line',
        source: 'territories',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-opacity': 0.8,
        },
      });

      // Highlight layers (on top, filtered by selectedUserId)
      map.addLayer({
        id: 'routes-line-selected',
        type: 'line',
        source: 'routes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 6,
          'line-opacity': 1,
        },
        filter: ['==', ['get', 'userId'], ''],
      });
      map.addLayer({
        id: 'territories-fill-selected',
        type: 'fill',
        source: 'territories',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.5,
          'fill-outline-color': ['get', 'color'],
        },
        filter: ['==', ['get', 'userId'], ''],
      });
      map.addLayer({
        id: 'territories-outline-selected',
        type: 'line',
        source: 'territories',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 4,
          'line-opacity': 1,
        },
        filter: ['==', ['get', 'userId'], ''],
      });

      // Territory loops (Run + Game): polygon fill + glowing outline (no grid cells)
      map.addSource('territory-loops', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      const colorKeyStops = [
        ['me', COLOR_ME],
        ['other', COLOR_OTHER],
        ...TERRITORY_PALETTE.slice(1).map((c, i) => [`friend-${i}`, c]),
      ];
      const colorKeyStopsBright = [
        ['me', COLOR_ME_BRIGHT],
        ['other', COLOR_OTHER_BRIGHT],
        ...TERRITORY_PALETTE.slice(1).map((c, i) => [`friend-${i}`, c]),
      ];
      map.addLayer({
        id: 'territory-loops-fill',
        type: 'fill',
        source: 'territory-loops',
        paint: {
          'fill-color': ['match', ['get', 'colorKey'], ...colorKeyStops.flat(), COLOR_OTHER],
          'fill-opacity': 0.3,
        },
      });
      map.addLayer({
        id: 'territory-loops-halo',
        type: 'line',
        source: 'territory-loops',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['match', ['get', 'colorKey'], ...colorKeyStops.flat(), COLOR_OTHER],
          'line-width': 7,
          'line-blur': 5,
          'line-opacity': 0.2,
        },
      });
      map.addLayer({
        id: 'territory-loops-outline',
        type: 'line',
        source: 'territory-loops',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['match', ['get', 'colorKey'], ...colorKeyStopsBright.flat(), COLOR_OTHER_BRIGHT],
          'line-width': 3.5,
          'line-blur': 1.5,
          'line-opacity': 0.95,
        },
      });
      map.addSource('flash-gained-polygons', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'flash-gained-polygons-fill',
        type: 'fill',
        source: 'flash-gained-polygons',
        paint: { 'fill-color': COLOR_ME, 'fill-opacity': 0.4 },
      });
      map.addLayer({
        id: 'flash-gained-polygons-outline',
        type: 'line',
        source: 'flash-gained-polygons',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': COLOR_ME_BRIGHT,
          'line-width': 4,
          'line-blur': 2,
          'line-opacity': 1,
        },
      });
      map.addSource('flash-lost-polygons', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'flash-lost-polygons-fill',
        type: 'fill',
        source: 'flash-lost-polygons',
        paint: { 'fill-color': COLOR_OTHER, 'fill-opacity': 0.4 },
      });
      map.addLayer({
        id: 'flash-lost-polygons-outline',
        type: 'line',
        source: 'flash-lost-polygons',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': COLOR_OTHER_BRIGHT,
          'line-width': 4,
          'line-blur': 2,
          'line-opacity': 1,
        },
      });

      if (gameModeRef.current === 'game') fetchLoops.current();
      const debouncedFetch = () => {
        if (territoryDebounceRef.current) clearTimeout(territoryDebounceRef.current);
        territoryDebounceRef.current = setTimeout(() => {
          territoryDebounceRef.current = null;
          fetchLoops.current();
        }, DEBOUNCE_MS);
      };
      map.on('moveend', debouncedFetch);
      map.on('zoomend', debouncedFetch);

      // Initial data and fitBounds
      const r = latestRoutesRef.current;
      const t = latestTerritoriesRef.current;
      const loopsInit = latestLoopsRef.current;
      const { routes: routesFc, territories: territoriesFc } = makeFeatureCollections(r, t);
      map.getSource('routes').setData(routesFc);
      map.getSource('territories').setData(territoriesFc);
      map.getSource('territory-loops').setData(loopsToGeoJSON(loopsInit));
      const bounds = computeBounds(r, t);
      if (bounds && bounds.length >= 4) {
        map.fitBounds(bounds, { padding: 40, duration: 0 });
        lastBoundsKeyRef.current = JSON.stringify({ r: r.length, t: t.length });
      }

      // Hover popup and click selection
      const showPopup = (e) => {
        const f = e.features?.[0];
        if (!f?.properties) return;
        const { userId, userName, distanceMeters, areaMeters2 } = f.properties;
        const parts = [userName || userId];
        if (distanceMeters != null) parts.push(`Distance: ${formatDistanceKm(distanceMeters)}`);
        if (areaMeters2 != null) parts.push(`Area: ${formatAreaKm2(areaMeters2)}`);
        popup.setLngLat(e.lngLat).setHTML(parts.join('<br/>')).addTo(map);
        map.getCanvas().style.cursor = 'pointer';
      };
      const hidePopup = () => {
        popup.remove();
        map.getCanvas().style.cursor = '';
      };
      const onClick = (e) => {
        const f = e.features?.[0];
        if (!f?.properties?.userId) return;
        if (typeof onSelectUserRef.current === 'function') onSelectUserRef.current(f.properties.userId);
      };
      layerIds.forEach((lid) => {
        map.on('mousemove', lid, showPopup);
        map.on('mouseleave', lid, hidePopup);
        map.on('click', lid, onClick);
      });
    });

    mapRef.current = map;

    return () => {
      popupRef.current = null;
      popup.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update GeoJSON and fitBounds when routes/territories change; update loops when loops prop changes
  useEffect(() => {
    const map = mapRef.current;
    const rs = map?.getSource?.('routes');
    if (!rs) return;

    const { routes: routesFc, territories: territoriesFc } = makeFeatureCollections(routes, territories);
    map.getSource('routes').setData(routesFc);
    map.getSource('territories').setData(territoriesFc);
    const srcLoops = map.getSource('territory-loops');
    if (srcLoops) srcLoops.setData(loopsToGeoJSON(loops));

    const key = JSON.stringify({ r: routes.length, t: territories.length });
    if (lastBoundsKeyRef.current !== key) {
      lastBoundsKeyRef.current = key;
      const bounds = computeBounds(routes, territories);
      if (bounds && bounds.length >= 4) map.fitBounds(bounds, { padding: 40, duration: 0 });
    }
  }, [routes, territories, loops]);

  // Update selection filter when selectedUserId changes; fitBounds to selected route when present
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer) return;

    const id = selectedUserId ?? '';
    const filter = ['==', ['get', 'userId'], id];

    ['routes-line-selected', 'territories-fill-selected', 'territories-outline-selected'].forEach(
      (layerId) => {
        if (map.getLayer(layerId)) map.setFilter(layerId, filter);
      }
    );

    if (id && routes.length > 0) {
      const route = routes.find((r) => String(r.userId) === String(id));
      if (route?.coordinates?.length >= 2) {
        const lngs = route.coordinates.map((c) => c[0]);
        const lats = route.coordinates.map((c) => c[1]);
        const bounds = [
          Math.min(...lngs),
          Math.min(...lats),
          Math.max(...lngs),
          Math.max(...lats),
        ];
        map.fitBounds(bounds, { padding: 60, duration: 800, maxZoom: 14 });
      }
    }
  }, [selectedUserId, routes]);

  // Game mode: fetch loops when mode, view, or refresh trigger changes
  useEffect(() => {
    if (gameMode === 'game') fetchLoops.current();
  }, [gameMode, territoryView, apiBase, territoryRefreshTrigger]);

  // Flash gained/lost polygons: sync returns territoryChanges.gainedPolygons
  useEffect(() => {
    const map = mapRef.current;
    const srcG = map?.getSource?.('flash-gained-polygons');
    const srcL = map?.getSource?.('flash-lost-polygons');
    if (!srcG || !srcL) return;
    srcG.setData(polygonFeaturesToGeoJSON(flashGainedPolygons));
    srcL.setData(polygonFeaturesToGeoJSON(flashLostPolygons));
  }, [flashGainedPolygons, flashLostPolygons]);

  // Conquest view: fit map to attacked region, pulse overlay + emoji, then mark read
  useEffect(() => {
    if (!conquestViewTarget?.notificationId) {
      return () => {};
    }
    const { bbox, centroid, notificationId } = conquestViewTarget;
    const hasGeometry = (bbox && typeof bbox.minLng === 'number') || (centroid && typeof centroid.lng === 'number');
    if (!hasGeometry) {
      if (typeof onConquestAnimationDoneRef.current === 'function') onConquestAnimationDoneRef.current(notificationId);
      return () => {};
    }
    const map = mapRef.current;
    if (!map?.getSource) {
      if (typeof onConquestAnimationDoneRef.current === 'function') onConquestAnimationDoneRef.current(notificationId);
      return () => {};
    }

    const cleanupFns = [];
    const cleanup = () => {
      cleanupFns.forEach((fn) => { try { fn(); } catch (_) {} });
    };

    const run = () => {
      const pad = 80;
      if (bbox && typeof bbox.minLng === 'number' && typeof bbox.maxLng === 'number') {
        map.fitBounds(
          [[bbox.minLng, bbox.minLat], [bbox.maxLng, bbox.maxLat]],
          { padding: pad, duration: 800, maxZoom: 15 }
        );
      } else if (centroid && typeof centroid.lng === 'number' && typeof centroid.lat === 'number') {
        map.flyTo({ center: [centroid.lng, centroid.lat], zoom: 14, duration: 800 });
      }

      const ring = bbox && typeof bbox.minLng === 'number'
        ? [
            [bbox.minLng, bbox.minLat],
            [bbox.maxLng, bbox.minLat],
            [bbox.maxLng, bbox.maxLat],
            [bbox.minLng, bbox.maxLat],
            [bbox.minLng, bbox.minLat],
          ]
        : (centroid && typeof centroid.lng === 'number'
          ? (() => {
              const d = 0.001;
              return [[centroid.lng - d, centroid.lat - d], [centroid.lng + d, centroid.lat - d], [centroid.lng + d, centroid.lat + d], [centroid.lng - d, centroid.lat + d], [centroid.lng - d, centroid.lat - d]];
            })()
          : null);

      if (ring) {
        const geojson = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} };
        if (!map.getSource('conquest-overlay')) {
          map.addSource('conquest-overlay', { type: 'geojson', data: geojson });
        } else {
          map.getSource('conquest-overlay').setData(geojson);
        }
        if (!map.getLayer('conquest-overlay-fill')) {
          map.addLayer({
            id: 'conquest-overlay-fill',
            type: 'fill',
            source: 'conquest-overlay',
            paint: { 'fill-color': '#ff3366', 'fill-opacity': 0.45 },
          });
        }
        if (!map.getLayer('conquest-overlay-halo')) {
          map.addLayer({
            id: 'conquest-overlay-halo',
            type: 'line',
            source: 'conquest-overlay',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#ff3366', 'line-width': 8, 'line-blur': 4, 'line-opacity': 0.25 },
          });
        }
        if (!map.getLayer('conquest-overlay-line')) {
          map.addLayer({
            id: 'conquest-overlay-line',
            type: 'line',
            source: 'conquest-overlay',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#ff5588', 'line-width': 3.5, 'line-blur': 1.5, 'line-opacity': 0.95 },
          });
        }
      }

      let markerEl = null;
      let marker = null;
      if (centroid && typeof centroid.lng === 'number') {
        markerEl = document.createElement('div');
        markerEl.className = 'territory-map-conquest-emoji';
        markerEl.textContent = '💥';
        markerEl.style.cssText = 'font-size: 42px; pointer-events: none; user-select: none; animation: territory-conquest-bounce 2.5s ease-out forwards;';
        marker = new maplibregl.Marker({ element: markerEl }).setLngLat([centroid.lng, centroid.lat]).addTo(map);
        cleanupFns.push(() => { if (marker) marker.remove(); });
      }

      const removeOverlay = () => {
        try {
          if (map.getLayer('conquest-overlay-line')) map.removeLayer('conquest-overlay-line');
          if (map.getLayer('conquest-overlay-halo')) map.removeLayer('conquest-overlay-halo');
          if (map.getLayer('conquest-overlay-fill')) map.removeLayer('conquest-overlay-fill');
          if (map.getSource('conquest-overlay')) map.removeSource('conquest-overlay');
        } catch (_) {}
      };
      cleanupFns.push(removeOverlay);

      const t1 = setTimeout(() => { if (marker) marker.remove(); }, 2500);
      const t2 = setTimeout(() => {
        removeOverlay();
        if (typeof onConquestAnimationDoneRef.current === 'function') onConquestAnimationDoneRef.current(notificationId);
      }, 7000);
      cleanupFns.push(() => { clearTimeout(t1); clearTimeout(t2); });
    };

    const t = setTimeout(run, 100);
    cleanupFns.push(() => clearTimeout(t));
    return () => cleanup();
  }, [conquestViewTarget]);

  return (
    <div
      ref={containerRef}
      className="territory-map-container"
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '20px',
        border: '3px solid rgba(0, 255, 136, 0.3)',
        boxShadow: '0 0 40px rgba(0, 255, 136, 0.2)',
        overflow: 'hidden',
      }}
    />
  );
}
