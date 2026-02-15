import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Trophy, Activity, Navigation, Play, Check, X, Target, Zap, LogOut } from 'lucide-react';
import TerritoryMap from './src/components/TerritoryMap.jsx';
import StravaPanel from './src/components/StravaPanel.jsx';
import NotificationBell from './src/components/NotificationBell.jsx';
import FriendRequestsDropdown from './src/components/FriendRequestsDropdown.jsx';
import { decodePolylineToLngLat } from './src/utils/geo.js';
import { getApiBase } from './src/utils/api.js';

const API_BASE = getApiBase();

// Territory colors for different players
const PLAYER_COLORS = [
  { main: '#00ff88', glow: '#00ff8844', border: '#00ff88', name: 'Neon Green' },
  { main: '#ff3366', glow: '#ff336644', border: '#ff3366', name: 'Hot Pink' },
  { main: '#3366ff', glow: '#3366ff44', border: '#3366ff', name: 'Electric Blue' },
  { main: '#ffaa00', glow: '#ffaa0044', border: '#ffaa00', name: 'Bright Orange' },
  { main: '#9933ff', glow: '#9933ff44', border: '#9933ff', name: 'Purple' },
];

// Haversine formula to calculate distance between two lat/lng points in meters
const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
};

// Calculate area of a polygon using shoelace formula (returns square meters)
const calculateArea = (points) => {
  if (points.length < 3) return 0;
  
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].lng * points[j].lat;
    area -= points[j].lng * points[i].lat;
  }
  
  // Convert to square meters (approximate)
  const latToMeters = 111320;
  const avgLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const lngToMeters = 111320 * Math.cos(avgLat * Math.PI / 180);
  
  area = Math.abs(area / 2) * latToMeters * lngToMeters;
  return area;
};

// Check if a point is inside a polygon
const pointInPolygon = (point, polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    const intersect = ((yi > point.lat) !== (yj > point.lat)) &&
      (point.lng < (xj - xi) * (point.lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

function formatLastSync(isoString) {
  if (!isoString) return null;
  const d = new Date(isoString);
  const now = Date.now();
  const elapsedMs = now - d.getTime();
  if (elapsedMs < 60 * 1000) return 'Synced just now';
  if (elapsedMs < 60 * 60 * 1000) return `Last sync: ${Math.floor(elapsedMs / 60000)}m ago`;
  return `Last sync: ${Math.floor(elapsedMs / 3600000)}h ago`;
}

// Mock data for map (San Francisco area). Replace with real data / Strava later.
// Strava: decode polyline or use stream latlng → routes[].coordinates (Array<[lng, lat]>).
const MOCK_ROUTES = [
  {
    userId: 'alice',
    userName: 'Alice',
    coordinates: [
      [-122.425, 37.758],
      [-122.42, 37.758],
      [-122.42, 37.763],
      [-122.425, 37.763],
      [-122.425, 37.758],
    ],
    distanceMeters: 1420,
    color: '#00ff88',
  },
  {
    userId: 'bob',
    userName: 'Bob',
    coordinates: [
      [-122.44, 37.77],
      [-122.435, 37.77],
      [-122.435, 37.775],
      [-122.44, 37.775],
      [-122.44, 37.77],
    ],
    distanceMeters: 980,
    color: '#ff3366',
  },
  {
    userId: 'carol',
    userName: 'Carol',
    coordinates: [
      [-122.41, 37.78],
      [-122.405, 37.78],
      [-122.405, 37.785],
      [-122.41, 37.785],
      [-122.41, 37.78],
    ],
    distanceMeters: 1100,
    color: '#3366ff',
  },
];

export default function TerraRun() {
  const [territories, setTerritories] = useState([]);
  const [currentRun, setCurrentRun] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentPlayer, setCurrentPlayer] = useState(0);
  const [players, setPlayers] = useState([
    { id: 0, name: 'You', totalArea: 0, territories: 0, color: PLAYER_COLORS[0] },
    { id: 1, name: 'Runner 2', totalArea: 0, territories: 0, color: PLAYER_COLORS[1] },
    { id: 2, name: 'Runner 3', totalArea: 0, territories: 0, color: PLAYER_COLORS[2] },
  ]);
  const [showTutorial, setShowTutorial] = useState(true);
  const [captureAnimation, setCaptureAnimation] = useState(null);
  const [notification, setNotification] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [totalDistance, setTotalDistance] = useState(0);
  const [nickname, setNickname] = useState(() => {
    try {
      return sessionStorage.getItem('terrarun_nickname') || '';
    } catch (_) {
      return '';
    }
  });
  const [gameScope, setGameScope] = useState('global'); // 'global' | 'friends' — drives both leaderboard and map territory view in Game mode
  const [leaderboardMetric, setLeaderboardMetric] = useState('total'); // 'total' | 'recent'
  const [leaderboardRows, setLeaderboardRows] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [apiFriends, setApiFriends] = useState([]);
  const [addFriendInput, setAddFriendInput] = useState('');
  const [me, setMe] = useState(null);
  const [selectedActivityId, setSelectedActivityId] = useState(null);
  const [gameMode, setGameMode] = useState('run');
  const [flashGainedPolygons, setFlashGainedPolygons] = useState([]);
  const [flashLostPolygons, setFlashLostPolygons] = useState([]);
  const [gameLoops, setGameLoops] = useState([]);
  const [territoryRefreshTrigger, setTerritoryRefreshTrigger] = useState(0);
  const flashTimeoutRef = useRef(null);
  const [userBadges, setUserBadges] = useState([]);
  const [last3Badges, setLast3Badges] = useState([]);
  const [badgeDefinitions, setBadgeDefinitions] = useState([]);
  const [showAllBadgesModal, setShowAllBadgesModal] = useState(false);
  const [badgeUnlockModal, setBadgeUnlockModal] = useState(null);
  const [friendsBadges, setFriendsBadges] = useState([]);
  const [lastAutoSyncAt, setLastAutoSyncAt] = useState(null);
  const [autoSyncError, setAutoSyncError] = useState(null);
  const [runModeStats, setRunModeStats] = useState(null);
  const [conquestViewTarget, setConquestViewTarget] = useState(null);

  // Map territory view: in Game mode use gameScope (global -> everyone, friends -> friends); in Run mode irrelevant
  const territoryView = gameMode === 'game' ? (gameScope === 'global' ? 'everyone' : 'friends') : 'everyone';

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/me`, { credentials: 'include' });
      if (!res.ok) {
        setMe(null);
        return;
      }
      const data = await res.json();
      setMe(data);
      if (data.lastAutoSyncAt != null) setLastAutoSyncAt(data.lastAutoSyncAt);
      if (data.user?.nickname) {
        try {
          sessionStorage.setItem('terrarun_nickname', data.user.nickname);
        } catch (_) {}
      }
    } catch (_) {
      setMe(null);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const fetchRunModeStats = useCallback(async () => {
    if (!me?.user?.id) return;
    try {
      const res = await fetch(`${API_BASE}/api/stats`, { credentials: 'include' });
      if (!res.ok) {
        setRunModeStats(null);
        return;
      }
      const data = await res.json();
      setRunModeStats(data);
    } catch (_) {
      setRunModeStats(null);
    }
  }, [me?.user?.id]);

  // Auto-sync on app load when Strava linked (throttled by backend)
  useEffect(() => {
    if (!me?.stravaLinked) return;
    setAutoSyncError(null);
    fetch(`${API_BASE}/api/strava/auto-sync`, { method: 'POST', credentials: 'include' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = data.message || data.error || res.statusText || 'Auto-sync failed';
          setAutoSyncError(msg);
          return;
        }
        if (data.lastAutoSyncAt) setLastAutoSyncAt(data.lastAutoSyncAt);
        if (data.skipped === false) {
          fetchMe();
          fetchRunModeStats();
          setTerritoryRefreshTrigger((t) => t + 1);
          if (data.territoryChanges) {
            setFlashGainedPolygons(data.territoryChanges.gainedPolygons || []);
            setFlashLostPolygons(data.territoryChanges.lost || []);
            if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
            flashTimeoutRef.current = setTimeout(() => {
              setFlashGainedPolygons([]);
              setFlashLostPolygons([]);
            }, 45000);
          }
          const newBadges = data.newBadgesUnlocked ?? [];
          if (newBadges.length > 0) {
            const resBadges = await fetch(`${API_BASE}/api/badges`, { credentials: 'include' });
            if (resBadges.ok) {
              const badgeData = await resBadges.json();
              setUserBadges(badgeData.badges ?? []);
              setLast3Badges(badgeData.last3 ?? []);
              setBadgeDefinitions(badgeData.definitions ?? []);
            }
            const showSpecialModal = newBadges.some((b) => b.isSecret || (b.tiered && b.tier >= 3)) || newBadges.length === 1;
            if (showSpecialModal) {
              setBadgeUnlockModal(newBadges);
            } else {
              setNotification({
                message: newBadges.length === 1
                  ? `Badge unlocked: ${newBadges[0].icon} ${newBadges[0].name}${newBadges[0].tierLabel ? ` ${newBadges[0].tierLabel}` : ''}`
                  : `${newBadges.length} badges unlocked!`,
                type: 'success',
              });
              setTimeout(() => setNotification(null), 3500);
            }
          }
        }
      })
      .catch((e) => {
        setAutoSyncError(e?.message || 'Network error');
      });
  }, [me?.stravaLinked, fetchRunModeStats]);

  const fetchFriends = useCallback(async () => {
    if (!me?.user?.id) return;
    try {
      const res = await fetch(`${API_BASE}/api/friends`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setApiFriends(data.friends ?? []);
    } catch (_) {}
  }, [me?.user?.id]);

  useEffect(() => {
    if (!me?.user?.id) {
      setApiFriends([]);
      return;
    }
    fetchFriends();
  }, [me?.user?.id, fetchFriends]);

  // Fetch leaderboard when in Game mode and scope or metric changes
  useEffect(() => {
    if (gameMode !== 'game') {
      setLeaderboardRows([]);
      return;
    }
    let cancelled = false;
    setLeaderboardLoading(true);
    fetch(`${API_BASE}/api/leaderboard?scope=${gameScope}&metric=${leaderboardMetric}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((data) => {
        if (!cancelled) setLeaderboardRows(data.rows ?? []);
      })
      .catch(() => { if (!cancelled) setLeaderboardRows([]); })
      .finally(() => { if (!cancelled) setLeaderboardLoading(false); });
    return () => { cancelled = true; };
  }, [gameMode, gameScope, leaderboardMetric]);

  const fetchBadges = useCallback(async () => {
    if (!me?.user?.id) return;
    try {
      const res = await fetch(`${API_BASE}/api/badges`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setUserBadges(data.badges ?? []);
      setLast3Badges(data.last3 ?? []);
      setBadgeDefinitions(data.definitions ?? []);
    } catch (_) {}
  }, [me?.user?.id]);

  useEffect(() => {
    fetchBadges();
  }, [fetchBadges]);

  useEffect(() => {
    if (gameMode === 'run' && me?.user?.id) fetchRunModeStats();
  }, [gameMode, me?.user?.id, fetchRunModeStats]);

  const fetchFriendsBadges = useCallback(async () => {
    if (!me?.user?.id) return;
    try {
      const res = await fetch(`${API_BASE}/api/friends/badges`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setFriendsBadges(data.friends ?? []);
    } catch (_) {}
  }, [me?.user?.id]);

  useEffect(() => {
    if (gameScope === 'friends' && me?.user?.id) fetchFriendsBadges();
    else setFriendsBadges([]);
  }, [gameScope, me?.user?.id, fetchFriendsBadges]);

  useEffect(() => {
    const sync = () => {
      try {
        const fromStorage = sessionStorage.getItem('terrarun_nickname');
        if (fromStorage) setNickname(fromStorage);
        if (me?.user?.nickname) setNickname(me.user.nickname);
      } catch (_) {}
    };
    sync();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [me?.user?.nickname]);

  // Load data from storage (ensure we never set territories/players to non-arrays)
  useEffect(() => {
    const loadData = async () => {
      try {
        const territoriesData = await window.storage.get('territories');
        const playersData = await window.storage.get('players');
        if (territoriesData?.value != null) {
          const t = JSON.parse(territoriesData.value);
          if (Array.isArray(t)) setTerritories(t);
        }
        if (playersData?.value != null) {
          const p = JSON.parse(playersData.value);
          if (Array.isArray(p)) setPlayers(p);
        }
      } catch (error) {
        console.log('No saved data found');
      }
    };
    loadData();
  }, []);

  // Save data to storage
  useEffect(() => {
    if (territories.length > 0 || players.some(p => p.totalArea > 0)) {
      window.storage.set('territories', JSON.stringify(territories));
      window.storage.set('players', JSON.stringify(players));
    }
  }, [territories, players]);

  const handleSendFriendRequest = async () => {
    const value = addFriendInput.trim();
    if (!value) return;
    setAddFriendInput('');
    try {
      const res = await fetch(`${API_BASE}/api/friends/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ nickname: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showNotification(data.message || data.error || 'Request failed', 'error');
        return;
      }
      showNotification(`Friend request sent to ${value}`, 'success');
    } catch (_) {
      showNotification('Failed to send request', 'error');
    }
  };

  // Calculate total distance run
  useEffect(() => {
    if (currentRun.length < 2) {
      setTotalDistance(0);
      return;
    }
    
    let distance = 0;
    for (let i = 1; i < currentRun.length; i++) {
      distance += calculateDistance(
        currentRun[i-1].lat, currentRun[i-1].lng,
        currentRun[i].lat, currentRun[i].lng
      );
    }
    setTotalDistance(distance);
  }, [currentRun]);

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const startRun = () => {
    setIsRunning(true);
    setCurrentRun([]);
    setShowTutorial(false);
    showNotification('Run started! Click on map or use GPS to track your route', 'success');
  };

  const addWaypoint = (point) => {
    if (!isRunning) return;
    setCurrentRun([...currentRun, point]);
  };

  const completeRun = () => {
    if (currentRun.length < 3) {
      showNotification('You need at least 3 points to capture a territory!', 'error');
      return;
    }

    const area = calculateArea(currentRun);
    
    // Check if this territory overlaps with existing territories
    let capturedFrom = null;
    const newTerritories = territories.map(territory => {
      const firstPoint = currentRun[0];
      if (pointInPolygon(firstPoint, territory.points)) {
        capturedFrom = territory.playerId;
        return null;
      }
      return territory;
    }).filter(Boolean);

    const newTerritory = {
      id: Date.now(),
      playerId: currentPlayer,
      points: currentRun,
      area: area,
      distance: totalDistance,
      capturedAt: new Date().toISOString(),
    };

    setTerritories([...newTerritories, newTerritory]);

    // Update player stats
    const updatedPlayers = players.map(player => {
      if (player.id === currentPlayer) {
        return {
          ...player,
          totalArea: player.totalArea + area,
          territories: player.territories + 1,
        };
      }
      if (capturedFrom !== null && player.id === capturedFrom) {
        return {
          ...player,
          territories: Math.max(0, player.territories - 1),
        };
      }
      return player;
    });
    setPlayers(updatedPlayers);

    setCaptureAnimation(currentRun);
    setTimeout(() => setCaptureAnimation(null), 1000);

    const capturedFromName = capturedFrom !== null ? players.find(p => p.id === capturedFrom)?.name : null;
    showNotification(
      capturedFromName 
        ? `Territory captured from ${capturedFromName}! +${Math.round(area).toLocaleString()} m² (${Math.round(totalDistance)}m run)` 
        : `New territory captured! +${Math.round(area).toLocaleString()} m² (${Math.round(totalDistance)}m run)`,
      'success'
    );

    setIsRunning(false);
    setCurrentRun([]);
    setTotalDistance(0);
  };

  const cancelRun = () => {
    setIsRunning(false);
    setCurrentRun([]);
    setTotalDistance(0);
    showNotification('Run cancelled', 'error');
  };

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE}/api/logout`, { method: 'POST', credentials: 'include' });
    } catch (_) {}
    window.location.href = '/';
  };

  const handleViewConquest = (notification) => {
    if (!notification?.id) return;
    const meta = notification.meta ?? {};
    const bbox = meta.bbox && typeof meta.bbox.minLng === 'number' ? meta.bbox : null;
    const centroid = meta.centroid && typeof meta.centroid.lng === 'number' ? meta.centroid : null;
    setConquestViewTarget({
      bbox: bbox || null,
      centroid: centroid || null,
      notificationId: notification.id,
    });
  };

  const handleConquestAnimationDone = useCallback((notificationId) => {
    if (!notificationId) return;
    fetch(`${API_BASE}/api/notifications/${notificationId}/read`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});
    setConquestViewTarget(null);
  }, []);


  // Routes from cached Strava activities (polyline -> coordinates)
  const activityRoutes = (me?.activities ?? []).map((a) => {
    let coordinates = [];
    if (a.summaryPolyline) {
      coordinates = decodePolylineToLngLat(a.summaryPolyline);
    } else if (a.routeGeojson?.coordinates?.length) {
      coordinates = a.routeGeojson.coordinates;
    }
    return {
      userId: a.id,
      userName: a.name || 'Activity',
      coordinates,
      distanceMeters: a.distance ?? null,
      color: PLAYER_COLORS[0].main,
    };
  }).filter((r) => r.coordinates.length >= 2);
  const mapRoutes = activityRoutes.length > 0 ? activityRoutes : MOCK_ROUTES;

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: 'linear-gradient(135deg, #0a0a1a 0%, #1a0a2e 50%, #0a1a2e 100%)',
      fontFamily: '"Orbitron", "Rajdhani", -apple-system, sans-serif',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Rajdhani:wght@500;600;700&display=swap');
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        
        @keyframes glow {
          0%, 100% { filter: drop-shadow(0 0 8px currentColor); }
          50% { filter: drop-shadow(0 0 16px currentColor); }
        }
        
        @keyframes slideIn {
          from { transform: translateY(-20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        
        @keyframes slideInFromRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        
        @keyframes territory-conquest-bounce {
          0% { transform: scale(1.2); opacity: 1; }
          30% { transform: scale(1.4); opacity: 1; }
          70% { transform: scale(1.1); opacity: 0.9; }
          100% { transform: scale(1); opacity: 0; }
        }
        
        .stat-card {
          background: rgba(10, 10, 26, 0.8);
          backdrop-filter: blur(10px);
          border: 2px solid rgba(0, 255, 136, 0.3);
          border-radius: 16px;
          padding: 16px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
          animation: slideIn 0.5s ease-out;
        }
        
        .btn {
          padding: 12px 24px;
          border-radius: 12px;
          border: none;
          font-family: 'Rajdhani', sans-serif;
          font-weight: 700;
          font-size: 16px;
          cursor: pointer;
          transition: all 0.3s;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        
        .btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        }
        
        .btn:active {
          transform: translateY(0);
        }
        
        .btn-primary {
          background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%);
          color: #0a0a1a;
          box-shadow: 0 4px 16px rgba(0, 255, 136, 0.4);
        }
        
        .btn-primary:hover {
          box-shadow: 0 8px 24px rgba(0, 255, 136, 0.6);
        }
        
        .btn-danger {
          background: linear-gradient(135deg, #ff3366 0%, #cc0033 100%);
          color: white;
          box-shadow: 0 4px 16px rgba(255, 51, 102, 0.4);
        }
        
        .btn-secondary {
          background: rgba(255, 255, 255, 0.1);
          color: white;
          border: 2px solid rgba(255, 255, 255, 0.3);
        }
        
        .terrarun-main-layout {
          display: flex;
          height: calc(100vh - 88px);
          margin-top: 88px;
          padding: 0;
          gap: 0;
          overflow: hidden;
        }
        .terrarun-left-panel {
          width: 320px;
          min-width: 320px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 20px 16px;
          overflow-y: auto;
          border-right: 1px solid rgba(0, 255, 136, 0.12);
          background: rgba(10, 10, 20, 0.5);
        }
        .terrarun-nickname-card {
          padding: 14px 16px;
        }
        .terrarun-map-col {
          flex: 1;
          position: relative;
          min-width: 0;
          min-height: 0;
        }
        .terrarun-right-panel {
          width: 340px;
          min-width: 340px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          padding: 20px 16px;
          overflow-y: auto;
          border-left: 1px solid rgba(0, 255, 136, 0.12);
          background: rgba(10, 10, 20, 0.5);
        }
        .terrarun-leaderboard-card {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
        }
        .terrarun-leaderboard-card > div:last-child {
          flex: 1;
          min-height: 0;
        }
        .terrarun-leaderboard-tabs {
          display: flex;
          gap: 8px;
          margin-bottom: 14px;
          flex-shrink: 0;
        }
        .terrarun-leaderboard-tab {
          flex: 1;
          padding: 8px 12px;
          font-size: 13px;
          font-weight: 600;
          font-family: 'Rajdhani', sans-serif;
          color: rgba(255, 255, 255, 0.7);
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(0, 255, 136, 0.2);
          border-radius: 10px;
          cursor: pointer;
          transition: color 0.2s, background 0.2s, border-color 0.2s, box-shadow 0.2s;
        }
        .terrarun-leaderboard-tab:hover {
          color: rgba(255, 255, 255, 0.9);
          background: rgba(0, 255, 136, 0.08);
          border-color: rgba(0, 255, 136, 0.35);
        }
        .terrarun-leaderboard-tab-active {
          color: #0a0a1a;
          background: linear-gradient(135deg, #00ff88 0%, #00cc6a 100%);
          border-color: #00ff88;
          box-shadow: 0 0 16px rgba(0, 255, 136, 0.35);
        }
        .terrarun-leaderboard-tab:focus-visible {
          outline: 2px solid #00ff88;
          outline-offset: 2px;
        }
        .terrarun-leaderboard-list {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .terrarun-leaderboard-empty {
          padding: 24px 16px;
          font-size: 14px;
          color: rgba(255, 255, 255, 0.65);
          text-align: center;
          line-height: 1.5;
          background: rgba(255, 255, 255, 0.03);
          border: 1px dashed rgba(0, 255, 136, 0.25);
          border-radius: 12px;
        }
        @media (max-width: 1024px) {
          .terrarun-main-layout {
            flex-direction: column;
            height: auto;
            min-height: calc(100vh - 88px);
          }
          .terrarun-left-panel {
            width: 100%;
            min-width: 0;
            flex-direction: row;
            flex-wrap: wrap;
            border-right: none;
            border-bottom: 1px solid rgba(0, 255, 136, 0.12);
            padding: 12px 16px;
            max-height: none;
          }
          .terrarun-left-panel .stat-card {
            flex: 1;
            min-width: 200px;
          }
          .terrarun-map-col {
            flex: 1;
            min-height: 50vh;
          }
          .terrarun-right-panel {
            width: 100%;
            min-width: 0;
            border-left: none;
            border-top: 1px solid rgba(0, 255, 136, 0.12);
            padding: 12px 16px;
            max-height: 40vh;
            overflow-y: auto;
          }
        }
      `}</style>

      {/* Header */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        padding: '24px',
        zIndex: 1000,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{
            width: '48px',
            height: '48px',
            background: 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: 'glow 2s ease-in-out infinite',
          }}>
            <Target size={28} color="#0a0a1a" />
          </div>
          <div>
            <h1 style={{
              margin: 0,
              fontSize: '32px',
              fontFamily: 'Orbitron',
              fontWeight: 900,
              color: '#00ff88',
              textShadow: '0 0 20px rgba(0, 255, 136, 0.5)',
              letterSpacing: '2px',
            }}>
              TERRARUN
            </h1>
            <p style={{
              margin: 0,
              fontSize: '14px',
              color: 'rgba(255, 255, 255, 0.6)',
              fontWeight: 600,
            }}>
              Real-World Territory Capture • GPS Enabled
            </p>
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <NotificationBell apiBase={API_BASE} credentials onViewConquest={handleViewConquest} />
          <FriendRequestsDropdown apiBase={API_BASE} credentials onAcceptReject={() => { fetchMe(); fetchFriends(); fetchBadges(); }} />
          <button onClick={handleLogout} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <div style={{
          position: 'absolute',
          top: '100px',
          right: '24px',
          zIndex: 2000,
          background: notification.type === 'success' 
            ? 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)'
            : 'linear-gradient(135deg, #ff3366 0%, #cc0033 100%)',
          color: notification.type === 'success' ? '#0a0a1a' : 'white',
          padding: '16px 24px',
          borderRadius: '12px',
          fontWeight: 700,
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
          animation: 'slideInFromRight 0.5s ease-out',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          maxWidth: '400px',
        }}>
          {notification.type === 'success' ? <Zap size={20} /> : <X size={20} />}
          {notification.message}
        </div>
      )}

      {/* Badge unlock modal (first badge, secret, or tier III/IV) */}
      {badgeUnlockModal && badgeUnlockModal.length > 0 && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 3000,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setBadgeUnlockModal(null)}
        >
          <div
            style={{
              background: 'linear-gradient(135deg, #0a0a1a 0%, #1a0a2e 100%)',
              border: '2px solid #00ff88',
              borderRadius: 16,
              padding: 28,
              maxWidth: 400,
              boxShadow: '0 0 40px rgba(0,255,136,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 18, fontWeight: 700, color: '#00ff88', marginBottom: 16 }}>Badge(s) unlocked!</div>
            {badgeUnlockModal.map((b, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <span style={{ fontSize: 36 }}>{b.icon}</span>
                <div>
                  <div style={{ fontWeight: 600, color: '#fff' }}>{b.name}{b.tierLabel ? ` ${b.tierLabel}` : ''}</div>
                  {b.description && <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{b.description}</div>}
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setBadgeUnlockModal(null)}
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 8 }}
            >
              Awesome!
            </button>
          </div>
        </div>
      )}

      {/* All badges modal */}
      {showAllBadgesModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 3000,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={() => setShowAllBadgesModal(false)}
        >
          <div
            style={{
              background: 'linear-gradient(135deg, #0a0a1a 0%, #1a0a2e 100%)',
              border: '2px solid rgba(0,255,136,0.5)',
              borderRadius: 16,
              padding: 24,
              maxWidth: 520,
              maxHeight: '85vh',
              overflow: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, color: '#00ff88', fontSize: 20 }}>All badges</h3>
              <button type="button" onClick={() => setShowAllBadgesModal(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)', cursor: 'pointer', fontSize: 18 }}>×</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 12 }}>
              {badgeDefinitions.map((def) => {
                const unlocked = userBadges.find((b) => b.badgeKey === def.key);
                const showLocked = !unlocked && def.isSecret;
                return (
                  <div
                    key={def.key}
                    title={unlocked ? `${def.name}${unlocked.tierLabel ? ` ${unlocked.tierLabel}` : ''} — ${def.description || ''}` : (def.isSecret ? '???' : def.name)}
                    style={{
                      padding: 12,
                      textAlign: 'center',
                      background: unlocked ? 'rgba(0,255,136,0.12)' : 'rgba(255,255,255,0.06)',
                      borderRadius: 10,
                      border: unlocked ? '1px solid #00ff88' : '1px solid rgba(255,255,255,0.1)',
                    }}
                  >
                    <div style={{ fontSize: 28, marginBottom: 4 }}>{showLocked ? '???' : def.icon}</div>
                    <div style={{ fontSize: 11, color: unlocked ? '#00ff88' : 'rgba(255,255,255,0.6)', fontWeight: 600 }}>
                      {showLocked ? '???' : def.name}{unlocked?.tierLabel ? ` ${unlocked.tierLabel}` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Main content: 3-column (left panel | map | right panel) */}
      <div className="terrarun-main-layout">
        {/* Left panel: nickname, run controls, Strava */}
        <aside className="terrarun-left-panel">
          <div className="stat-card terrarun-nickname-card">
            <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>Nickname:</span>
            <span style={{ fontSize: '17px', color: '#00ff88', fontWeight: 700, marginTop: '4px', display: 'block' }}>
              {(me?.user?.nickname ?? nickname) || '—'}
            </span>
          </div>

          {/* Badges: last 3 + All badges modal */}
          <div className="stat-card" style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>Badges</span>
              <button
                type="button"
                onClick={() => setShowAllBadgesModal(true)}
                style={{
                  fontSize: 11,
                  color: '#00ff88',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                All badges
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {(last3Badges.length ? last3Badges : [{ icon: '—', name: 'No badges yet' }]).slice(0, 3).map((b, i) => (
                <span
                  key={b.id || i}
                  title={b.name + (b.tierLabel ? ` ${b.tierLabel}` : '') + (b.description ? ` — ${b.description}` : '')}
                  style={{
                    fontSize: 24,
                    cursor: last3Badges.length ? 'pointer' : 'default',
                    opacity: last3Badges.length ? 1 : 0.5,
                  }}
                  onClick={() => last3Badges.length && setShowAllBadgesModal(true)}
                >
                  {b.icon}
                </span>
              ))}
            </div>
          </div>

          {/* Controls */}
          <div className="stat-card">
            <h3 style={{
              margin: '0 0 16px 0',
              color: '#00ff88',
              fontSize: '18px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <Navigation size={20} />
              Run Controls
            </h3>
            
            {!isRunning ? (
              <button onClick={startRun} className="btn btn-primary" style={{ width: '100%' }}>
                <Play size={20} style={{ marginRight: '8px', display: 'inline', verticalAlign: 'middle' }} />
                Start Run
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{
                  padding: '12px',
                  background: 'rgba(0, 255, 136, 0.1)',
                  borderRadius: '8px',
                  border: '2px solid rgba(0, 255, 136, 0.3)',
                  color: '#00ff88',
                  textAlign: 'center',
                  fontWeight: 700,
                  animation: 'pulse 2s ease-in-out infinite',
                }}>
                  Running Active
                  <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '4px' }}>
                    {currentRun.length} waypoints • {Math.round(totalDistance)}m
                  </div>
                </div>
                <button onClick={completeRun} className="btn btn-primary" style={{ width: '100%' }}>
                  <Check size={20} style={{ marginRight: '8px', display: 'inline', verticalAlign: 'middle' }} />
                  Complete & Capture
                </button>
                <button onClick={cancelRun} className="btn btn-danger" style={{ width: '100%' }}>
                  <X size={20} style={{ marginRight: '8px', display: 'inline', verticalAlign: 'middle' }} />
                  Cancel Run
                </button>
              </div>
            )}
          </div>

          {/* Strava */}
          <StravaPanel
            activities={me?.activities ?? []}
            onSync={async (data) => {
              setAutoSyncError(null);
              fetchMe();
              if (data?.territoryChanges) {
                setFlashGainedPolygons(data.territoryChanges.gainedPolygons || []);
                setFlashLostPolygons(data.territoryChanges.lostPolygons || []);
                if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
                flashTimeoutRef.current = setTimeout(() => {
                  setFlashGainedPolygons([]);
                  setFlashLostPolygons([]);
                }, 45000);
              }
              const newBadges = data?.newBadgesUnlocked ?? [];
              if (newBadges.length > 0) {
                const res = await fetch(`${API_BASE}/api/badges`, { credentials: 'include' });
                if (res.ok) {
                  const badgeData = await res.json();
                  setUserBadges(badgeData.badges ?? []);
                  setLast3Badges(badgeData.last3 ?? []);
                  setBadgeDefinitions(badgeData.definitions ?? []);
                }
                const showSpecialModal = newBadges.some((b) => b.isSecret || (b.tiered && b.tier >= 3)) || newBadges.length === 1;
                if (showSpecialModal) {
                  setBadgeUnlockModal(newBadges);
                } else {
                  setNotification({
                    message: newBadges.length === 1
                      ? `Badge unlocked: ${newBadges[0].icon} ${newBadges[0].name}${newBadges[0].tierLabel ? ` ${newBadges[0].tierLabel}` : ''}`
                      : `${newBadges.length} badges unlocked!`,
                    type: 'success',
                  });
                  setTimeout(() => setNotification(null), 3500);
                }
              }
            }}
            onResyncComplete={() => {
              fetchMe();
              setTerritoryRefreshTrigger((t) => t + 1);
            }}
            onSelectActivity={setSelectedActivityId}
            apiBase={API_BASE}
          />

          {/* Sync status: last auto-sync time or error (actual message, not "Failed to fetch") */}
          {me?.stravaLinked && (
            <div style={{
              marginTop: 8,
              padding: '8px 12px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.05)',
              fontSize: 12,
              color: autoSyncError ? 'rgba(255,150,100,0.95)' : 'rgba(255,255,255,0.55)',
            }}>
              {autoSyncError ? (
                <span title={autoSyncError}>{autoSyncError}</span>
              ) : (
                <span>{formatLastSync(lastAutoSyncAt) ?? 'Sync when you load activities'}</span>
              )}
            </div>
          )}
        </aside>

        {/* Map (center) */}
        <div className="terrarun-map-col" style={{ position: 'relative' }}>
          <div style={{
            position: 'absolute',
            top: 12,
            left: 12,
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', fontWeight: 600 }}>Mode:</span>
              <button
                type="button"
                onClick={() => setGameMode('run')}
                style={{
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: gameMode === 'run' ? '1px solid #00ff88' : '1px solid rgba(255,255,255,0.12)',
                  background: gameMode === 'run' ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.45)',
                  color: gameMode === 'run' ? '#00ff88' : 'rgba(255,255,255,0.7)',
                  cursor: 'pointer',
                  boxShadow: gameMode === 'run' ? '0 0 12px rgba(0,255,136,0.35)' : 'none',
                }}
                onMouseEnter={(e) => {
                  if (gameMode !== 'run') {
                    e.currentTarget.style.background = 'rgba(0,0,0,0.6)';
                    e.currentTarget.style.color = 'rgba(255,255,255,0.9)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (gameMode !== 'run') {
                    e.currentTarget.style.background = 'rgba(0,0,0,0.45)';
                    e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
                  }
                }}
              >
                Run
              </button>
              <button
                type="button"
                onClick={() => setGameMode('game')}
                style={{
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: gameMode === 'game' ? '1px solid #00ff88' : '1px solid rgba(255,255,255,0.12)',
                  background: gameMode === 'game' ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.45)',
                  color: gameMode === 'game' ? '#00ff88' : 'rgba(255,255,255,0.7)',
                  cursor: 'pointer',
                  boxShadow: gameMode === 'game' ? '0 0 12px rgba(0,255,136,0.35)' : 'none',
                }}
                onMouseEnter={(e) => {
                  if (gameMode !== 'game') {
                    e.currentTarget.style.background = 'rgba(0,0,0,0.6)';
                    e.currentTarget.style.color = 'rgba(255,255,255,0.9)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (gameMode !== 'game') {
                    e.currentTarget.style.background = 'rgba(0,0,0,0.45)';
                    e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
                  }
                }}
              >
                Game
              </button>
            </div>
          </div>
          {gameMode === 'game' && gameLoops.length === 0 && (
            <div style={{
              position: 'absolute',
              bottom: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 40,
              padding: '10px 16px',
              background: 'rgba(0,0,0,0.75)',
              border: '1px solid rgba(0,255,136,0.4)',
              borderRadius: 10,
              color: 'rgba(255,255,255,0.9)',
              fontSize: 13,
              boxShadow: '0 0 20px rgba(0,255,136,0.2)',
            }}>
              No territory yet — sync activities to claim loops.
            </div>
          )}
          <TerritoryMap
            routes={gameMode === 'run' ? mapRoutes : []}
            territories={[]}
            loops={gameMode === 'game' ? gameLoops : (me?.activities ?? []).filter((a) => a.loopPolygonGeojson).map((a) => ({ id: a.id, polygonGeojson: a.loopPolygonGeojson, ownerType: 'me', colorKey: 'me' }))}
            selectedUserId={selectedActivityId}
            onSelectUser={setSelectedActivityId}
            gameMode={gameMode}
            territoryView={territoryView}
            apiBase={API_BASE}
            flashGainedPolygons={flashGainedPolygons}
            flashLostPolygons={flashLostPolygons}
            territoryRefreshTrigger={territoryRefreshTrigger}
            onLoopsLoaded={setGameLoops}
            conquestViewTarget={conquestViewTarget}
            onConquestAnimationDone={handleConquestAnimationDone}
          />
          
          {/* Tutorial overlay */}
          {showTutorial && !isRunning && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: 'rgba(10, 10, 26, 0.95)',
              backdropFilter: 'blur(10px)',
              border: '3px solid #00ff88',
              borderRadius: '24px',
              padding: '40px',
              maxWidth: '500px',
              textAlign: 'center',
              boxShadow: '0 0 60px rgba(0, 255, 136, 0.4)',
              zIndex: 100,
            }}>
              <h2 style={{
                margin: '0 0 12px 0',
                color: '#00ff88',
                fontSize: '28px',
                fontFamily: 'Orbitron',
                fontWeight: 900,
              }}>
                Welcome to TerraRun!
              </h2>
              <p style={{
                color: 'rgba(255, 255, 255, 0.7)',
                fontSize: '15px',
                marginBottom: '20px',
              }}>
                Powered by your steps.
              </p>
              <p style={{
                color: 'rgba(255, 255, 255, 0.9)',
                fontSize: '16px',
                lineHeight: '1.6',
                marginBottom: '20px',
              }}>
                Every run claims territory.<br />
                Paint the map with your routes.<br />
                Challenge friends, climb the leaderboard, and own your city.
              </p>
              <p style={{
                color: 'rgba(255, 255, 255, 0.5)',
                fontSize: '13px',
                marginBottom: '24px',
                fontStyle: 'italic',
              }}>
                Tip: Start a run to begin capturing zones.
              </p>
              <button
                onClick={() => setShowTutorial(false)}
                className="btn btn-primary"
              >
                LET'S GO!
              </button>
            </div>
          )}
          
          {/* Instructions */}
          {!showTutorial && !isRunning && (
            <div style={{
              position: 'absolute',
              bottom: '20px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(10, 10, 26, 0.9)',
              backdropFilter: 'blur(10px)',
              border: '2px solid rgba(0, 255, 136, 0.3)',
              borderRadius: '12px',
              padding: '12px 20px',
              color: 'rgba(255, 255, 255, 0.8)',
              fontSize: '14px',
              fontWeight: 600,
            }}>
              💡 Hover for details • Click a route or territory to select that runner
            </div>
          )}
        </div>

        {/* Right panel: Leaderboard (Game mode) or Run Mode summary (Run mode) */}
        <aside className="terrarun-right-panel">
          {gameMode === 'run' ? (
            <div className="stat-card terrarun-leaderboard-card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <h3 style={{
                margin: 0,
                color: '#00ff88',
                fontSize: '18px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}>
                <Activity size={20} />
                Run Mode
              </h3>
              {runModeStats == null ? (
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>Loading stats…</div>
              ) : (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{
                      padding: '10px 12px',
                      background: 'rgba(255,255,255,0.06)',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.1)',
                    }}>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Today</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#00ff88' }}>{runModeStats.todayMiles?.toFixed(2) ?? '0.00'} mi</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{runModeStats.todayCount ?? 0} {runModeStats.todayCount === 1 ? 'activity' : 'activities'}</div>
                    </div>
                    <div style={{
                      padding: '10px 12px',
                      background: 'rgba(255,255,255,0.06)',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.1)',
                    }}>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>This week (Mon–Sun)</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#00ff88' }}>{runModeStats.weekMiles?.toFixed(2) ?? '0.00'} mi</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{runModeStats.weekActiveDaysCount ?? 0} active days · {runModeStats.streakDays ?? 0} day streak</div>
                    </div>
                    <div style={{
                      padding: '10px 12px',
                      background: 'rgba(255,255,255,0.06)',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.1)',
                    }}>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>All-time</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#00ff88' }}>{runModeStats.totalMiles?.toFixed(2) ?? '0.00'} mi</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{runModeStats.totalActivities ?? 0} activities · Longest {runModeStats.longestActivityMiles?.toFixed(2) ?? '0.00'} mi</div>
                    </div>
                  </div>
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 12 }}>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Territory & loops</div>
                    {runModeStats.ownedAreaMi2 > 0 ? (
                      <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.9)', marginBottom: 8 }}>Territory owned: {runModeStats.ownedAreaMi2.toFixed(2)} mi²</div>
                    ) : (
                      <div style={{
                        padding: 10,
                        background: 'rgba(0,255,136,0.08)',
                        borderRadius: 10,
                        border: '1px solid rgba(0,255,136,0.25)',
                        fontSize: 12,
                        color: 'rgba(255,255,255,0.85)',
                        marginBottom: 8,
                      }}>
                        Capture your first territory: complete a loop and finish within 100m of your start.
                      </div>
                    )}
                    {runModeStats.loopCount > 0 ? (
                      <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.9)' }}>Loops completed: {runModeStats.loopCount}</div>
                    ) : (
                      <div style={{
                        padding: 10,
                        background: 'rgba(255,255,255,0.06)',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.1)',
                        fontSize: 12,
                        color: 'rgba(255,255,255,0.75)',
                      }}>
                        Close your first loop to start claiming territory.
                      </div>
                    )}
                  </div>
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 12 }}>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Recent badges</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                      {(runModeStats.last3Badges?.length ? runModeStats.last3Badges : [{ icon: '—', name: 'No badges yet', description: null }]).slice(0, 3).map((b, i) => (
                        <span
                          key={b.id ?? i}
                          title={[b.name, b.tierLabel, b.description].filter(Boolean).join(' · ')}
                          style={{
                            fontSize: 24,
                            cursor: runModeStats.last3Badges?.length ? 'pointer' : 'default',
                            opacity: runModeStats.last3Badges?.length ? 1 : 0.5,
                          }}
                        >
                          {b.icon ?? '🏅'}
                        </span>
                      ))}
                    </div>
                    {(runModeStats.progressToNextBadge?.length ?? 0) > 0 && (
                      <>
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Progress to next badge</div>
                        {runModeStats.progressToNextBadge.map((p) => {
                          const pct = Math.min(100, (p.current / p.nextThreshold) * 100);
                          return (
                            <div key={p.badgeKey} style={{ marginBottom: 10 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,255,255,0.7)', marginBottom: 4 }}>
                                <span>{p.icon} {p.name}</span>
                                <span>{p.current} / {p.nextThreshold} {p.unit}</span>
                              </div>
                              <div style={{ height: 6, background: 'rgba(255,255,255,0.15)', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: '#00ff88', borderRadius: 3, transition: 'width 0.3s ease' }} />
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 10, fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                    Last sync: {runModeStats.lastAutoSyncAt || runModeStats.lastSyncAt
                      ? (() => {
                          const t = runModeStats.lastAutoSyncAt || runModeStats.lastSyncAt;
                          try {
                            const d = new Date(t);
                            const now = new Date();
                            const diffMs = now - d;
                            if (diffMs < 60000) return 'Just now';
                            if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
                            if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
                            return d.toLocaleDateString();
                          } catch (_) { return t; }
                        })()
                      : 'Never'}
                  </div>
                  {selectedActivityId && activityRoutes.some((r) => String(r.userId) === String(selectedActivityId)) && (
                    <div style={{
                      padding: 10,
                      background: 'rgba(0,255,136,0.08)',
                      borderRadius: 10,
                      fontSize: 12,
                      color: 'rgba(255,255,255,0.85)',
                    }}>
                      Selected run highlighted on map.
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="stat-card terrarun-leaderboard-card">
              <h3 style={{
                margin: '0 0 12px 0',
                color: '#00ff88',
                fontSize: '18px',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}>
                <Trophy size={20} />
                Leaderboard
              </h3>
              <div className="terrarun-leaderboard-tabs" style={{ marginBottom: 8 }}>
                {['global', 'friends'].map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`terrarun-leaderboard-tab ${gameScope === key ? 'terrarun-leaderboard-tab-active' : ''}`}
                    onClick={() => setGameScope(key)}
                  >
                    {key === 'global' ? 'Global' : 'Friends'}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                {[
                  { key: 'total', label: 'Total Area' },
                  { key: 'recent', label: '24h Gains' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setLeaderboardMetric(key)}
                    style={{
                      padding: '6px 10px',
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 8,
                      border: leaderboardMetric === key ? '1px solid #00ff88' : '1px solid rgba(255,255,255,0.2)',
                      background: leaderboardMetric === key ? 'rgba(0,255,136,0.15)' : 'rgba(255,255,255,0.06)',
                      color: leaderboardMetric === key ? '#00ff88' : 'rgba(255,255,255,0.8)',
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>Nearby — Coming soon</div>
              <div className="terrarun-leaderboard-list">
                {leaderboardLoading ? (
                  <div className="terrarun-leaderboard-empty">Loading…</div>
                ) : leaderboardRows.length === 0 ? (
                  <div className="terrarun-leaderboard-empty">
                    {gameScope === 'friends' ? 'No friends on leaderboard yet.' : 'No territory claimed yet. Sync activities to claim loops.'}
                  </div>
                ) : (
                  leaderboardRows.map((row) => {
                    const friendBadges = gameScope === 'friends'
                      ? (row.isMe ? last3Badges.map((b) => ({ icon: b.icon, name: b.name, tierLabel: b.tierLabel })) : (friendsBadges.find((f) => f.id === row.userId)?.last3 ?? []))
                      : [];
                    return (
                      <div
                        key={row.userId}
                        style={{
                          padding: '12px 14px',
                          background: row.isMe ? 'linear-gradient(135deg, rgba(0,255,136,0.2) 0%, rgba(255,255,255,0.04) 100%)' : 'rgba(255,255,255,0.04)',
                          border: row.isMe ? '2px solid #00ff88' : '1px solid rgba(255,255,255,0.12)',
                          borderRadius: '12px',
                          marginBottom: 8,
                        }}
                      >
                        <div style={{
                          fontSize: 15,
                          fontWeight: 700,
                          color: row.isMe ? '#00ff88' : 'rgba(255,255,255,0.9)',
                          marginBottom: 2,
                        }}>
                          #{row.rank} {row.isMe ? 'You' : (row.nickname || 'Anonymous')}
                        </div>
                        {gameScope === 'friends' && friendBadges.length > 0 && (
                          <div style={{ display: 'flex', gap: 4, marginBottom: 6, fontSize: 14 }} title={friendBadges.map((b) => b.name + (b.tierLabel ? ` ${b.tierLabel}` : '')).join(', ')}>
                            {friendBadges.map((b, i) => (
                              <span key={i}>{b.icon ?? '???'}</span>
                            ))}
                          </div>
                        )}
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 13,
                          color: 'rgba(255,255,255,0.7)',
                        }}>
                          <span>Area: {row.areaMi2 != null ? row.areaMi2.toFixed(2) : '0'} mi²</span>
                          <span>Cells: {row.cells ?? 0}</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Add Friends — send request by nickname */}
          <div className="stat-card" style={{ marginTop: '16px', flexShrink: 0 }}>
            <h3 style={{
              margin: '0 0 12px 0',
              color: '#00ff88',
              fontSize: '16px',
              fontWeight: 700,
            }}>
              Add Friends
            </h3>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input
                type="text"
                placeholder="Nickname to request…"
                value={addFriendInput}
                onChange={(e) => setAddFriendInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSendFriendRequest(); } }}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  fontSize: '14px',
                  color: '#fff',
                  background: 'rgba(255,255,255,0.08)',
                  border: '2px solid rgba(0, 255, 136, 0.25)',
                  borderRadius: '10px',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={handleSendFriendRequest}
                className="btn btn-primary"
                style={{ padding: '10px 16px' }}
              >
                Send request
              </button>
            </div>
            {apiFriends.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>Your friends</div>
                {apiFriends.map((f) => (
                  <div
                    key={f.id || f.nickname}
                    style={{
                      padding: '8px 10px',
                      background: 'rgba(255,255,255,0.06)',
                      borderRadius: '8px',
                      fontSize: '14px',
                      color: 'rgba(255,255,255,0.9)',
                    }}
                  >
                    {f.nickname ?? f}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}