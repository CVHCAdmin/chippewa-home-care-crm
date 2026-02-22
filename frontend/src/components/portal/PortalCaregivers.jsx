// components/portal/PortalCaregivers.jsx
// Show the client's active assigned caregivers
import React, { useState, useEffect } from 'react';
import { apiCall } from '../../config';

const PortalCaregivers = ({ token }) => {
  const [caregivers, setCaregivers] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');

  useEffect(() => {
    apiCall('/api/client-portal/portal/caregivers', { method: 'GET' }, token)
      .then(data => { if (data) setCaregivers(data); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>Loading...</div>;
  if (error)   return <div className="alert alert-error">{error}</div>;

  return (
    <div>
      <h2 style={{ margin: '0 0 20px', fontSize: '1.3rem', color: '#1a5276' }}>
        👤 My Caregivers
      </h2>

      {caregivers.length === 0 ? (
        <div style={{
          background: '#fff', borderRadius: '12px', padding: '48px',
          textAlign: 'center', color: '#888', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>👤</div>
          <div>No caregivers currently assigned.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {caregivers.map(cg => (
            <div
              key={cg.assignment_id}
              style={{
                background: '#fff', borderRadius: '12px', padding: '20px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                display: 'flex', alignItems: 'center', gap: '16px',
              }}
            >
              {/* Avatar */}
              <div style={{
                width: '54px', height: '54px', borderRadius: '50%',
                background: 'linear-gradient(135deg, #1a5276, #2980b9)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: '1.3rem', fontWeight: 700, flexShrink: 0,
              }}>
                {cg.first_name?.[0]}{cg.last_name?.[0]}
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#1a5276' }}>
                  {cg.first_name} {cg.last_name}
                </div>

                {cg.hours_per_week && (
                  <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '2px' }}>
                    {cg.hours_per_week} hrs/week
                  </div>
                )}

                {cg.certifications?.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                    {cg.certifications.map((cert, i) => (
                      <span key={i} style={{
                        background: '#eaf4fd', color: '#1a5276',
                        padding: '2px 8px', borderRadius: '10px',
                        fontSize: '0.72rem', fontWeight: 600,
                      }}>
                        {cert}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {cg.phone && (
                <a
                  href={`tel:${cg.phone}`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    background: '#eaf4fd', color: '#1a5276',
                    padding: '8px 14px', borderRadius: '8px',
                    textDecoration: 'none', fontWeight: 600, fontSize: '0.85rem',
                    flexShrink: 0,
                  }}
                >
                  📞 Call
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PortalCaregivers;
