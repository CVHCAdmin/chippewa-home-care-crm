// components/portal/PortalVisits.jsx
// Upcoming scheduled visits for the client
import React, { useState, useEffect } from 'react';
import { apiCall } from '../../config';

const statusBadge = (status) => {
  const map = {
    scheduled:   { bg: '#e8f4fd', color: '#1a5276', label: 'Scheduled' },
    in_progress: { bg: '#eafaf1', color: '#1e8449', label: 'In Progress' },
    completed:   { bg: '#f0f0f0', color: '#555',    label: 'Completed'  },
    cancelled:   { bg: '#fdf2f2', color: '#c0392b', label: 'Cancelled'  },
    no_show:     { bg: '#fef9e7', color: '#d68910', label: 'No Show'    },
  };
  const s = map[status] || map.scheduled;
  return (
    <span style={{
      background: s.bg, color: s.color,
      padding: '2px 10px', borderRadius: '12px',
      fontSize: '0.75rem', fontWeight: 600,
    }}>
      {s.label}
    </span>
  );
};

const formatDate = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};

const formatTime = (timeStr) => {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12  = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
};

const isToday = (dateStr) => {
  const today = new Date().toISOString().split('T')[0];
  return dateStr === today;
};

const isTomorrow = (dateStr) => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  return dateStr === tomorrow;
};

const dayLabel = (dateStr) => {
  if (isToday(dateStr))    return '📍 Today';
  if (isTomorrow(dateStr)) return '➡️ Tomorrow';
  return formatDate(dateStr);
};

const PortalVisits = ({ token }) => {
  const [visits, setVisits]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    apiCall('/api/client-portal/portal/visits', { method: 'GET' }, token)
      .then(data => { if (data) setVisits(data); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>Loading your schedule...</div>;
  if (error)   return <div className="alert alert-error">{error}</div>;

  return (
    <div>
      <h2 style={{ margin: '0 0 20px', fontSize: '1.3rem', color: '#1a5276' }}>
        📅 Upcoming Visits
      </h2>

      {visits.length === 0 ? (
        <div style={{
          background: '#fff', borderRadius: '12px', padding: '48px',
          textAlign: 'center', color: '#888', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📭</div>
          <div style={{ fontSize: '1rem', fontWeight: 500 }}>No upcoming visits scheduled</div>
          <div style={{ fontSize: '0.85rem', marginTop: '8px' }}>
            Contact your care coordinator if you have questions.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {visits.map(visit => (
            <div
              key={visit.id}
              style={{
                background: isToday(visit.scheduled_date) ? '#fffbf0' : '#fff',
                borderRadius: '12px',
                padding: '20px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                borderLeft: isToday(visit.scheduled_date) ? '4px solid #f39c12' : '4px solid #2980b9',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: '#1a5276', marginBottom: '4px' }}>
                    {dayLabel(visit.scheduled_date)}
                  </div>
                  <div style={{ color: '#555', fontSize: '0.9rem' }}>
                    🕐 {formatTime(visit.start_time)} – {formatTime(visit.end_time)}
                  </div>
                </div>
                {statusBadge(visit.status)}
              </div>

              <div style={{
                marginTop: '14px', paddingTop: '14px',
                borderTop: '1px solid #f0f0f0',
                display: 'flex', gap: '24px', flexWrap: 'wrap',
              }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '2px' }}>CAREGIVER</div>
                  <div style={{ fontWeight: 600, color: '#333' }}>
                    {visit.caregiver_first_name} {visit.caregiver_last_name}
                  </div>
                </div>
                {visit.caregiver_phone && (
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '2px' }}>PHONE</div>
                    <a href={`tel:${visit.caregiver_phone}`} style={{ fontWeight: 600, color: '#2980b9', textDecoration: 'none' }}>
                      {visit.caregiver_phone}
                    </a>
                  </div>
                )}
              </div>

              {visit.notes && (
                <div style={{
                  marginTop: '12px', background: '#f8f9fa',
                  borderRadius: '8px', padding: '10px 14px',
                  fontSize: '0.85rem', color: '#555',
                }}>
                  📝 {visit.notes}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PortalVisits;
