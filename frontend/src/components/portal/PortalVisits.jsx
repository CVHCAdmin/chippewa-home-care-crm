// components/portal/PortalVisits.jsx
// Upcoming scheduled visits — with cancel, reschedule, and note actions
import React, { useState, useEffect } from 'react';
import { apiCall } from '../../config';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

const requestBadge = (cr) => {
  const map = {
    pending:          { bg: '#fef9e7', color: '#d68910', label: cr.request_type === 'cancel' ? 'Cancel Pending' : 'Reschedule Pending' },
    counter_offered:  { bg: '#f0e6ff', color: '#7d3c98', label: 'Counter-Offer' },
  };
  const s = map[cr.status] || map.pending;
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
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};

const formatShortDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

const formatTime = (timeStr) => {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12  = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
};

const isToday = (dateStr) => new Date().toISOString().split('T')[0] === dateStr;
const isTomorrow = (dateStr) => new Date(Date.now() + 86400000).toISOString().split('T')[0] === dateStr;
const dayLabel = (dateStr) => {
  if (isToday(dateStr))    return 'Today';
  if (isTomorrow(dateStr)) return 'Tomorrow';
  return formatDate(dateStr);
};

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Build visit identity payload for API calls
const visitPayload = (visit) => ({
  source:      visit.source,
  visitId:     visit.source === 'scheduled_visit' ? visit.id : null,
  scheduleId:  visit.schedule_id || null,
  visitDate:   visit.scheduled_date,
  caregiverId: visit.caregiver_id,
  startTime:   visit.start_time,
  endTime:     visit.end_time,
});

// ── Inline button style ─────────────────────────────────────────────────────

const actionBtn = (color = '#555') => ({
  background: 'none', border: `1px solid ${color}`, color,
  padding: '5px 12px', borderRadius: '6px', cursor: 'pointer',
  fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap',
});

const primaryBtn = {
  background: '#1a5276', border: 'none', color: '#fff',
  padding: '8px 18px', borderRadius: '8px', cursor: 'pointer',
  fontSize: '0.85rem', fontWeight: 600,
};

const secondaryBtn = {
  background: '#f0f0f0', border: 'none', color: '#555',
  padding: '8px 18px', borderRadius: '8px', cursor: 'pointer',
  fontSize: '0.85rem', fontWeight: 600,
};

const dangerBtn = {
  background: '#e74c3c', border: 'none', color: '#fff',
  padding: '8px 18px', borderRadius: '8px', cursor: 'pointer',
  fontSize: '0.85rem', fontWeight: 600,
};

// ── Overlay / modal base ────────────────────────────────────────────────────

const Overlay = ({ children, onClose }) => (
  <div
    onClick={onClose}
    style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: '16px',
    }}
  >
    <div
      onClick={e => e.stopPropagation()}
      style={{
        background: '#fff', borderRadius: '16px', padding: '28px',
        width: '100%', maxWidth: '480px', maxHeight: '80vh', overflowY: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      }}
    >
      {children}
    </div>
  </div>
);

// ── Component ────────────────────────────────────────────────────────────────

const PortalVisits = ({ token }) => {
  const [visits, setVisits]               = useState([]);
  const [changeRequests, setChangeRequests] = useState([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState('');

  // Modal state
  const [modal, setModal]                 = useState(null); // 'note' | 'cancel' | 'reschedule' | null
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [submitting, setSubmitting]       = useState(false);

  // Note form
  const [noteText, setNoteText]           = useState('');

  // Cancel form
  const [cancelReason, setCancelReason]   = useState('');

  // Reschedule form
  const [availSlots, setAvailSlots]       = useState([]);
  const [slotsLoading, setSlotsLoading]   = useState(false);
  const [selectedSlot, setSelectedSlot]   = useState(null);

  // ── Data loading ────────────────────────────────────────────────────────

  const loadVisits = () =>
    apiCall('/api/client-portal/portal/visits', { method: 'GET' }, token)
      .then(data => { if (data) setVisits(data); })
      .catch(err => setError(err.message));

  const loadChangeRequests = () =>
    apiCall('/api/client-portal/portal/change-requests', { method: 'GET' }, token)
      .then(data => { if (data) setChangeRequests(data); })
      .catch(() => {});

  useEffect(() => {
    Promise.all([loadVisits(), loadChangeRequests()])
      .finally(() => setLoading(false));
  }, [token]);

  // Map change requests by visit key for quick lookup
  const crByKey = {};
  changeRequests.forEach(cr => {
    // Match by date + start time + caregiver
    const key = `${cr.visit_date}|${cr.original_start_time}|${cr.caregiver_id}`;
    crByKey[key] = cr;
  });

  const getRequestForVisit = (visit) => {
    const key = `${visit.scheduled_date}|${visit.start_time}|${visit.caregiver_id}`;
    return crByKey[key] || null;
  };

  // ── Open modals ─────────────────────────────────────────────────────────

  const openNote = (visit) => {
    setSelectedVisit(visit);
    setNoteText(visit.client_notes || '');
    setModal('note');
  };

  const openCancel = (visit) => {
    setSelectedVisit(visit);
    setCancelReason('');
    setModal('cancel');
  };

  const openReschedule = (visit) => {
    setSelectedVisit(visit);
    setSelectedSlot(null);
    setAvailSlots([]);
    setModal('reschedule');
    loadAvailability(visit.caregiver_id);
  };

  const closeModal = () => {
    setModal(null);
    setSelectedVisit(null);
    setSubmitting(false);
  };

  // ── API actions ─────────────────────────────────────────────────────────

  const submitNote = async () => {
    if (!noteText.trim()) return;
    setSubmitting(true);
    try {
      await apiCall('/api/client-portal/portal/visits/note', {
        method: 'PUT',
        body: JSON.stringify({ ...visitPayload(selectedVisit), note: noteText.trim() }),
      }, token);
      // Update local state
      setVisits(prev => prev.map(v =>
        v.id === selectedVisit.id ? { ...v, client_notes: noteText.trim() } : v
      ));
      closeModal();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const submitCancel = async () => {
    setSubmitting(true);
    try {
      await apiCall('/api/client-portal/portal/visits/cancel-request', {
        method: 'POST',
        body: JSON.stringify({ ...visitPayload(selectedVisit), reason: cancelReason.trim() || null }),
      }, token);
      await loadChangeRequests();
      closeModal();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const loadAvailability = async (caregiverId) => {
    setSlotsLoading(true);
    try {
      const data = await apiCall(
        `/api/client-portal/portal/caregivers/${caregiverId}/availability`,
        { method: 'GET' },
        token
      );
      setAvailSlots(data || []);
    } catch {
      setAvailSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  };

  const submitReschedule = async () => {
    if (!selectedSlot) return;
    setSubmitting(true);
    try {
      await apiCall('/api/client-portal/portal/visits/reschedule-request', {
        method: 'POST',
        body: JSON.stringify({
          ...visitPayload(selectedVisit),
          proposedDate: selectedSlot.date,
          proposedStartTime: selectedSlot.startTime,
          proposedEndTime: selectedSlot.endTime,
        }),
      }, token);
      await loadChangeRequests();
      closeModal();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const respondToCounter = async (crId, accept) => {
    setSubmitting(true);
    try {
      await apiCall(`/api/client-portal/portal/change-requests/${crId}/respond`, {
        method: 'PUT',
        body: JSON.stringify({ accept }),
      }, token);
      await Promise.all([loadVisits(), loadChangeRequests()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) return <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>Loading your schedule...</div>;
  if (error)   return <div className="alert alert-error">{error}</div>;

  // Group available slots by date for the reschedule picker
  const slotsByDate = {};
  availSlots.forEach(s => {
    if (!slotsByDate[s.date]) slotsByDate[s.date] = [];
    slotsByDate[s.date].push(s);
  });

  return (
    <div>
      <h2 style={{ margin: '0 0 20px', fontSize: '1.3rem', color: '#1a5276' }}>
        Upcoming Visits
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
          {visits.map(visit => {
            const cr = getRequestForVisit(visit);
            const hasPending = cr && (cr.status === 'pending' || cr.status === 'counter_offered');
            const isCounterOffer = cr && cr.status === 'counter_offered';

            return (
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
                {/* Header: date + status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: '#1a5276', marginBottom: '4px' }}>
                      {dayLabel(visit.scheduled_date)}
                    </div>
                    <div style={{ color: '#555', fontSize: '0.9rem' }}>
                      {formatTime(visit.start_time)} – {formatTime(visit.end_time)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {hasPending && requestBadge(cr)}
                    {statusBadge(visit.status)}
                  </div>
                </div>

                {/* Caregiver info */}
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

                {/* Notes */}
                {visit.notes && (
                  <div style={{
                    marginTop: '12px', background: '#f8f9fa',
                    borderRadius: '8px', padding: '10px 14px',
                    fontSize: '0.85rem', color: '#555',
                  }}>
                    {visit.notes}
                  </div>
                )}
                {visit.client_notes && (
                  <div style={{
                    marginTop: '8px', background: '#eaf4fd',
                    borderRadius: '8px', padding: '10px 14px',
                    fontSize: '0.85rem', color: '#1a5276',
                  }}>
                    <span style={{ fontWeight: 600 }}>Your note:</span> {visit.client_notes}
                  </div>
                )}

                {/* Counter-offer display */}
                {isCounterOffer && (
                  <div style={{
                    marginTop: '12px', background: '#f5eeff', border: '1px solid #d4b8f0',
                    borderRadius: '10px', padding: '14px',
                  }}>
                    <div style={{ fontWeight: 700, color: '#7d3c98', fontSize: '0.9rem', marginBottom: '6px' }}>
                      Your caregiver suggested a different time:
                    </div>
                    <div style={{ fontWeight: 600, color: '#333', marginBottom: '4px' }}>
                      {formatShortDate(cr.counter_date)} &middot; {formatTime(cr.counter_start_time)} – {formatTime(cr.counter_end_time)}
                    </div>
                    {cr.counter_message && (
                      <div style={{ fontSize: '0.85rem', color: '#555', marginBottom: '10px', fontStyle: 'italic' }}>
                        "{cr.counter_message}"
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button style={primaryBtn} disabled={submitting} onClick={() => respondToCounter(cr.id, true)}>
                        Accept
                      </button>
                      <button style={secondaryBtn} disabled={submitting} onClick={() => respondToCounter(cr.id, false)}>
                        Decline
                      </button>
                    </div>
                  </div>
                )}

                {/* Action buttons — only on future scheduled visits without pending requests */}
                {visit.status === 'scheduled' && !hasPending && (
                  <div style={{
                    marginTop: '14px', paddingTop: '14px',
                    borderTop: '1px solid #f0f0f0',
                    display: 'flex', gap: '8px', flexWrap: 'wrap',
                  }}>
                    <button style={actionBtn('#2980b9')} onClick={() => openNote(visit)}>
                      Add Note
                    </button>
                    <button style={actionBtn('#e67e22')} onClick={() => openReschedule(visit)}>
                      Reschedule
                    </button>
                    <button style={actionBtn('#c0392b')} onClick={() => openCancel(visit)}>
                      Request Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Note Modal ─────────────────────────────────────────────────────── */}
      {modal === 'note' && selectedVisit && (
        <Overlay onClose={closeModal}>
          <h3 style={{ margin: '0 0 4px', color: '#1a5276' }}>Add a Note</h3>
          <p style={{ margin: '0 0 16px', color: '#666', fontSize: '0.85rem' }}>
            {dayLabel(selectedVisit.scheduled_date)} &middot; {formatTime(selectedVisit.start_time)} – {formatTime(selectedVisit.end_time)}
          </p>
          <textarea
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            placeholder="Write a note for your caregiver..."
            rows={4}
            style={{
              width: '100%', padding: '12px', borderRadius: '8px',
              border: '1px solid #ddd', fontSize: '0.9rem', resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button style={secondaryBtn} onClick={closeModal}>Cancel</button>
            <button style={primaryBtn} disabled={submitting || !noteText.trim()} onClick={submitNote}>
              {submitting ? 'Saving...' : 'Save Note'}
            </button>
          </div>
        </Overlay>
      )}

      {/* ── Cancel Modal ───────────────────────────────────────────────────── */}
      {modal === 'cancel' && selectedVisit && (
        <Overlay onClose={closeModal}>
          <h3 style={{ margin: '0 0 4px', color: '#c0392b' }}>Request Cancellation</h3>
          <p style={{ margin: '0 0 16px', color: '#666', fontSize: '0.85rem' }}>
            {dayLabel(selectedVisit.scheduled_date)} &middot; {formatTime(selectedVisit.start_time)} – {formatTime(selectedVisit.end_time)}
            <br />with {selectedVisit.caregiver_first_name} {selectedVisit.caregiver_last_name}
          </p>
          <p style={{ margin: '0 0 12px', color: '#888', fontSize: '0.82rem' }}>
            Your caregiver will be notified and will need to approve. The visit stays on your schedule until then.
          </p>
          <textarea
            value={cancelReason}
            onChange={e => setCancelReason(e.target.value)}
            placeholder="Reason for cancellation (optional)"
            rows={3}
            style={{
              width: '100%', padding: '12px', borderRadius: '8px',
              border: '1px solid #ddd', fontSize: '0.9rem', resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button style={secondaryBtn} onClick={closeModal}>Go Back</button>
            <button style={dangerBtn} disabled={submitting} onClick={submitCancel}>
              {submitting ? 'Submitting...' : 'Request Cancellation'}
            </button>
          </div>
        </Overlay>
      )}

      {/* ── Reschedule Modal ───────────────────────────────────────────────── */}
      {modal === 'reschedule' && selectedVisit && (
        <Overlay onClose={closeModal}>
          <h3 style={{ margin: '0 0 4px', color: '#1a5276' }}>Request Reschedule</h3>
          <p style={{ margin: '0 0 4px', color: '#666', fontSize: '0.85rem' }}>
            Currently: {dayLabel(selectedVisit.scheduled_date)} &middot; {formatTime(selectedVisit.start_time)} – {formatTime(selectedVisit.end_time)}
          </p>
          <p style={{ margin: '0 0 16px', color: '#888', fontSize: '0.82rem' }}>
            Pick an available time below. Your caregiver can approve, deny, or suggest a different time.
          </p>

          {slotsLoading ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#888' }}>Loading availability...</div>
          ) : Object.keys(slotsByDate).length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '24px', color: '#888',
              background: '#f8f9fa', borderRadius: '10px',
            }}>
              No available time slots found in the next 2 weeks.
              <br /><span style={{ fontSize: '0.82rem' }}>Contact your care coordinator for help.</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '300px', overflowY: 'auto' }}>
              {Object.entries(slotsByDate).map(([date, slots]) => (
                <div key={date}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#1a5276', marginBottom: '6px' }}>
                    {DOW_NAMES[new Date(date + 'T00:00:00').getDay()]} &middot; {formatShortDate(date)}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {slots.map((slot, i) => {
                      const isSelected = selectedSlot &&
                        selectedSlot.date === slot.date &&
                        selectedSlot.startTime === slot.startTime;
                      return (
                        <button
                          key={i}
                          onClick={() => setSelectedSlot(slot)}
                          style={{
                            background: isSelected ? '#1a5276' : '#f0f7fd',
                            color: isSelected ? '#fff' : '#1a5276',
                            border: isSelected ? '2px solid #1a5276' : '1px solid #c8ddf0',
                            padding: '8px 14px', borderRadius: '8px',
                            cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
                          }}
                        >
                          {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {selectedSlot && (
            <div style={{
              marginTop: '16px', padding: '12px', background: '#eafaf1',
              borderRadius: '8px', fontSize: '0.88rem', color: '#1e8449', fontWeight: 600,
            }}>
              New time: {formatShortDate(selectedSlot.date)} &middot; {formatTime(selectedSlot.startTime)} – {formatTime(selectedSlot.endTime)}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button style={secondaryBtn} onClick={closeModal}>Cancel</button>
            <button style={primaryBtn} disabled={submitting || !selectedSlot} onClick={submitReschedule}>
              {submitting ? 'Submitting...' : 'Request Reschedule'}
            </button>
          </div>
        </Overlay>
      )}
    </div>
  );
};

export default PortalVisits;
