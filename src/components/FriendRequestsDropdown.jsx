import React, { useState, useEffect, useRef } from 'react';
import { UserPlus } from 'lucide-react';

export default function FriendRequestsDropdown({ apiBase, credentials = true, onAcceptReject }) {
  const [requests, setRequests] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);

  const fetchRequests = async () => {
    try {
      const res = await fetch(`${apiBase}/api/friends/requests`, {
        credentials: credentials ? 'include' : 'omit',
      });
      if (!res.ok) return;
      const data = await res.json();
      setRequests(data.requests ?? []);
    } catch (_) {}
  };

  useEffect(() => {
    fetchRequests();
  }, [apiBase]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchRequests().finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const respond = async (requestId, action) => {
    try {
      const res = await fetch(`${apiBase}/api/friends/requests/${requestId}/${action}`, {
        method: 'POST',
        credentials: credentials ? 'include' : 'omit',
      });
      if (!res.ok) return;
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
      if (typeof onAcceptReject === 'function') onAcceptReject();
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
        aria-label="Friend requests"
      >
        <UserPlus size={20} />
        {requests.length > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 18,
              height: 18,
              borderRadius: 9,
              background: '#ffaa00',
              color: '#0a0a1a',
              fontSize: 11,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
            }}
          >
            {requests.length > 99 ? '99+' : requests.length}
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
            width: 300,
            maxHeight: 360,
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
              fontWeight: 700,
              color: '#00ff88',
            }}
          >
            Friend requests
          </div>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.6)' }}>Loading…</div>
          ) : requests.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>No pending requests</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {requests.map((r) => (
                <li
                  key={r.id}
                  style={{
                    padding: '12px 14px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontWeight: 600, color: '#fff' }}>{r.fromUser?.nickname ?? 'Unknown'}</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => respond(r.id, 'accept')}
                      style={{
                        padding: '6px 12px',
                        background: 'linear-gradient(135deg, #00ff88 0%, #00cc6a 100%)',
                        color: '#0a0a1a',
                        border: 'none',
                        borderRadius: 8,
                        fontWeight: 700,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => respond(r.id, 'reject')}
                      style={{
                        padding: '6px 12px',
                        background: 'rgba(255,255,255,0.15)',
                        color: '#fff',
                        border: '1px solid rgba(255,255,255,0.3)',
                        borderRadius: 8,
                        fontWeight: 600,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
