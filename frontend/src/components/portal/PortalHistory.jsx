// components/portal/PortalHistory.jsx
// Past completed visits from time_entries
import React, { useState, useEffect } from 'react';
import { apiCall } from '../../config';

const formatDuration = (minutes) => {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

const formatDateTime = (isoStr) => {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
};

const PortalHistory = ({ token }) => {
  const [visits, setVisits]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [offset, setOffset]   = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const LIMIT = 10;

  const loadVisits = (reset = false) => {
    const newOffset = reset ? 0 : offset;
    setLoading(true);
    apiCall(`/api/client-portal/portal/history?limit=${LIMIT}&offset=${newOffset}`, { method: 'GET' }, token)
      .then(data => {
        if (!data) return;
        setVisits(prev => reset ? data : [...prev, ...data]);
        setOffset(newOffset + LIMIT);
        setHasMore(data.length === LIMIT);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadVisits(true); }, [token]);

  if (loading && visits.length === 0) return <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>Loading visit history...</div>;
  if (error) return <div className="alert alert-error">{error}</div>;

  return (
    <div>
      <h2 style={{ margin: '0 0 20px', fontSize: '1.3rem', color: '#1a5276' }}>
        🕐 Visit History
      </h2>

      {visits.length === 0 ? (
        <div style={{
          background: '#fff', borderRadius: '12px', padding: '48px',
          textAlign: 'center', color: '#888', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📋</div>
          <div>No visit history yet.</div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {visits.map(visit => (
              <div
                key={visit.id}
                style={{
                  background: '#fff', borderRadius: '12px', padding: '18px 20px',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                  display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', flexWrap: 'wrap', gap: '12px',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: '#333', marginBottom: '3px' }}>
                    {formatDateTime(visit.start_time)}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#666' }}>
                    with {visit.caregiver_first_name} {visit.caregiver_last_name}
                  </div>
                  {visit.notes && (
                    <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '4px' }}>
                      📝 {visit.notes}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    background: '#eafaf1', color: '#1e8449',
                    padding: '4px 12px', borderRadius: '12px',
                    fontSize: '0.8rem', fontWeight: 600,
                  }}>
                    ✓ {formatDuration(visit.duration_minutes)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {hasMore && (
            <div style={{ textAlign: 'center', marginTop: '20px' }}>
              <button
                onClick={() => loadVisits(false)}
                disabled={loading}
                className="btn btn-primary"
                style={{ background: 'transparent', color: '#2980b9', border: '1px solid #2980b9' }}
              >
                {loading ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PortalHistory;
