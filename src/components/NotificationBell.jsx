import React, { useState, useEffect, useRef } from 'react';
import { Bell } from 'lucide-react';

export default function NotificationBell({ apiBase, credentials = true, onViewConquest }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);

  const fetchNotifications = async (unreadOnly = false) => {
    try {
      const res = await fetch(`${apiBase}/api/notifications${unreadOnly ? '?unreadOnly=true' : ''}`, {
        credentials: credentials ? 'include' : 'omit',
      });
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch (_) {}
  };

  useEffect(() => {
    fetchNotifications();
  }, [apiBase]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchNotifications().finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const markAsRead = async (id) => {
    try {
      await fetch(`${apiBase}/api/notifications/${id}/read`, {
        method: 'POST',
        credentials: credentials ? 'include' : 'omit',
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (_) {}
  };

  const markAllRead = async () => {
    try {
      await fetch(`${apiBase}/api/notifications/read-all`, {
        method: 'POST',
        credentials: credentials ? 'include' : 'omit',
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
      setUnreadCount(0);
    } catch (_) {}
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          background: 'rgba(255,255,255,0.1)',
          border: '2px solid rgba(0, 255, 136, 0.3)',
          borderRadius: '10px',
          padding: '10px 14px',
          color: '#fff',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          position: 'relative',
        }}
        aria-label="Notifications"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              background: '#ff3366',
              color: '#fff',
              fontSize: 11,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 8,
            width: 320,
            maxHeight: 400,
            overflowY: 'auto',
            background: 'rgba(10, 10, 26, 0.98)',
            border: '2px solid rgba(0, 255, 136, 0.3)',
            borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            zIndex: 2000,
          }}
        >
          <div
            style={{
              padding: '12px 14px',
              borderBottom: '1px solid rgba(0, 255, 136, 0.2)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontWeight: 700, color: '#00ff88' }}>Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: 12,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Mark all read
              </button>
            )}
          </div>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>Loading…</div>
          ) : notifications.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>No notifications</div>
          ) : (
            <>
              {(() => {
                const attackCount = notifications.filter((n) => n.type === 'TERRITORY_CONQUERED' && !n.readAt).length;
                return attackCount > 0 ? (
                  <div style={{ padding: '8px 14px', background: 'rgba(255,51,102,0.12)', borderBottom: '1px solid rgba(255,51,102,0.2)', fontSize: 13, color: 'rgba(255,255,255,0.9)' }}>
                    {attackCount} attack{attackCount !== 1 ? 's' : ''} happened
                  </div>
                ) : null;
              })()}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {notifications.map((n) => (
                <li
                  key={n.id}
                  style={{
                    padding: '12px 14px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    background: n.readAt ? 'transparent' : 'rgba(0, 255, 136, 0.06)',
                  }}
                >
                  <div style={{ fontWeight: 600, color: '#fff', marginBottom: 4 }}>{n.title}</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)' }}>{n.body}</div>
                  {n.type === 'TERRITORY_CONQUERED' && n.meta?.attackerNickname && (
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>{n.meta.attackerNickname}</div>
                  )}
                  {!n.readAt && (
                    <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                      {n.type === 'TERRITORY_CONQUERED' && typeof onViewConquest === 'function' && (
                        <button
                          type="button"
                          onClick={() => { onViewConquest(n); setOpen(false); }}
                          style={{
                            background: 'rgba(255, 51, 102, 0.2)',
                            border: '1px solid rgba(255, 51, 102, 0.5)',
                            color: '#ff5588',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            padding: '4px 10px',
                            borderRadius: 8,
                          }}
                        >
                          View
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => markAsRead(n.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#00ff88',
                          fontSize: 12,
                          cursor: 'pointer',
                          padding: 0,
                          textDecoration: 'underline',
                        }}
                      >
                        Mark as read
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
