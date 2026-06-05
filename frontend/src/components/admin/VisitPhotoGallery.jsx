// VisitPhotoGallery — admin view of all visit photos for a client.
// List view fetches metadata only; clicking a thumbnail lazy-loads the
// full image (so a client with 200 visits doesn't blow up the network).

import React, { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';

export default function VisitPhotoGallery({ token, clientId, limit = 60 }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openPhoto, setOpenPhoto] = useState(null); // full photo loaded for lightbox
  const [loadingFull, setLoadingFull] = useState(false);

  const hdr = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/time-entries/photos/client/${clientId}?limit=${limit}`, { headers: hdr });
      if (r.ok) setList(await r.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [clientId, token, limit]);

  useEffect(() => { load(); }, [load]);

  const openLightbox = async (photoMeta) => {
    setLoadingFull(true);
    setOpenPhoto({ ...photoMeta, image_base64: null });
    try {
      const r = await fetch(`${API_BASE_URL}/api/time-entries/photo/${photoMeta.id}`, { headers: hdr });
      if (!r.ok) throw new Error('load failed');
      const full = await r.json();
      setOpenPhoto(full);
    } catch (e) {
      alert('Failed to load photo: ' + e.message);
      setOpenPhoto(null);
    } finally { setLoadingFull(false); }
  };

  const fmtDate = (t) => new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  if (!clientId) return <div style={{ padding: 20, color: '#9CA3AF' }}>Pick a client to view their visit photos.</div>;
  if (loading) return <div style={{ padding: 20, color: '#6B7280' }}>Loading photos…</div>;
  if (list.length === 0) return <div style={{ padding: 20, color: '#9CA3AF' }}>No visit photos on record for this client yet.</div>;

  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: '0.9rem', color: '#374151' }}>
        <strong>{list.length}</strong> photos {limit < 1000 && list.length === limit ? `(showing latest ${limit})` : ''}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
        {list.map(p => (
          <button key={p.id} onClick={() => openLightbox(p)}
            style={{
              padding: 0, border: '1px solid #E5E7EB', borderRadius: 8,
              background: '#F3F4F6', cursor: 'pointer', textAlign: 'left', overflow: 'hidden',
            }}>
            <div style={{ background: '#111827', height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontSize: 28 }}>
              📷
            </div>
            <div style={{ padding: '5px 7px', fontSize: '0.72rem' }}>
              <div style={{ fontWeight: 700, color: '#374151', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.caption || (p.category ? p.category : 'Visit photo')}
              </div>
              <div style={{ color: '#6B7280' }}>{fmtDate(p.taken_at)}</div>
              {p.first_name && (
                <div style={{ color: '#9CA3AF', fontSize: '0.68rem' }}>{p.first_name} {p.last_name?.[0] || ''}.</div>
              )}
            </div>
          </button>
        ))}
      </div>

      {openPhoto && (
        <div onClick={() => setOpenPhoto(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: '95vw', maxHeight: '95vh', background: '#fff', borderRadius: 8, padding: 12, overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: '0.9rem' }}>
                <strong>{openPhoto.caption || openPhoto.category || 'Visit photo'}</strong>
                {' '}<span style={{ color: '#6B7280', fontSize: '0.8rem' }}>· {fmtDate(openPhoto.taken_at)}</span>
              </div>
              <button onClick={() => setOpenPhoto(null)}
                style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6B7280' }}>×</button>
            </div>
            {loadingFull && !openPhoto.image_base64 ? (
              <div style={{ width: 600, height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111827', color: '#9CA3AF' }}>
                Loading photo…
              </div>
            ) : openPhoto.image_base64 ? (
              <img src={openPhoto.image_base64} alt={openPhoto.caption || ''}
                style={{ maxWidth: '90vw', maxHeight: '80vh', display: 'block', margin: '0 auto', borderRadius: 4 }} />
            ) : null}
            {openPhoto.first_name && (
              <div style={{ marginTop: 8, fontSize: '0.8rem', color: '#6B7280' }}>
                Uploaded by {openPhoto.first_name} {openPhoto.last_name}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
