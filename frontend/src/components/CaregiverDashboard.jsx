// src/components/CaregiverDashboard.jsx
// Enhanced with self-service: availability, open shifts pickup, time off requests
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../config';
import { toast } from './Toast';
import CaregiverClientModal from './CaregiverClientModal';
import MileageTracker from './MileageTracker';
import ShiftMissReport from './caregiver/ShiftMissReport';
import CaregiverHelp from './caregiver/CaregiverHelp';
import CaregiverMessages from './caregiver/CaregiverMessages';
import PaydayVerificationModal from './caregiver/PaydayVerificationModal';
import { useGeolocation, useHaptics, useOfflineSync, useBackgroundGeolocation, getCurrentPositionOnce, isNative, platform } from '../hooks/useNative';
import { formatDate as fmtCalDate, formatDateTZ } from '../utils/datetime';
import CareTaskChecklist from './CareTaskChecklist';
import OfflineBanner from './OfflineBanner';
import SignaturePad from './SignaturePad';

// fetch that always settles — aborts after `ms` so a stalled request (TCP open
// but no response, common on flaky mobile data / captive WiFi) can never leave a
// clock-in/out button spinning grey forever. On timeout it throws so the caller's
// catch/finally runs and re-enables the button. Mirrors the "never trap the
// caregiver" guarantee that GPS already has.
const fetchWithTimeout = async (url, options = {}, ms = 20000) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('Request timed out — check your connection and try again.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

const subscribeToPush = async (token) => {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.ready;
    const vapidRes = await fetch(`${API_BASE_URL}/api/push/vapid-key`, { headers: { Authorization: `Bearer ${token}` } });
    if (!vapidRes.ok) return;
    const { publicKey } = await vapidRes.json();
    if (!publicKey || publicKey === 'PLACEHOLDER_REPLACE_WITH_REAL_KEY') return;
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: publicKey,
    });
    await fetch(`${API_BASE_URL}/api/push/subscribe`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription }),
    });
  } catch (e) {
    console.log('[Push] subscription skipped:', e.message);
  }
};

const CaregiverDashboard = ({ user, token, onLogout }) => {
  const [currentPage, setCurrentPage] = useState('home');
  const [schedules, setSchedules] = useState([]);
  const [clients, setClients] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [visitNote, setVisitNote] = useState('');
  const [showNoteModal, setShowNoteModal] = useState(false);
  // Set when the server rejects a clock-out because a note is required (VA clients). Keeps
  // the note modal open with a clear message instead of closing on a generic error toast.
  const [noteError, setNoteError] = useState('');
  // Visit photos staged for upload on clock-out
  const [pendingPhotos, setPendingPhotos] = useState([]); // [{ dataUri, caption, category, sizeBytes }]
  const [photoUploading, setPhotoUploading] = useState(false);
  // Unsigned documents queue
  const [unsignedDocs, setUnsignedDocs] = useState([]);
  const [signTarget, setSignTarget] = useState(null);
  // Shift swap requests (incoming to me + outgoing from me)
  const [swapRequests, setSwapRequests] = useState([]);
  const [swapModal, setSwapModal] = useState(null); // shift being offered for swap
  const [swapForm, setSwapForm] = useState({ targetCaregiverId: '', reason: '' });
  const [otherCaregivers, setOtherCaregivers] = useState([]);

  const loadSwapRequests = async () => {
    if (!user?.id) return;
    try {
      const r = await fetch(`${API_BASE_URL}/api/shift-swaps?userId=${user.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setSwapRequests(await r.json());
    } catch {}
  };

  const loadOtherCaregivers = async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/caregivers`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) {
        const all = await r.json();
        setOtherCaregivers((all || []).filter(c => c.id !== user?.id));
      }
    } catch {}
  };
  useEffect(() => { loadSwapRequests(); loadOtherCaregivers(); }, [user?.id]);

  const submitSwapRequest = async () => {
    if (!swapModal || !swapForm.targetCaregiverId) { toast('Pick a coworker to swap with', 'error'); return; }
    try {
      const r = await fetch(`${API_BASE_URL}/api/shift-swaps`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          scheduleId: swapModal.id,
          requestingCaregiverId: user.id,
          targetCaregiverId: swapForm.targetCaregiverId,
          reason: swapForm.reason || null,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed');
      toast('Swap request sent');
      setSwapModal(null); setSwapForm({ targetCaregiverId: '', reason: '' });
      loadSwapRequests();
    } catch (e) { toast(e.message, 'error'); }
  };

  const respondToSwap = async (req, accepted) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/shift-swaps/${req.id}/respond`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ accepted }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed');
      toast(accepted ? 'Swap accepted — admin approval pending' : 'Swap declined');
      loadSwapRequests();
    } catch (e) { toast(e.message, 'error'); }
  };

  const loadUnsignedDocs = async () => {
    if (!user?.id) return;
    try {
      const r = await fetch(`${API_BASE_URL}/api/documents/unsigned/${user.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setUnsignedDocs(await r.json());
    } catch { /* ignore */ }
  };
  useEffect(() => { loadUnsignedDocs(); }, [user?.id]);

  const submitDocSignature = async (dataUri, typedName) => {
    if (!signTarget) return;
    const r = await fetch(`${API_BASE_URL}/api/documents/${signTarget.id}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ signatureImageBase64: dataUri, typedName }),
    });
    if (!r.ok) throw new Error((await r.json()).error || 'Sign failed');
    toast('Signed ✓');
    setSignTarget(null);
    loadUnsignedDocs();
  };
  const [recentVisits, setRecentVisits] = useState([]);
  const [viewingClientId, setViewingClientId] = useState(null);
  const timerRef = useRef(null);

  // Native GPS — works on web AND iOS/Android
  const { position: location, error: locationError, getPosition } = useGeolocation({ watch: true });
  const { impact, notification: hapticNotify } = useHaptics();
  const { online, queueCount } = useOfflineSync();
  const { start: startBgGeo } = useBackgroundGeolocation();

  // Self-service state
  const [openShifts, setOpenShifts] = useState([]);
  const [myHoursThisWeek, setMyHoursThisWeek] = useState(0);
  const [availability, setAvailability] = useState({
    status: 'available',
    maxHoursPerWeek: 40,
    weeklyAvailability: {
      0: { available: false, start: '09:00', end: '17:00' },
      1: { available: true, start: '09:00', end: '17:00' },
      2: { available: true, start: '09:00', end: '17:00' },
      3: { available: true, start: '09:00', end: '17:00' },
      4: { available: true, start: '09:00', end: '17:00' },
      5: { available: true, start: '09:00', end: '17:00' },
      6: { available: false, start: '09:00', end: '17:00' }
    },
    notes: ''
  });
  const [timeOffRequests, setTimeOffRequests] = useState([]);
  const [newTimeOff, setNewTimeOff] = useState({ startDate: '', endDate: '', type: 'vacation', reason: '' });
  const [message, setMessage] = useState({ text: '', type: '' });
  const [showMissReport, setShowMissReport] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showMessages, setShowMessages] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [pendingVerification, setPendingVerification] = useState(null);
  const [showMoreDrawer, setShowMoreDrawer] = useState(false);
  const [showAllClients, setShowAllClients] = useState(false);
  const [changeRequests, setChangeRequests] = useState([]);
  const [crResolving, setCrResolving]       = useState(null);

  // Ref to hold a setter so background geo can push updates into geofence check
  const bgLocationRef = React.useRef(null);

  useEffect(() => {
    loadData();
    // GPS tracking handled by useGeolocation hook (watch: true)
    subscribeToPush(token);
    // Start background geolocation on Android so geofence works when screen is off
    startBgGeo({
      notificationTitle: 'CVHC HomeCare',
      notificationText: 'Monitoring location for auto clock-in',
      onLocation: (loc) => {
        // Background location updates trigger a geofence check using latest refs
        if (loc && (loc.latitude || loc.lat)) {
          bgLocationRef.current = loc;
          runGeofenceCheck(
            loc,
            activeSessionRef.current,
            clientsRef.current,
            schedulesRef.current
          );
        }
      }
    });
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Poll for unread messages
  useEffect(() => {
    const checkUnread = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/messages/unread-count`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.status === 429) return; // rate limited - skip
        if (res.ok) { const data = await res.json(); setUnreadMessages(data.count); }
      } catch (e) { }
    };
    checkUnread();
    const interval = setInterval(checkUnread, 90000);
    return () => clearInterval(interval);
  }, [token]);

  // Check for pending payday verification on login (and whenever dashboard remounts)
  useEffect(() => {
    const checkPendingVerification = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/payroll/caregiver/me/pending-verification`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.pending) setPendingVerification(data.pending);
      } catch (e) { }
    };
    checkPendingVerification();
  }, [token]);

  useEffect(() => {
    if (activeSession) {
      timerRef.current = setInterval(() => {
        const start = new Date(activeSession.start_time);
        const now = new Date();
        setElapsedTime(Math.floor((now - start) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsedTime(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeSession]);

  useEffect(() => {
    if (window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
  }, [currentPage]);

  useEffect(() => {
    if (currentPage === 'open-shifts') loadOpenShifts();
    if (currentPage === 'availability') loadAvailability();
    if (currentPage === 'time-off') loadTimeOffRequests();
  }, [currentPage]);

  const loadData = async () => {
    try {
      const [schedulesRes, clientsRes, activeRes, visitsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/schedules/${user.id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/clients`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_BASE_URL}/api/time-entries/active`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => ({ ok: false })),
        fetch(`${API_BASE_URL}/api/time-entries/recent?limit=10`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => ({ ok: false }))
      ]);

      if (schedulesRes.ok) setSchedules(await schedulesRes.json());
      if (clientsRes.ok) {
        const clientData = await clientsRes.json();
        setClients(clientData);
        if (!clientData || clientData.length === 0) {
          console.warn('[CaregiverDashboard] No clients returned from API');
        }
      } else {
        console.error('[CaregiverDashboard] Failed to load clients:', clientsRes.status);
      }
      if (activeRes.ok) {
        const data = await activeRes.json();
        if (data?.id) {
          setActiveSession(data);
          setSelectedClient(data.client_id);
        }
      }
      if (visitsRes.ok) setRecentVisits(await visitsRes.json());
      loadMyHours();
      loadChangeRequests();
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadChangeRequests = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/client-portal/admin/change-requests?status=pending`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setChangeRequests(Array.isArray(data) ? data : []);
      }
    } catch (e) { /* silently skip if table doesn't exist yet */ }
  };

  const resolveChangeRequest = async (crId, action, extra = {}) => {
    setCrResolving(crId);
    try {
      const res = await fetch(`${API_BASE_URL}/api/client-portal/admin/change-requests/${crId}/resolve`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      if (res.ok) {
        toast('Request resolved', 'success');
        loadChangeRequests();
      } else {
        const err = await res.json().catch(() => ({}));
        toast(err.error || 'Failed to resolve', 'error');
      }
    } catch (e) {
      toast('Network error', 'error');
    } finally {
      setCrResolving(null);
    }
  };

  const loadOpenShifts = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/open-shifts/available`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setOpenShifts(await res.json());
    } catch (error) {
      console.error('Failed to load open shifts:', error);
    }
  };

  const loadAvailability = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/caregivers/${user.id}/availability`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data) {
          setAvailability(prev => ({
            status: data.status || prev.status,
            maxHoursPerWeek: data.max_hours_per_week || prev.maxHoursPerWeek,
            weeklyAvailability: data.weekly_availability ? 
              (typeof data.weekly_availability === 'string' ? JSON.parse(data.weekly_availability) : data.weekly_availability) 
              : prev.weeklyAvailability,
            notes: data.notes || ''
          }));
        }
      }
    } catch (error) {
      console.error('Failed to load availability:', error);
    }
  };

  const loadTimeOffRequests = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/time-off/my`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setTimeOffRequests(await res.json());
    } catch (error) {
      console.error('Failed to load time off:', error);
    }
  };

  const loadMyHours = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/scheduling/caregiver-hours/${user.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMyHoursThisWeek(parseFloat(data.totalHours) || 0);
      }
    } catch (error) {
      console.error('Failed to load hours:', error);
    }
  };

  const showMsg = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 4000);
  };

  // startGPSTracking removed — GPS handled by useGeolocation hook

  // Push GPS breadcrumbs every 60 seconds during active shift
  const startGPSBreadcrumbs = (sessionId) => {
    if (!("geolocation" in navigator)) return;
    const interval = setInterval(() => {
      // GPS breadcrumb
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          fetch(`${API_BASE_URL}/api/time-entries/${sessionId}/gps`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
            body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, speed: pos.coords.speed, heading: pos.coords.heading })
          }).catch(() => {});
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000 }
      );

      // 15-minute shift warning check (runs every 60s alongside GPS)
      fetch(`${API_BASE_URL}/api/time-entries/check-warnings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ timeEntryId: sessionId })
      })
      .then(r => { if (!r.ok) throw new Error('check-warnings failed'); return r.json(); })
      .then(d => {
        if (d.warning && !d.overTime) {
          toast(`⏰ ${d.minutesRemaining} min remaining — start wrapping up your shift!`, 'warning');
        } else if (d.warning && d.overTime) {
          toast(`⚠️ You are ${d.minutesOver} min over your scheduled time — please clock out`, 'error');
        }
      })
      .catch(() => {});

    }, 60000); // every 60s
    return interval;
  };
  const gpsIntervalRef = React.useRef(null);
  const geofenceIntervalRef = React.useRef(null);
  const geofenceTriggeredRef = React.useRef(new Set()); // track which clients we've already auto-clocked for
  const geofenceOutsideCountRef = React.useRef(new Map()); // debounce: consecutive outside-geofence checks per client

  // Refs to hold latest state for use inside intervals (avoids stale closures)
  const locationRef = React.useRef(null);
  const activeSessionRef = React.useRef(null);
  const clientsRef = React.useRef([]);
  const schedulesRef = React.useRef([]);
  useEffect(() => { locationRef.current = location; }, [location]);
  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);
  useEffect(() => { clientsRef.current = clients; }, [clients]);
  useEffect(() => { schedulesRef.current = schedules; }, [schedules]);


  // ── GEOFENCE AUTO CLOCK-IN/OUT ────────────────────────────────────────────
  const runGeofenceCheck = async (currentLocation, currentSession, currentClients, currentSchedules) => {
    if (!currentLocation?.lat && !currentLocation?.latitude) return;
    const lat = currentLocation.lat || currentLocation.latitude;
    const lng = currentLocation.lng || currentLocation.longitude;

    const now = new Date();
    const todayDay = new Date().getDay();

    // Prefer clients scheduled for today; fall back to ALL assigned clients
    // so geofence works even when no schedule entry exists yet
    const todayDate = new Date(now); todayDate.setHours(0,0,0,0);
    const scheduledToday = (currentSchedules || [])
      .filter(s => {
        if (s.date) return new Date(s.date).toDateString() === now.toDateString();
        if (s.day_of_week === todayDay) return isScheduleActiveForDate(s, todayDate);
        return false;
      })
      .map(s => s.client_id)
      .filter(Boolean);

    const allClientIds = (currentClients || []).map(c => c.id).filter(Boolean);
    const clientsToCheck = scheduledToday.length ? scheduledToday : allClientIds;

    if (!clientsToCheck.length) return;

    for (const clientId of clientsToCheck) {
      const alreadyTriggered = geofenceTriggeredRef.current.has(clientId);

      try {
        const res = await fetch(`${API_BASE_URL}/api/route-optimizer/geofence/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ clientId, latitude: lat, longitude: lng })
        });
        if (!res.ok) continue;
        const data = await res.json();

        // AUTO CLOCK-IN: within geofence, not clocked in, not already triggered
        if (data.withinGeofence) {
          // Reset outside-geofence counter whenever we're inside
          geofenceOutsideCountRef.current.delete(clientId);
        }
        // Proximity alone must NOT auto-clock-in: a caregiver near a client's home
        // when they aren't scheduled (driving by, working a different job nearby,
        // off the clock) was getting clocked in falsely. Require a real shift for
        // THIS client to be active now (15 min before start through end_time).
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const hasScheduledShiftNow = (currentSchedules || []).some(s => {
          if (s.client_id !== clientId || !s.start_time) return false;
          const onToday = s.date
            ? new Date(s.date).toDateString() === now.toDateString()
            : (s.day_of_week === todayDay && isScheduleActiveForDate(s, todayDate));
          if (!onToday) return false;
          const [sh, sm] = s.start_time.split(':').map(Number);
          const startMin = sh * 60 + sm;
          let endMin = startMin + 8 * 60; // fallback when no end_time recorded
          if (s.end_time) {
            const [eh, em] = s.end_time.split(':').map(Number);
            endMin = eh * 60 + em;
            if (endMin <= startMin) endMin += 24 * 60; // overnight shift
          }
          return nowMin >= startMin - 15 && nowMin <= endMin;
        });
        if (data.withinGeofence && data.autoClockIn && !currentSession && !alreadyTriggered && hasScheduledShiftNow) {
          geofenceTriggeredRef.current.add(clientId);
          // Auto clock in
          const clockRes = await fetch(`${API_BASE_URL}/api/time-entries/clock-in`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ clientId, latitude: lat, longitude: lng, autoClockIn: true })
          });
          if (clockRes.ok) {
            const clockData = await clockRes.json();
            toast(`📍 You've arrived at ${data.clientName} — clocked in automatically`, 'success');
            setActiveSession(clockData);
            setSelectedClient(clientId);
            gpsIntervalRef.current = startGPSBreadcrumbs(clockData.id);
          } else {
            // Clock-in failed — remove from triggered set so it can retry
            geofenceTriggeredRef.current.delete(clientId);
          }
          break; // only clock into one client at a time
        }

        // AUTO SCHEDULE TRANSITION: clocked in but next scheduled shift has started for a different client
        if (currentSession && currentSession.client_id !== clientId) {
          const todaySchedules = (currentSchedules || []).filter(s => {
            if (s.date) return new Date(s.date).toDateString() === now.toDateString();
            if (s.day_of_week === todayDay) return isScheduleActiveForDate(s, new Date(now.getFullYear(), now.getMonth(), now.getDate()));
            return false;
          });

          // Find the next scheduled shift that should be active now
          const nowTime = now.getHours() * 60 + now.getMinutes();
          const nextShift = todaySchedules
            .filter(s => s.client_id === clientId && s.start_time)
            .find(s => {
              const [h, m] = s.start_time.split(':').map(Number);
              const startMin = h * 60 + m;
              // Shift has started (within window: start time to start + 30min)
              return nowTime >= startMin && nowTime <= startMin + 30;
            });

          if (nextShift && !geofenceTriggeredRef.current.has(`transition-${clientId}`)) {
            geofenceTriggeredRef.current.add(`transition-${clientId}`);
            // Get client name for the toast
            const nextClientName = data.clientName || 'next client';
            try {
              // Clock in to next client — backend auto-closes current session
              const clockRes = await fetch(`${API_BASE_URL}/api/time-entries/clock-in`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                  clientId,
                  latitude: lat,
                  longitude: lng,
                  autoTransition: true,
                  scheduleId: nextShift.id
                })
              });
              if (clockRes.ok) {
                const clockData = await clockRes.json();
                // Stop GPS breadcrumbs for old session, start for new
                if (gpsIntervalRef.current) clearInterval(gpsIntervalRef.current);
                gpsIntervalRef.current = startGPSBreadcrumbs(clockData.id);
                setActiveSession(clockData);
                setSelectedClient(clientId);
                toast(`🔄 Schedule transition — now clocked in for ${nextClientName}`, 'success');
                break;
              }
            } catch(e) {
              geofenceTriggeredRef.current.delete(`transition-${clientId}`);
            }
          }
        }

        // AUTO CLOCK-OUT: was within geofence but now left, currently clocked into this client
        // Require 3 consecutive outside-geofence checks (~90s) to prevent GPS jitter false clock-outs
        if (!data.withinGeofence && data.autoClockOut && currentSession?.client_id === clientId && alreadyTriggered) {
          const outsideCount = (geofenceOutsideCountRef.current.get(clientId) || 0) + 1;
          geofenceOutsideCountRef.current.set(clientId, outsideCount);
          if (outsideCount >= 3) {
            // Only auto clock-out if they've been there at least 10 minutes
            const sessionStart = new Date(currentSession.start_time);
            const minsElapsed = (now - sessionStart) / 60000;
            if (minsElapsed >= 10) {
              toast(`📍 You've left ${data.clientName}'s location — clocking you out automatically`, 'success');
              geofenceTriggeredRef.current.delete(clientId);
              geofenceOutsideCountRef.current.delete(clientId);
              setShowNoteModal(true); // prompt for visit note before clocking out
            }
          }
        }
      } catch(e) {
        // Silently fail — don't interrupt the caregiver
      }
    }
  };

  // Start geofence polling when location is available
  useEffect(() => {
    if (!location) return;
    // Run immediately on location change — use refs to avoid stale closures
    runGeofenceCheck(
      locationRef.current,
      activeSessionRef.current,
      clientsRef.current,
      schedulesRef.current
    );
    // Set up interval using refs so it always reads the latest state (no stale closure)
    if (!geofenceIntervalRef.current) {
      geofenceIntervalRef.current = setInterval(() => {
        runGeofenceCheck(
          locationRef.current,
          activeSessionRef.current,
          clientsRef.current,
          schedulesRef.current
        );
      }, 30000);
    }
    return () => {
      if (geofenceIntervalRef.current) {
        clearInterval(geofenceIntervalRef.current);
        geofenceIntervalRef.current = null;
      }
    };
  }, [location]); // only restart interval when location first becomes available

  const [clockingIn, setClockingIn] = useState(false);
  // Clock-out takes seconds (GPS snapshot + request) with no visual change — people
  // think the tap didn't register and tap again. Show a working state immediately.
  const [clockingOut, setClockingOut] = useState(false);
  const [gpsRetry, setGpsRetry] = useState(null); // { message, retryFn } when GPS hard-blocks a clock action

  // Robust GPS acquisition for clock-in/out. Tries in order:
  //   1. Cached watcher fix if recent (≤5 min) — instant
  //   2. Fast COARSE fix (WiFi/cell, accepts an OS fix ≤2 min old) — succeeds indoors
  //   3. High-accuracy GPS (20s timeout, still accepts an OS fix ≤1 min old) — outdoor
  // A coarse fix (~20-65m) is well inside the ~300ft EVV geofence, so we never block on
  // a cold satellite lock — that cold lock is the "GPS is taking too long" failure.
  // Returns { latitude, longitude, source } or throws an error with .code matching PositionError codes.
  const acquireLocationForClock = async ({ fast = false } = {}) => {
    // 1. Recent cached watcher fix
    const age = location?.timestamp ? Date.now() - location.timestamp : Infinity;
    if (location?.latitude && age < 300000) {
      return { latitude: location.latitude, longitude: location.longitude, source: 'cache' };
    }

    // 2. Fast coarse fix — accepts a recent OS last-known fix (works indoors)
    try {
      const p = await getCurrentPositionOnce({ highAccuracy: false, timeout: fast ? 5000 : 8000, maximumAge: 120000 });
      if (p?.latitude) return { latitude: p.latitude, longitude: p.longitude, source: 'coarse' };
    } catch (_) {
      // fall through to high-accuracy
    }

    // 3. High-accuracy GPS — longer timeout, but still accept a recent OS fix so we
    //    never hang waiting on a cold satellite lock. `fast` callers (clock-out)
    //    skip this so a missing fix surfaces in ~5s instead of ~28s.
    if (fast) { const e = new Error('GPS timeout'); e.code = 3; throw e; }
    const p = await getCurrentPositionOnce({ highAccuracy: true, timeout: 20000, maximumAge: 60000 });
    return { latitude: p?.latitude, longitude: p?.longitude, source: 'gps' };
  };

  // Best-effort location snapshot that can NEVER block or hang clock-in/out.
  // GPS is a "nice to have" for EVV — it must never stop a caregiver from clocking.
  // We race the location lookup against a hard wall-clock cap because the browser's
  // permission prompt does NOT count against the geolocation timeout (and Capacitor
  // on Android can ignore its own timeout) — so getCurrentPosition can hang forever
  // while the button sits grey. After `capMs` we just give up and return nulls.
  // Always resolves { latitude, longitude, error } (nulls if no fix); never throws,
  // never hangs. `error` keeps the PositionError code so the admin alert can say
  // "permission denied — fix her phone settings" instead of "unknown GPS error".
  const getLocationSnapshot = async (capMs = 6000) => {
    const hardCap = new Promise(resolve => setTimeout(() => resolve('cap'), capMs));
    try {
      const fix = await Promise.race([acquireLocationForClock({ fast: true }), hardCap]);
      if (fix?.latitude && fix?.longitude) {
        return { latitude: fix.latitude, longitude: fix.longitude, error: null };
      }
      return { latitude: null, longitude: null, error: { code: 3 } }; // hit the cap = timeout
    } catch (err) {
      // fall through to nulls — GPS must never block clocking — but keep the code
      return { latitude: null, longitude: null, error: { code: err?.code ?? 0 } };
    }
  };

  // Late-fix retries: when the clock-in snapshot missed (slow fix at the tap),
  // keep trying quietly for the first minute and stamp the entry via
  // /late-location. The server only fills a MISSING location, flags it
  // source:'delayed', and rejects after 15 min — clock-in itself never waits.
  const lateFixTimersRef = useRef([]);
  const cancelLateFixRetries = () => {
    lateFixTimersRef.current.forEach(clearTimeout);
    lateFixTimersRef.current = [];
  };
  const startLateFixRetries = (entryId) => {
    cancelLateFixRetries();
    [10000, 30000, 60000].forEach(delay => {
      lateFixTimersRef.current.push(setTimeout(async () => {
        try {
          const p = await getCurrentPositionOnce({ highAccuracy: true, timeout: 12000, maximumAge: 60000 });
          if (p?.latitude && p?.longitude) {
            cancelLateFixRetries(); // got one — later retries unnecessary
            await fetch(`${API_BASE_URL}/api/time-entries/${entryId}/late-location`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ latitude: p.latitude, longitude: p.longitude }),
            });
          }
        } catch (_) { /* next scheduled retry will try again */ }
      }, delay));
    });
  };
  useEffect(() => () => cancelLateFixRetries(), []); // clean up on unmount

  // Notify admins (fire-and-forget) when the caregiver hits a GPS hard block.
  const reportGpsFailure = (action, err, clientId) => {
    fetch(`${API_BASE_URL}/api/time-entries/gps-failure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action,
        errorCode: err?.code ?? 0,
        clientId: clientId || null
      })
    }).catch(() => {});
  };

  // Translate a GPS failure into a caregiver-actionable message.
  // Action describes what they were trying to do ("clock in" / "clock out").
  const gpsErrorMessage = (err, action) => {
    const code = err?.code;
    if (code === 1) {
      return `📍 Location permission is OFF — can't ${action}. Tap the 🔒 in your address bar (or Settings → Site permissions) → Location → Allow, then try again.`;
    }
    if (code === 2) {
      return `📍 Can't get a GPS fix — can't ${action}. Make sure phone Location is ON, step near a window or outside, then try again.`;
    }
    if (code === 3) {
      return `📍 GPS is taking too long — can't ${action}. Step outside or near a window and try again.`;
    }
    return `📍 GPS unavailable — can't ${action}. Make sure phone Location is ON and Chrome has Location permission, then try again.`;
  };

  const handleClockIn = async ({ skipGps = false } = {}) => {
    if (!selectedClient) return toast('Please select a client.');
    if (clockingIn) return;
    setClockingIn(true);

    try {
      // GPS is a best-effort EVV snapshot — it must NEVER block clock-in. Grab a
      // location if we can get one quickly (hard-capped, can't hang); otherwise
      // clock in anyway with no location and notify admins for reconciliation.
      let lat = null;
      let lng = null;
      if (!skipGps) {
        const snap = await getLocationSnapshot();
        lat = snap.latitude; lng = snap.longitude;
        if (!lat || !lng) reportGpsFailure('clock-in', snap.error, selectedClient);
      }

      await impact('medium'); // native haptic on button press

      const res = await fetchWithTimeout(`${API_BASE_URL}/api/time-entries/clock-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ clientId: selectedClient, latitude: lat, longitude: lng })
      });

      if (!res.ok) {
        // If offline, service worker queued it — res will have queued:true
        const data = await res.json();
        if (data.queued) {
          await hapticNotify('warning');
          toast('Clocked in offline — will sync when reconnected', 'warning');
          setActiveSession({ id: 'offline-' + Date.now(), offline: true });
          return;
        }
        throw new Error(data.error || 'Failed');
      }

      const clockInData = await res.json();
      await hapticNotify('success'); // success haptic
      setActiveSession(clockInData);
      gpsIntervalRef.current = startGPSBreadcrumbs(clockInData.id);
      if (!lat) {
        toast('Clocked in (location unavailable)', 'warning');
        startLateFixRetries(clockInData.id); // keep trying in the background
      }
    } catch (error) {
      await hapticNotify('error');
      toast('Failed to clock in: ' + error.message, 'error');
    } finally {
      setClockingIn(false);
    }
  };

  const handleClockOut = () => {
    if (!activeSession) return toast('No active session.');
    setShowNoteModal(true);
  };

  const completeClockOut = async ({ skipGps = false } = {}) => {
    // Guard: if the session went away (stale modal, reload, re-login), don't throw
    // on activeSession.id below — close the modal cleanly instead of trapping the user.
    if (!activeSession?.id) { toast('No active session — reopen and try again.', 'error'); setShowNoteModal(false); return; }
    if (clockingOut) return; // ignore re-taps while the first one is in flight
    setClockingOut(true);
    cancelLateFixRetries(); // shift is ending — stop any pending late-fix attempts
    try {
      await impact('heavy'); // strong haptic for clock out

      let lat = null;
      let lng = null;
      if (!skipGps) {
        // Same best-effort snapshot as clock-in — never strand a caregiver waiting
        // on GPS. Grab a fix if we can (hard-capped); otherwise clock out anyway
        // with no location and notify admins for EVV reconciliation.
        const snap = await getLocationSnapshot();
        lat = snap.latitude; lng = snap.longitude;
        if (!lat || !lng) reportGpsFailure('clock-out', snap.error, activeSession?.client_id || selectedClient);
      }

      const res = await fetchWithTimeout(`${API_BASE_URL}/api/time-entries/${activeSession.id}/clock-out`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ latitude: lat, longitude: lng, notes: visitNote })
      });

      if (!res.ok) {
        const data = await res.json();
        if (data.queued) {
          await hapticNotify('warning');
          toast('Clocked out offline — will sync when reconnected', 'warning');
          setActiveSession(null);
          setSelectedClient('');
          setVisitNote('');
          setNoteError('');
          setShowNoteModal(false);
          return;
        }
        // VA client with no note: keep the modal open so they can add one and retry,
        // rather than closing on a toast and making them start over.
        if (data.code === 'va_note_required') {
          await hapticNotify('warning');
          setNoteError(data.error || 'A visit note is required for this client.');
          return;
        }
        throw new Error(data.error || 'Failed');
      }

      // Clock-out succeeded — upload any staged visit photos before resetting
      if (pendingPhotos.length > 0 && activeSession?.id) {
        setPhotoUploading(true);
        let failed = 0;
        for (const p of pendingPhotos) {
          try {
            const pr = await fetch(`${API_BASE_URL}/api/time-entries/${activeSession.id}/photos`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
              body: JSON.stringify({ imageBase64: p.dataUri, caption: p.caption, category: p.category }),
            });
            if (!pr.ok) failed++;
          } catch { failed++; }
        }
        setPhotoUploading(false);
        if (failed > 0) toast(`${pendingPhotos.length - failed}/${pendingPhotos.length} photos uploaded`, 'warning');
      }

      await hapticNotify('success');
      setActiveSession(null);
      setSelectedClient('');
      setVisitNote('');
      setNoteError('');
      setPendingPhotos([]);
      setShowNoteModal(false);
      loadData();
    } catch (error) {
      await hapticNotify('error');
      toast('Failed to clock out: ' + error.message, 'error');
      setShowNoteModal(false); // never trap the caregiver in the notes modal on error
    } finally {
      setClockingOut(false);
    }
  };

  // Convert a file to a downscaled JPEG data URI to keep uploads small.
  // Max 1600px on longest edge, ~80% JPEG quality → typically 200-600KB.
  const handlePhotoFile = async (file, category = 'other') => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Pick an image file', 'error'); return; }
    if (file.size > 15_000_000) { toast('Photo too large (15MB max)', 'error'); return; }
    const img = new Image();
    const reader = new FileReader();
    const dataUrl = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = dataUrl; });
    const MAX = 1600;
    const scale = Math.min(1, MAX / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const compressed = canvas.toDataURL('image/jpeg', 0.82);
    const sizeBytes = Math.floor(compressed.length * 0.75);
    if (sizeBytes > 5_000_000) { toast('Photo too large after compression', 'error'); return; }
    setPendingPhotos(prev => [...prev, { dataUri: compressed, caption: '', category, sizeBytes }]);
  };

  const handlePickupShift = async (shiftId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/open-shifts/${shiftId}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      showMsg('Shift claimed!');
      loadOpenShifts();
      loadData();
    } catch (error) {
      showMsg(error.message, 'error');
    }
  };

  const handleSaveAvailability = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/caregiver-availability/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          status: availability.status,
          maxHoursPerWeek: availability.maxHoursPerWeek,
          weeklyAvailability: availability.weeklyAvailability,
          notes: availability.notes
        })
      });
      if (!res.ok) throw new Error('Failed');
      showMsg('Availability saved!');
    } catch (error) {
      showMsg(error.message, 'error');
    }
  };

  const handleRequestTimeOff = async (e) => {
    e.preventDefault();
    if (!newTimeOff.startDate || !newTimeOff.endDate) return showMsg('Select dates', 'error');

    try {
      const res = await fetch(`${API_BASE_URL}/api/time-off`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          startDate: newTimeOff.startDate,
          endDate: newTimeOff.endDate,
          type: newTimeOff.type,
          reason: newTimeOff.reason
        })
      });
      if (!res.ok) throw new Error('Failed');
      showMsg('Request submitted!');
      setNewTimeOff({ startDate: '', endDate: '', type: 'vacation', reason: '' });
      loadTimeOffRequests();
    } catch (error) {
      showMsg(error.message, 'error');
    }
  };

  const handleCancelTimeOff = async (id) => {
    if (!confirm('Cancel this time-off request?')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/time-off/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed');
      showMsg('Request cancelled');
      loadTimeOffRequests();
    } catch (error) {
      showMsg(error.message, 'error');
    }
  };

  const handlePageClick = (page) => {
    setCurrentPage(page);
    if (window.innerWidth <= 768) setSidebarOpen(false);
  };

  const getClientName = (id) => {
    const c = clients.find(c => c.id === id);
    return c ? `${c.first_name} ${c.last_name}` : 'Unknown';
  };

  const formatTime = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hr = parseInt(h);
    return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
  };

  const formatElapsed = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  // Calendar dates (shift_date, expiration_date, schedule date, time-off range) —
  // tz-safe via the shared helper; keeps the existing weekday/short-month format.
  const formatDate = (d) => d ? fmtCalDate(d, { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const getDayName = (n) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][n] || '';

  // Check if a recurring schedule is active for a given date (respects effective_date & biweekly)
  const isScheduleActiveForDate = (schedule, targetDate) => {
    if (schedule.effective_date) {
      const effDate = new Date(schedule.effective_date);
      effDate.setHours(0,0,0,0);
      const target = new Date(targetDate);
      target.setHours(0,0,0,0);
      if (target < effDate) return false;
    }
    if (schedule.frequency === 'biweekly' && schedule.anchor_date) {
      const anchor = new Date(schedule.anchor_date);
      const target = new Date(targetDate);
      const diffWeeks = Math.round((target - anchor) / (7 * 24 * 60 * 60 * 1000));
      if (diffWeeks % 2 !== 0) return false;
    }
    return true;
  };

  // Get today's appointments from schedules
  const getTodaysAppointments = () => {
    const today = new Date();
    today.setHours(0,0,0,0);
    const dayOfWeek = today.getDay();
    const todayStr = today.toISOString().split('T')[0];

    // Get recurring schedules for today's day of week (respecting frequency & effective_date)
    const recurring = schedules.filter(s => s.day_of_week === dayOfWeek && s.day_of_week !== null && !s.date && isScheduleActiveForDate(s, today));
    // Get one-time schedules for today's date
    const oneTime = schedules.filter(s => s.date && s.date.split('T')[0] === todayStr);

    return [...recurring, ...oneTime].sort((a, b) => {
      const timeA = a.start_time || '00:00';
      const timeB = b.start_time || '00:00';
      return timeA.localeCompare(timeB);
    });
  };

  const getClientById = (id) => clients.find(c => c.id === id);

  // RENDER PAGES
  const renderHomePage = () => {
    const todaysAppointments = getTodaysAppointments();

    // Compute "next up" — earliest shift today that hasn't started yet,
    // or the currently in-progress one. Used by the hero strip.
    const nowMs = Date.now();
    const todayStr = new Date().toISOString().split('T')[0];
    const ymd = new Date().toISOString().slice(0, 10);
    const shiftStartMs = (appt) => {
      const [h, m] = (appt.start_time || '00:00').split(':').map(Number);
      const d = new Date(ymd + 'T00:00:00');
      d.setHours(h || 0, m || 0, 0, 0);
      return d.getTime();
    };
    const shiftEndMs = (appt) => {
      const [h, m] = (appt.end_time || '00:00').split(':').map(Number);
      const d = new Date(ymd + 'T00:00:00');
      d.setHours(h || 0, m || 0, 0, 0);
      return d.getTime();
    };
    const inProgress = activeSession
      ? todaysAppointments.find(a => a.client_id === activeSession.client_id)
      : null;
    const nextUp = inProgress
      ? inProgress
      : todaysAppointments.find(a => shiftEndMs(a) >= nowMs);

    const formatGap = (ms) => {
      const mins = Math.round(ms / 60000);
      if (mins <= 0) return 'now';
      if (mins < 60) return `in ${mins}m`;
      const h = Math.floor(mins / 60); const m = mins % 60;
      return m ? `in ${h}h ${m}m` : `in ${h}h`;
    };

    return (
    <>
      {/* Next-up hero strip — what to do RIGHT NOW. Always at top. */}
      {todaysAppointments.length > 0 && (() => {
        if (inProgress) {
          const client = getClientById(inProgress.client_id);
          const overdue = nowMs > shiftEndMs(inProgress);
          return (
            <div style={{
              padding: '0.9rem 1.1rem', marginBottom: '1rem', borderRadius: 12,
              background: overdue ? 'linear-gradient(135deg,#DC2626 0%,#991B1B 100%)' : 'linear-gradient(135deg,#10B981 0%,#047857 100%)',
              color: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            }}>
              <div style={{ fontSize: '0.78rem', opacity: 0.9, fontWeight: 700, letterSpacing: 0.5 }}>
                {overdue ? '⚠️ ACTIVE SHIFT — OVERDUE' : '● CURRENTLY ON SHIFT'}
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: 2 }}>
                {client ? `${client.first_name} ${client.last_name}` : 'Unknown client'}
              </div>
              <div style={{ fontSize: '0.85rem', opacity: 0.95, marginTop: 2 }}>
                Scheduled {formatTime(inProgress.start_time)}–{formatTime(inProgress.end_time)}
                {overdue && ` · ${formatGap(nowMs - shiftEndMs(inProgress)).replace('in ','')} past end`}
              </div>
            </div>
          );
        }
        if (nextUp) {
          const client = getClientById(nextUp.client_id);
          const gap = shiftStartMs(nextUp) - nowMs;
          const startingSoon = gap > 0 && gap < 30 * 60 * 1000;
          return (
            <div style={{
              padding: '0.9rem 1.1rem', marginBottom: '1rem', borderRadius: 12,
              background: startingSoon ? 'linear-gradient(135deg,#F59E0B 0%,#D97706 100%)' : 'linear-gradient(135deg,#3B82F6 0%,#1D4ED8 100%)',
              color: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            }}>
              <div style={{ fontSize: '0.78rem', opacity: 0.9, fontWeight: 700, letterSpacing: 0.5 }}>
                {startingSoon ? '⏰ STARTING SOON' : 'NEXT UP'}
              </div>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: 2 }}>
                {client ? `${client.first_name} ${client.last_name}` : 'Unknown client'}
                <span style={{ marginLeft: 8, fontSize: '0.9rem', opacity: 0.9, fontWeight: 500 }}>{formatGap(gap)}</span>
              </div>
              <div style={{ fontSize: '0.85rem', opacity: 0.95, marginTop: 2 }}>
                {formatTime(nextUp.start_time)}–{formatTime(nextUp.end_time)}
                {client?.address && ` · ${client.address}${client.city ? ', ' + client.city : ''}`}
              </div>
            </div>
          );
        }
        // All shifts done for today
        return (
          <div style={{
            padding: '0.9rem 1.1rem', marginBottom: '1rem', borderRadius: 12,
            background: '#F3F4F6', color: '#374151', textAlign: 'center',
          }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>✅ All shifts complete for today</div>
            <div style={{ fontSize: '0.82rem', color: '#6B7280', marginTop: 2 }}>Nice work — check tomorrow's schedule below.</div>
          </div>
        );
      })()}

      {unreadMessages > 0 && (
        <div
          onClick={() => { setShowMessages(true); }}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: '1rem 1.25rem', marginBottom: '1rem',
            background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
            color: '#fff', borderRadius: '12px', cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(217, 119, 6, 0.3)'
          }}
        >
          <div style={{ fontSize: '2rem' }}>📨</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>
              You have {unreadMessages} new message{unreadMessages === 1 ? '' : 's'}
            </div>
            <div style={{ fontSize: '0.85rem', opacity: 0.95 }}>Tap to read — important updates from your office</div>
          </div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>›</div>
        </div>
      )}

      {/* Incoming swap requests — coworker wants to swap a shift WITH me */}
      {(() => {
        const incoming = swapRequests.filter(s => s.target_caregiver_id === user?.id && s.status === 'pending');
        if (!incoming.length) return null;
        return (
          <div className="card" style={{ marginBottom: '1rem', borderLeft: '4px solid #6366F1' }}>
            <div className="card-title" style={{ color: '#4338CA' }}>
              🔄 {incoming.length} shift swap request{incoming.length === 1 ? '' : 's'} for you
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
              {incoming.map(req => (
                <div key={req.id} style={{ padding: '0.6rem 0.75rem', background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 8 }}>
                  <div style={{ fontWeight: 600 }}>
                    {req.requesting_caregiver_first} {req.requesting_caregiver_last} wants you to take their shift
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#4338CA' }}>
                    {req.shift_date && formatDate(req.shift_date)}
                  </div>
                  {req.reason && <div style={{ fontSize: '0.82rem', color: '#374151', fontStyle: 'italic', marginTop: 4 }}>"{req.reason}"</div>}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button onClick={() => respondToSwap(req, true)} style={{ background: '#10B981', color: '#fff', border: 'none', padding: '0.4rem 0.8rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700 }}>✓ Take it</button>
                    <button onClick={() => respondToSwap(req, false)} style={{ background: '#fff', color: '#DC2626', border: '1px solid #FCA5A5', padding: '0.4rem 0.8rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem' }}>✕ Decline</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Unsigned documents queue */}
      {unsignedDocs.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem', borderLeft: '4px solid #DC2626' }}>
          <div className="card-title" style={{ color: '#DC2626' }}>
            ✍️ {unsignedDocs.length} document{unsignedDocs.length === 1 ? '' : 's'} need your signature
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
            {unsignedDocs.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.75rem', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: '#1F2937', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {d.name || d.document_name || d.file_name || 'Document'}
                  </div>
                  {d.description && <div style={{ fontSize: '0.8rem', color: '#6B7280' }}>{d.description}</div>}
                  {d.expiration_date && (
                    <div style={{ fontSize: '0.78rem', color: '#DC2626', marginTop: 2 }}>
                      Expires {formatDate(d.expiration_date)}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setSignTarget(d)}
                  style={{ background: '#2ABBA7', color: '#fff', border: 'none', borderRadius: 6, padding: '0.5rem 0.9rem', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem', marginLeft: 8 }}>
                  ✍️ Sign
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: '#fff', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.9rem', opacity: 0.9 }}>Hours This Week</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{Number(parseFloat(myHoursThisWeek || 0)).toFixed(2)}h</div>
          </div>
          <div style={{ fontSize: '3rem', opacity: 0.5 }}>⏱️</div>
        </div>
        {myHoursThisWeek > 35 && (
          <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'rgba(255,255,255,0.2)', borderRadius: '6px', fontSize: '0.85rem' }}>
            ⚠️ Approaching 40 hour limit
          </div>
        )}
      </div>

      {/* Today's Appointments Section */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="card-title">📅 Today's Appointments</div>
        {todaysAppointments.length === 0 ? (
          <p className="text-muted text-center" style={{ padding: '1rem 0' }}>No appointments scheduled for today</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {todaysAppointments.map((appt, idx) => {
              const client = getClientById(appt.client_id);
              const isCurrentClient = activeSession?.client_id === appt.client_id;
              return (
                <div 
                  key={appt.id || idx} 
                  style={{ 
                    padding: '1rem', 
                    borderRadius: '8px', 
                    background: isCurrentClient ? '#DBEAFE' : '#F9FAFB',
                    border: isCurrentClient ? '2px solid #2563eb' : '1px solid #E5E7EB'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '600', fontSize: '1.1rem', color: '#1F2937' }}>
                        {client ? `${client.first_name} ${client.last_name}` : 'Unknown Client'}
                        {isCurrentClient && <span style={{ marginLeft: '0.5rem', color: '#059669', fontSize: '0.85rem' }}>● Active</span>}
                      </div>
                      <div style={{ fontSize: '0.9rem', color: '#6B7280', marginTop: '0.25rem' }}>
                        🕐 {formatTime(appt.start_time)} - {formatTime(appt.end_time)}
                      </div>
                      {client && (
                        <div style={{ fontSize: '0.85rem', color: '#6B7280', marginTop: '0.5rem' }}>
                          {client.phone && <span>📞 {client.phone}</span>}
                          {client.address && <span style={{ marginLeft: client.phone ? '1rem' : 0 }}>📍 {client.address}{client.city ? `, ${client.city}` : ''}</span>}
                        </div>
                      )}
                      {appt.notes && (
                        <div style={{ fontSize: '0.85rem', color: '#4B5563', marginTop: '0.5rem', padding: '0.5rem', background: '#FEF3C7', borderRadius: '4px' }}>
                          📝 {appt.notes}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginLeft: '1rem' }}>
                      <button 
                        className="btn btn-sm" 
                        style={{ background: '#E5E7EB', color: '#374151', padding: '0.4rem 0.75rem' }}
                        onClick={() => setViewingClientId(appt.client_id)}
                      >
                        View
                      </button>
                      {!activeSession && (
                        <button 
                          className="btn btn-sm btn-primary" 
                          style={{ padding: '0.4rem 0.75rem' }}
                          onClick={() => setSelectedClient(appt.client_id)}
                        >
                          Select
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Client Change Requests */}
      {changeRequests.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem', borderLeft: '4px solid #e67e22' }}>
          <div className="card-title" style={{ color: '#e67e22' }}>Client Requests ({changeRequests.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {changeRequests.slice(0, 5).map(cr => (
              <div key={cr.id} style={{ padding: '1rem', borderRadius: '8px', background: '#FFF7ED', border: '1px solid #FED7AA' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontWeight: 600, color: '#1F2937' }}>
                      {cr.client_first_name} {cr.client_last_name}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#6B7280' }}>
                      {cr.request_type === 'cancel' ? 'Wants to cancel' : 'Wants to reschedule'} — {cr.visit_date}
                    </div>
                    {cr.cancel_reason && (
                      <div style={{ fontSize: '0.82rem', color: '#92400E', marginTop: '4px' }}>Reason: {cr.cancel_reason}</div>
                    )}
                    {cr.request_type === 'reschedule' && cr.proposed_date && (
                      <div style={{ fontSize: '0.82rem', color: '#1D4ED8', marginTop: '4px' }}>
                        Proposed: {cr.proposed_date} {cr.proposed_start_time?.slice(0,5)} - {cr.proposed_end_time?.slice(0,5)}
                      </div>
                    )}
                  </div>
                  <span style={{
                    background: cr.request_type === 'cancel' ? '#FEE2E2' : '#DBEAFE',
                    color: cr.request_type === 'cancel' ? '#991B1B' : '#1E40AF',
                    padding: '2px 8px', borderRadius: '10px', fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap',
                  }}>
                    {cr.request_type === 'cancel' ? 'Cancel' : 'Reschedule'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-sm"
                    style={{ background: '#059669', color: '#fff', padding: '0.35rem 0.75rem', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                    disabled={crResolving === cr.id}
                    onClick={() => resolveChangeRequest(cr.id, 'approve')}
                  >
                    Approve
                  </button>
                  <button
                    className="btn btn-sm"
                    style={{ background: '#DC2626', color: '#fff', padding: '0.35rem 0.75rem', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                    disabled={crResolving === cr.id}
                    onClick={() => resolveChangeRequest(cr.id, 'deny')}
                  >
                    Deny
                  </button>
                  {cr.request_type === 'reschedule' && (
                    <button
                      className="btn btn-sm"
                      style={{ background: '#7C3AED', color: '#fff', padding: '0.35rem 0.75rem', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                      disabled={crResolving === cr.id}
                      onClick={() => {
                        const counterDate = prompt('Suggest a different date (YYYY-MM-DD):');
                        const counterStart = prompt('Start time (HH:MM):');
                        const counterEnd = prompt('End time (HH:MM):');
                        const msg = prompt('Optional message to client:');
                        if (counterDate && counterStart && counterEnd) {
                          resolveChangeRequest(cr.id, 'counter', {
                            counterDate, counterStartTime: counterStart, counterEndTime: counterEnd, counterMessage: msg || ''
                          });
                        }
                      }}
                    >
                      Counter-Offer
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MOBILE-FIRST CLOCK-IN — Full prominent card */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {activeSession ? (
          // ACTIVE SESSION — big timer, center-stage
          <div style={{ textAlign: 'center', padding: '2rem 1.5rem', background: 'linear-gradient(135deg, #F0FDF4, #DCFCE7)' }}>
            {/* Stale session warning — if clocked in for 16+ hours, likely forgot to clock out */}
            {activeSession.start_time && ((new Date() - new Date(activeSession.start_time)) / 3600000) > 16 && (
              <div style={{ background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: '8px', padding: '0.75rem', marginBottom: '1rem', fontSize: '0.85rem', color: '#92400E' }}>
                This session has been open for {Math.round((new Date() - new Date(activeSession.start_time)) / 3600000)} hours.
                If you forgot to clock out, clock out now and contact your admin to correct the time.
              </div>
            )}
            <div style={{ fontSize: '0.9rem', color: '#166534', fontWeight: '600', marginBottom: '0.25rem' }}>
              🟢 Clocked In with {activeSession.client_name || getClientName(activeSession.client_id)}
            </div>
            <div style={{ fontSize: '4rem', fontWeight: '900', fontFamily: 'monospace', color: '#16A34A', lineHeight: 1.1, margin: '0.5rem 0' }}>
              {formatElapsed(elapsedTime)}
            </div>
            <div style={{ fontSize: '0.82rem', color: '#4B5563', marginBottom: '1.5rem' }}>
              {location ? `📍 GPS Active (±${location.accuracy?.toFixed(0)}m)` : '📍 Location unavailable'}
            </div>
            <button
              onClick={handleClockOut}
              style={{
                width: '100%', padding: '1.125rem', background: '#DC2626', color: '#fff',
                border: 'none', borderRadius: '12px', cursor: 'pointer',
                fontWeight: '800', fontSize: '1.15rem', letterSpacing: '0.02em',
                boxShadow: '0 4px 12px rgba(220,38,38,0.3)'
              }}
            >
              🛑 Clock Out
            </button>
            {activeSession.id && !String(activeSession.id).startsWith('offline-') && (
              <div style={{ marginTop: '1.25rem', background: '#fff', borderRadius: 12, padding: '0.25rem', textAlign: 'left' }}>
                <CareTaskChecklist token={token} timeEntryId={activeSession.id} />
              </div>
            )}
          </div>
        ) : (
          // CLOCK IN — prominent select + button
          <div style={{ padding: '1.5rem' }}>
            <div style={{ fontSize: '1.1rem', fontWeight: '800', color: '#111827', marginBottom: '1rem', textAlign: 'center' }}>
              ⏰ Ready to Start a Shift?
            </div>
            <div className="form-group" style={{ marginBottom: '0.875rem' }}>
              <label style={{ fontWeight: '700', fontSize: '0.9rem', color: '#374151' }}>Select Client *</label>
              <select
                value={selectedClient}
                onChange={(e) => setSelectedClient(e.target.value)}
                style={{ width: '100%', padding: '0.875rem', fontSize: '1rem', border: '2px solid #D1D5DB', borderRadius: '10px', background: '#fff', boxSizing: 'border-box' }}
              >
                <option value="">{clients.length === 0 ? 'No clients available — try refreshing' : 'Choose client...'}</option>
                {(() => {
                  const todayClientIds = getTodaysAppointments().map(a => a.client_id);
                  const todayClients = clients.filter(c => todayClientIds.includes(c.id));
                  const displayClients = showAllClients ? clients : (todayClients.length > 0 ? todayClients : clients);
                  return displayClients.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>);
                })()}
              </select>
              {(() => {
                const todayClientIds = getTodaysAppointments().map(a => a.client_id);
                const hasTodayClients = clients.some(c => todayClientIds.includes(c.id));
                if (!hasTodayClients) return null;
                return (
                  <button
                    type="button"
                    onClick={() => setShowAllClients(!showAllClients)}
                    style={{ background: 'none', border: 'none', color: '#6B7280', fontSize: '0.8rem', cursor: 'pointer', marginTop: '0.4rem', textDecoration: 'underline' }}
                  >
                    {showAllClients ? "Show today's clients only" : 'Show all clients'}
                  </button>
                );
              })()}
            </div>
            <div style={{ padding: '0.6rem 0.875rem', background: location ? '#F0FDF4' : '#F9FAFB', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85rem', color: location ? '#166534' : '#6B7280', border: `1px solid ${location ? '#BBF7D0' : '#E5E7EB'}` }}>
              {location ? `✅ GPS Active (±${location.accuracy?.toFixed(0)}m)` : locationError ? '⚠️ Location unavailable — you can still clock in' : '📍 Getting your location...'}
            </div>
            <button
              onClick={handleClockIn}
              disabled={clockingIn}
              style={{
                width: '100%', padding: '1.125rem',
                background: clockingIn ? '#9CA3AF' : selectedClient ? '#2ABBA7' : '#D1D5DB',
                color: clockingIn ? '#fff' : selectedClient ? '#fff' : '#9CA3AF',
                border: 'none', borderRadius: '12px',
                cursor: clockingIn ? 'wait' : 'pointer', fontWeight: '800', fontSize: '1.15rem',
                transition: 'all 0.15s',
                boxShadow: selectedClient && !clockingIn ? '0 4px 12px rgba(42,187,167,0.3)' : 'none'
              }}
            >
              {clockingIn ? '⏳ Clocking In...' : '▶️ Clock In'}
            </button>
          </div>
        )}
      </div>

      {/* Quick Actions row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginTop: '0.75rem' }}>
        <div className="card" style={{ textAlign: 'center', cursor: 'pointer', padding: '1rem' }} onClick={() => handlePageClick('open-shifts')}>
          <div style={{ fontSize: '1.6rem' }}>📋</div>
          <div style={{ fontWeight: '600', fontSize: '0.82rem' }}>Open Shifts</div>
        </div>
        <div className="card" style={{ textAlign: 'center', cursor: 'pointer', padding: '1rem' }} onClick={() => handlePageClick('availability')}>
          <div style={{ fontSize: '1.6rem' }}>⏰</div>
          <div style={{ fontWeight: '600', fontSize: '0.82rem' }}>Availability</div>
        </div>
        <div className="card" style={{ textAlign: 'center', cursor: 'pointer', padding: '1rem', background: '#FEF2F2', border: '1px solid #FCA5A5' }}
          onClick={() => setShowMissReport(true)}>
          <div style={{ fontSize: '1.6rem' }}>🚨</div>
          <div style={{ fontWeight: '600', fontSize: '0.82rem', color: '#DC2626' }}>Miss Report</div>
        </div>
        <div className="card" style={{ textAlign: 'center', cursor: 'pointer', padding: '1rem', background: '#EEF2FF', border: '1px solid #C7D2FE', position: 'relative' }}
          onClick={() => setShowMessages(true)}>
          <div style={{ fontSize: '1.6rem' }}>💬</div>
          <div style={{ fontWeight: '600', fontSize: '0.82rem', color: '#4338CA' }}>Messages</div>
          {unreadMessages > 0 && (
            <span style={{ position: 'absolute', top: '6px', right: '6px', background: '#EF4444', color: '#fff', borderRadius: '99px', fontSize: '0.62rem', fontWeight: '700', padding: '1px 6px', minWidth: '16px', textAlign: 'center' }}>{unreadMessages}</span>
          )}
        </div>
        <div className="card" style={{ textAlign: 'center', cursor: 'pointer', padding: '1rem', background: '#F0FDFB', border: '1px solid #A7F3D0' }}
          onClick={() => setShowHelp(true)}>
          <div style={{ fontSize: '1.6rem' }}>❓</div>
          <div style={{ fontWeight: '600', fontSize: '0.82rem', color: '#065F46' }}>Help</div>
        </div>
      </div>
    </>
    );
  };

  const renderOpenShiftsPage = () => (
    <>
      <div className="schedule-header"><h3>📋 Available Shifts</h3></div>
      {openShifts.length === 0 ? (
        <div className="card text-center"><p style={{ fontSize: '3rem', margin: '1rem 0' }}>✅</p><p className="text-muted">No open shifts</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {openShifts.map(shift => (
            <div key={shift.id} className="card" style={{ padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: '600' }}>{shift.client_first_name} {shift.client_last_name}</div>
                  <div style={{ fontSize: '0.9rem', color: '#666' }}>📅 {formatDate(shift.date)}</div>
                  <div style={{ fontSize: '0.9rem', color: '#666' }}>🕐 {formatTime(shift.start_time)} - {formatTime(shift.end_time)}</div>
                </div>
                <button className="btn btn-sm btn-primary" onClick={() => handlePickupShift(shift.id)}>Claim</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );

  const renderAvailabilityPage = () => (
    <>
      <div className="schedule-header"><h3>⏰ My Availability</h3></div>
      <div className="card">
        <div className="form-group">
          <label>Status</label>
          <select value={availability.status} onChange={(e) => setAvailability({ ...availability, status: e.target.value })}>
            <option value="available">✅ Available</option>
            <option value="limited">⚠️ Limited</option>
            <option value="unavailable">❌ Unavailable</option>
          </select>
        </div>
        <div className="form-group">
          <label>Max Hours/Week: {availability.maxHoursPerWeek}</label>
          <input type="range" min="0" max="60" value={availability.maxHoursPerWeek} onChange={(e) => setAvailability({ ...availability, maxHoursPerWeek: parseInt(e.target.value) })} style={{ width: '100%' }} />
        </div>
        <div className="form-group">
          <label>Weekly Schedule</label>
          {[0,1,2,3,4,5,6].map(day => {
            const d = availability.weeklyAvailability[day] || { available: false, start: '09:00', end: '17:00' };
            return (
              <div key={day} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', background: d.available ? '#D1FAE5' : '#F3F4F6', borderRadius: '6px', marginBottom: '0.25rem' }}>
                <input type="checkbox" checked={d.available} onChange={(e) => {
                  const u = { ...availability.weeklyAvailability };
                  u[day] = { ...d, available: e.target.checked };
                  setAvailability({ ...availability, weeklyAvailability: u });
                }} style={{ width: 'auto' }} />
                <span style={{ width: '60px', fontWeight: '500' }}>{getDayName(day).slice(0,3)}</span>
                {d.available && (
                  <>
                    <input type="time" value={d.start} onChange={(e) => {
                      const u = { ...availability.weeklyAvailability };
                      u[day] = { ...d, start: e.target.value };
                      setAvailability({ ...availability, weeklyAvailability: u });
                    }} style={{ padding: '0.25rem' }} />
                    <span>-</span>
                    <input type="time" value={d.end} onChange={(e) => {
                      const u = { ...availability.weeklyAvailability };
                      u[day] = { ...d, end: e.target.value };
                      setAvailability({ ...availability, weeklyAvailability: u });
                    }} style={{ padding: '0.25rem' }} />
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div className="form-group">
          <label>Notes</label>
          <textarea value={availability.notes} onChange={(e) => setAvailability({ ...availability, notes: e.target.value })} rows={2} placeholder="Any notes..." />
        </div>
        <button className="btn btn-primary btn-block" onClick={handleSaveAvailability}>💾 Save</button>
      </div>
    </>
  );

  const renderTimeOffPage = () => (
    <>
      <div className="schedule-header"><h3>🏖️ Time Off</h3></div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h4 style={{ margin: '0 0 1rem 0' }}>Request Time Off</h4>
        <form onSubmit={handleRequestTimeOff}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Start</label>
              <input type="date" value={newTimeOff.startDate} onChange={(e) => setNewTimeOff({ ...newTimeOff, startDate: e.target.value })} min={new Date().toISOString().split('T')[0]} required />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>End</label>
              <input type="date" value={newTimeOff.endDate} onChange={(e) => setNewTimeOff({ ...newTimeOff, endDate: e.target.value })} min={newTimeOff.startDate || new Date().toISOString().split('T')[0]} required />
            </div>
          </div>
          <div className="form-group">
            <label>Type</label>
            <select value={newTimeOff.type} onChange={(e) => setNewTimeOff({ ...newTimeOff, type: e.target.value })}>
              <option value="vacation">Vacation</option>
              <option value="sick">Sick Leave</option>
              <option value="personal">Personal</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="form-group">
            <label>Reason</label>
            <input type="text" value={newTimeOff.reason} onChange={(e) => setNewTimeOff({ ...newTimeOff, reason: e.target.value })} placeholder="Optional details..." />
          </div>
          <button type="submit" className="btn btn-primary">Submit Request</button>
        </form>
      </div>
      <div className="card">
        <h4 style={{ margin: '0 0 1rem 0' }}>My Requests</h4>
        {timeOffRequests.length === 0 ? <p className="text-muted text-center">No time-off requests</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {timeOffRequests.map(r => (
              <div key={r.id} style={{ padding: '0.75rem', borderRadius: '6px', background: r.status === 'approved' ? '#D1FAE5' : r.status === 'denied' ? '#FEE2E2' : '#FEF3C7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: '500' }}>{formatDate(r.start_date)} - {formatDate(r.end_date)}</div>
                  <div style={{ fontSize: '0.85rem', color: '#666' }}>
                    {(r.type || 'other').charAt(0).toUpperCase() + (r.type || 'other').slice(1)}
                    {r.reason ? ` — ${r.reason}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ padding: '0.25rem 0.75rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: '600', background: r.status === 'approved' ? '#059669' : r.status === 'denied' ? '#DC2626' : '#D97706', color: '#fff' }}>
                    {(r.status || 'pending').toUpperCase()}
                  </span>
                  {r.status === 'pending' && (
                    <button onClick={() => handleCancelTimeOff(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#DC2626', padding: '0.25rem' }} title="Cancel request">✕</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );

  const renderSchedulePage = () => {
    // Resolve ALL schedules (recurring + one-time) into concrete dated shifts
    // for the next 14 days — same logic the admin grid uses
    const today = new Date(); today.setHours(0,0,0,0);
    const todayStr = today.toISOString().split('T')[0];
    const concreteShifts = [];

    schedules.forEach(s => {
      if (s.date) {
        // One-time shift — include if today or future
        if (s.date.split('T')[0] >= todayStr) {
          concreteShifts.push({ ...s, resolvedDate: s.date.split('T')[0] });
        }
      } else if (s.day_of_week != null) {
        // Recurring template — expand into concrete dates for next 14 days
        for (let d = 0; d < 14; d++) {
          const target = new Date(today);
          target.setDate(target.getDate() + d);
          if (target.getDay() !== s.day_of_week) continue;
          if (!isScheduleActiveForDate(s, target)) continue;
          const dateStr = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
          concreteShifts.push({ ...s, resolvedDate: dateStr });
        }
      }
    });

    // Sort by date then time
    concreteShifts.sort((a, b) => a.resolvedDate.localeCompare(b.resolvedDate) || (a.start_time || '').localeCompare(b.start_time || ''));

    // Group by date
    const byDate = {};
    concreteShifts.forEach(s => {
      if (!byDate[s.resolvedDate]) byDate[s.resolvedDate] = [];
      byDate[s.resolvedDate].push(s);
    });

    const dateKeys = Object.keys(byDate).sort();
    const todayShifts = byDate[todayStr] || [];
    const upcomingKeys = dateKeys.filter(d => d > todayStr);

    const formatDateLabel = (dateStr) => {
      const d = new Date(dateStr + 'T12:00:00');
      return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    };

    // ── Week-at-a-glance: 7 days starting today, with totals per day
    const hoursOf = (s) => {
      const [sh, sm] = (s.start_time || '00:00').split(':').map(Number);
      const [eh, em] = (s.end_time   || '00:00').split(':').map(Number);
      let mins = (eh * 60 + em) - (sh * 60 + sm);
      if (mins < 0) mins += 24 * 60;
      return mins / 60;
    };
    const weekDays = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date(today); dt.setDate(today.getDate() + d);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const dayShifts = byDate[key] || [];
      const totalHrs = dayShifts.reduce((sum, s) => sum + hoursOf(s), 0);
      weekDays.push({ key, dt, shifts: dayShifts, totalHrs, isToday: d === 0 });
    }
    const weekTotalHrs = weekDays.reduce((s, d) => s + d.totalHrs, 0);

    return (
      <>
        <div className="schedule-header"><h3>📅 My Schedule</h3></div>

        {/* Week-at-a-glance strip */}
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', fontSize: '0.85rem', color: '#374151' }}>
            <strong>This Week</strong>
            <span>{weekTotalHrs.toFixed(1)}h total</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {weekDays.map(d => (
              <div key={d.key}
                style={{
                  padding: '6px 4px', textAlign: 'center', borderRadius: 6,
                  background: d.isToday ? '#DBEAFE' : (d.shifts.length > 0 ? '#F0FDF4' : '#F3F4F6'),
                  border: d.isToday ? '1px solid #93C5FD' : '1px solid transparent',
                  fontSize: '0.7rem',
                }}>
                <div style={{ fontWeight: 700, color: d.isToday ? '#1E40AF' : '#374151' }}>
                  {d.dt.toLocaleDateString('en-US', { weekday: 'short' })}
                </div>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#111827', marginTop: 2 }}>
                  {d.dt.getDate()}
                </div>
                {d.shifts.length > 0 ? (
                  <>
                    <div style={{ fontWeight: 700, color: '#059669', marginTop: 4 }}>{d.totalHrs.toFixed(1)}h</div>
                    <div style={{ color: '#6B7280' }}>{d.shifts.length} shift{d.shifts.length !== 1 ? 's' : ''}</div>
                  </>
                ) : (
                  <div style={{ color: '#9CA3AF', marginTop: 4 }}>off</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {concreteShifts.length === 0 ? (
          <div className="card text-center"><p className="text-muted">No upcoming shifts</p></div>
        ) : (
          <div>
            {/* Today's shifts */}
            {todayShifts.length > 0 && (
              <div className="card" style={{ marginBottom: '0.75rem', borderLeft: '4px solid #2563eb' }}>
                <div style={{ fontWeight: '600', color: '#2563eb', marginBottom: '0.5rem' }}>Today — {formatDateLabel(todayStr)}</div>
                {todayShifts.map((s, i) => (
                  <div key={s.id + '-' + i} style={{ padding: '0.5rem 0', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '500' }}>{getClientName(s.client_id)}</div>
                      <div style={{ fontSize: '0.9rem', color: '#666' }}>{formatTime(s.start_time)} - {formatTime(s.end_time)}</div>
                    </div>
                    <button onClick={() => { setSwapModal(s); setSwapForm({ targetCaregiverId: '', reason: '' }); }}
                      style={{ background: 'none', border: '1px solid #C7D2FE', color: '#4338CA', padding: '0.3rem 0.6rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}
                      title="Ask a coworker to take this shift">🔄 Swap</button>
                  </div>
                ))}
              </div>
            )}
            {/* Upcoming shifts grouped by date */}
            {upcomingKeys.map(dateStr => (
              <div key={dateStr} className="card" style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontWeight: '600', color: '#059669' }}>{formatDateLabel(dateStr)}</div>
                {byDate[dateStr].map((s, i) => (
                  <div key={s.id + '-' + i} style={{ padding: '0.5rem 0', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '500' }}>{getClientName(s.client_id)}</div>
                      <div style={{ fontSize: '0.9rem', color: '#666' }}>{formatTime(s.start_time)} - {formatTime(s.end_time)}</div>
                    </div>
                    <button onClick={() => { setSwapModal(s); setSwapForm({ targetCaregiverId: '', reason: '' }); }}
                      style={{ background: 'none', border: '1px solid #C7D2FE', color: '#4338CA', padding: '0.3rem 0.6rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}
                      title="Ask a coworker to take this shift">🔄 Swap</button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  const renderHistoryPage = () => (
    <div className="card">
      <div className="card-title">Recent Visits</div>
      {recentVisits.length === 0 ? <p className="text-muted text-center">None</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Date</th><th>Client</th><th>Hours</th></tr></thead>
            <tbody>
              {recentVisits.map((v, i) => (
                <tr key={v.id || i}>
                  <td>{formatDateTZ(v.start_time, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                  <td><span onClick={() => setViewingClientId(v.client_id)} style={{ cursor: 'pointer', color: '#007bff' }}>{v.client_name || getClientName(v.client_id)}</span></td>
                  <td>{v.hours_worked ? `${Number(parseFloat(v.hours_worked || 0)).toFixed(2)}h` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderClientsPage = () => {
    const myClients = clients.filter(c => schedules.some(s => s.client_id === c.id));
    return (
      <>
        <div className="schedule-header"><h3>👥 My Clients</h3></div>
        {myClients.length === 0 ? <div className="card text-center"><p className="text-muted">No clients</p></div> : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {myClients.map(c => (
              <div key={c.id} className="card" onClick={() => setViewingClientId(c.id)} style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h4 style={{ margin: 0 }}>{c.first_name} {c.last_name}</h4>
                    <p style={{ margin: '0.25rem 0 0 0', color: '#666', fontSize: '0.9rem' }}>📞 {c.phone || 'N/A'} • 📍 {c.city || 'N/A'}</p>
                  </div>
                  <span style={{ color: '#007bff', fontSize: '1.2rem' }}>→</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </>
    );
  };

  // ── IVR PIN state ──
  const [ivrPin, setIvrPin] = useState(null);
  useEffect(() => {
    if (user?.id && token) {
      fetch(`${API_BASE_URL}/api/caregivers`, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : []).then(list => {
          const me = Array.isArray(list) ? list.find(c => c.id === user.id) : null;
          if (me?.ivr_pin) setIvrPin(me.ivr_pin);
        }).catch(() => {});
    }
  }, [user?.id]);

  // ── Change Password state ──
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' });
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg] = useState({ text: '', type: '' });

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwMsg({ text: '', type: '' });
    if (pwForm.newPw !== pwForm.confirm) { setPwMsg({ text: 'Passwords do not match', type: 'error' }); return; }
    if (pwForm.newPw.length < 8) { setPwMsg({ text: 'Password must be at least 8 characters', type: 'error' }); return; }
    setPwLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/change-password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.newPw }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change password');
      setPwMsg({ text: 'Password changed successfully!', type: 'success' });
      setPwForm({ current: '', newPw: '', confirm: '' });
    } catch (err) {
      setPwMsg({ text: err.message, type: 'error' });
    } finally {
      setPwLoading(false);
    }
  };

  const renderSettingsPage = () => (
    <>
      <div className="card">
        <div className="card-title">Profile</div>
        <div className="form-group"><label>Name</label><input type="text" value={user.name || `${user.first_name} ${user.last_name}`} disabled /></div>
        <div className="form-group"><label>Email</label><input type="text" value={user.email} disabled /></div>
      </div>
      <div className="card">
        <div className="card-title">Change Password</div>
        {pwMsg.text && <div className={`alert ${pwMsg.type === 'error' ? 'alert-error' : 'alert-success'}`}>{pwMsg.text}</div>}
        <form onSubmit={handleChangePassword}>
          <div className="form-group">
            <label>Current Password</label>
            <input type="password" value={pwForm.current} onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))} required placeholder="Enter current password" />
          </div>
          <div className="form-group">
            <label>New Password</label>
            <input type="password" value={pwForm.newPw} onChange={e => setPwForm(f => ({ ...f, newPw: e.target.value }))} required placeholder="Min. 8 characters" minLength={8} />
          </div>
          <div className="form-group">
            <label>Confirm New Password</label>
            <input type="password" value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))} required placeholder="Confirm new password" minLength={8} />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={pwLoading}>
            {pwLoading ? 'Changing...' : 'Change Password'}
          </button>
        </form>
      </div>
      <div className="card">
        <div className="card-title">GPS Status</div>
        <div className={`alert ${location ? 'alert-success' : 'alert-info'}`}>
          {location ? <>GPS Active (±{location.accuracy?.toFixed(0)}m)</> : <>{locationError || 'Location unavailable'} - Clock in still works</>}
        </div>
      </div>
      {ivrPin && (
        <div className="card">
          <div className="card-title">Phone Clock-In (IVR)</div>
          <div style={{ fontSize: '0.88rem', color: '#374151', marginBottom: '0.5rem' }}>
            Can't use the app? Call in to clock in/out by phone.
          </div>
          <div style={{ background: '#EFF6FF', borderRadius: 8, padding: '0.75rem', textAlign: 'center' }}>
            <div style={{ fontSize: '0.78rem', color: '#6B7280', marginBottom: '0.25rem' }}>Your PIN</div>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: '#1E40AF', letterSpacing: '0.3rem' }}>{ivrPin}</div>
          </div>
          <div style={{ fontSize: '0.78rem', color: '#9CA3AF', marginTop: '0.5rem', textAlign: 'center' }}>
            Call your office Twilio number, enter this PIN, then the client's 3-digit code.
          </div>
        </div>
      )}
      <button className="btn btn-danger btn-block" onClick={onLogout}>Log Out</button>
    </>
  );

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      {message.text && (
        <div style={{ position: 'fixed', top: '1rem', right: '1rem', padding: '1rem 1.5rem', borderRadius: '8px', zIndex: 1001, background: message.type === 'error' ? '#FEE2E2' : '#D1FAE5', color: message.type === 'error' ? '#DC2626' : '#059669', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
          {message.text}
        </div>
      )}

      {gpsRetry && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2200, background: '#FEF2F2', borderBottom: '2px solid #FCA5A5', padding: '1rem 1.25rem', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
          <div style={{ maxWidth: '720px', margin: '0 auto' }}>
            <div style={{ color: '#991B1B', fontSize: '0.92rem', lineHeight: 1.4, marginBottom: '0.75rem' }}>
              {gpsRetry.message}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                onClick={gpsRetry.retryFn}
                style={{ background: '#2563EB', color: '#fff', border: 'none', borderRadius: '8px', padding: '0.6rem 1rem', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' }}
              >🔄 Try Again</button>
              {gpsRetry.forceFn && (
                <button
                  onClick={gpsRetry.forceFn}
                  style={{ background: '#fff', color: '#B45309', border: '1px solid #FCD34D', borderRadius: '8px', padding: '0.6rem 1rem', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' }}
                  title="Use only if GPS keeps failing — admin will be notified"
                >{gpsRetry.action === 'clock-in' ? 'Clock in anyway (no GPS)' : 'Clock out anyway (no GPS)'}</button>
              )}
              <button
                onClick={() => setGpsRetry(null)}
                style={{ background: 'none', color: '#6B7280', border: '1px solid #D1D5DB', borderRadius: '8px', padding: '0.6rem 1rem', fontSize: '0.9rem', fontWeight: 500, cursor: 'pointer' }}
              >Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {sidebarOpen && window.innerWidth <= 768 && <div className="sidebar-overlay active" onClick={() => setSidebarOpen(false)} />}

      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">CVHC</div>
        <ul className="sidebar-nav">
          <li><a href="#" className={currentPage === 'home' ? 'active' : ''} onClick={() => handlePageClick('home')}>🏠 Home</a></li>
          <li><a href="#" className={currentPage === 'schedule' ? 'active' : ''} onClick={() => handlePageClick('schedule')}>📅 Schedule</a></li>
          <li><a href="#" className={currentPage === 'clients' ? 'active' : ''} onClick={() => handlePageClick('clients')}>👥 Clients</a></li>
          <li><a href="#" className={currentPage === 'history' ? 'active' : ''} onClick={() => handlePageClick('history')}>📜 History</a></li>
          <li style={{ paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '0.5rem' }}>
            <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', display: 'block', padding: '0.5rem 1rem' }}>Self Service</span>
          </li>
          <li><a href="#" className={currentPage === 'open-shifts' ? 'active' : ''} onClick={() => handlePageClick('open-shifts')}>📋 Open Shifts</a></li>
          <li><a href="#" className={currentPage === 'availability' ? 'active' : ''} onClick={() => handlePageClick('availability')}>⏰ Availability</a></li>
          <li><a href="#" className={currentPage === 'client-requests' ? 'active' : ''} onClick={() => handlePageClick('client-requests')}>📩 Client Requests{changeRequests.length > 0 ? ` (${changeRequests.length})` : ''}</a></li>
          <li><a href="#" className={currentPage === 'miss-report' ? 'active' : ''} onClick={() => handlePageClick('miss-report')}>🚨 Report Miss</a></li>
          <li><a href="#" className={currentPage === 'time-off' ? 'active' : ''} onClick={() => handlePageClick('time-off')}>🏖️ Time Off</a></li>
          <li style={{ paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '0.5rem' }}>
            <a href="#" className={currentPage === 'settings' ? 'active' : ''} onClick={() => handlePageClick('settings')}>⚙️ Settings</a>
          </li>
        </ul>
        <div className="sidebar-user">
          <div className="sidebar-user-name">{user.name || `${user.first_name || ''} ${user.last_name || ''}`}</div>
          <div className="sidebar-user-role">Caregiver</div>
          <button className="btn-logout" onClick={onLogout}>Logout</button>
        </div>
      </div>

      <div className="main-content">
        <div className="header">
          <div><h1>Chippewa Valley Home Care</h1><p>Caregiver Portal</p></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button className="hamburger-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>Menu</button>
            <button
              onClick={onLogout}
              style={{
                padding: '0.4rem 0.85rem', borderRadius: '8px', border: 'none',
                background: '#FEE2E2', color: '#DC2626', fontWeight: '700',
                fontSize: '0.82rem', cursor: 'pointer', whiteSpace: 'nowrap'
              }}>
              ⏻ Logout
            </button>
          </div>
        </div>
        <div className="container">
          {currentPage === 'home' && renderHomePage()}
          {currentPage === 'schedule' && renderSchedulePage()}
          {currentPage === 'clients' && renderClientsPage()}
          {currentPage === 'history' && renderHistoryPage()}
          {currentPage === 'open-shifts' && renderOpenShiftsPage()}
          {currentPage === 'availability' && renderAvailabilityPage()}
          {currentPage === 'time-off' && renderTimeOffPage()}
          {currentPage === 'client-requests' && (
            <div>
              <h2 style={{ marginBottom: '1rem' }}>Client Requests</h2>
              {changeRequests.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#6B7280' }}>
                  No pending requests from clients.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {changeRequests.map(cr => (
                    <div key={cr.id} className="card" style={{ borderLeft: cr.request_type === 'cancel' ? '4px solid #DC2626' : '4px solid #2563EB' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '1.05rem', color: '#1F2937' }}>
                            {cr.client_first_name} {cr.client_last_name}
                          </div>
                          <div style={{ fontSize: '0.9rem', color: '#6B7280', marginTop: '2px' }}>
                            {cr.request_type === 'cancel' ? 'Cancellation Request' : 'Reschedule Request'}
                          </div>
                        </div>
                        <span style={{
                          background: cr.request_type === 'cancel' ? '#FEE2E2' : '#DBEAFE',
                          color: cr.request_type === 'cancel' ? '#991B1B' : '#1E40AF',
                          padding: '4px 10px', borderRadius: '12px', fontSize: '0.78rem', fontWeight: 600,
                        }}>
                          {cr.status}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
                        <div>
                          <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '2px' }}>ORIGINAL VISIT</div>
                          <div style={{ fontWeight: 600 }}>{cr.visit_date} {cr.original_start_time?.slice(0,5)} - {cr.original_end_time?.slice(0,5)}</div>
                        </div>
                        {cr.request_type === 'reschedule' && cr.proposed_date && (
                          <div>
                            <div style={{ fontSize: '0.75rem', color: '#888', marginBottom: '2px' }}>PROPOSED TIME</div>
                            <div style={{ fontWeight: 600, color: '#1D4ED8' }}>{cr.proposed_date} {cr.proposed_start_time?.slice(0,5)} - {cr.proposed_end_time?.slice(0,5)}</div>
                          </div>
                        )}
                      </div>
                      {cr.cancel_reason && (
                        <div style={{ padding: '0.5rem 0.75rem', background: '#FEF3C7', borderRadius: '6px', fontSize: '0.85rem', color: '#92400E', marginBottom: '0.75rem' }}>
                          Reason: {cr.cancel_reason}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-sm"
                          style={{ background: '#059669', color: '#fff', padding: '0.4rem 1rem', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                          disabled={crResolving === cr.id}
                          onClick={() => resolveChangeRequest(cr.id, 'approve')}
                        >
                          {crResolving === cr.id ? 'Working...' : 'Approve'}
                        </button>
                        <button
                          className="btn btn-sm"
                          style={{ background: '#DC2626', color: '#fff', padding: '0.4rem 1rem', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                          disabled={crResolving === cr.id}
                          onClick={() => resolveChangeRequest(cr.id, 'deny')}
                        >
                          Deny
                        </button>
                        {cr.request_type === 'reschedule' && (
                          <button
                            className="btn btn-sm"
                            style={{ background: '#7C3AED', color: '#fff', padding: '0.4rem 1rem', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
                            disabled={crResolving === cr.id}
                            onClick={() => {
                              const counterDate = prompt('Suggest a different date (YYYY-MM-DD):');
                              const counterStart = prompt('Start time (HH:MM):');
                              const counterEnd = prompt('End time (HH:MM):');
                              const msg = prompt('Optional message to client:');
                              if (counterDate && counterStart && counterEnd) {
                                resolveChangeRequest(cr.id, 'counter', {
                                  counterDate, counterStartTime: counterStart, counterEndTime: counterEnd, counterMessage: msg || ''
                                });
                              }
                            }}
                          >
                            Suggest Different Time
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {currentPage === 'miss-report' && <ShiftMissReport token={token} userId={user.id} onClose={() => setCurrentPage('home')} />}
          {currentPage === 'settings' && renderSettingsPage()}
        </div>
      </div>

      {showNoteModal && (
        <div className="modal active">
          <div className="modal-content">
            <div className="modal-header"><h2>Visit Notes</h2><button className="close-btn" onClick={() => { setShowNoteModal(false); setNoteError(''); }}>×</button></div>
            <p className={noteError ? 'text-danger' : 'text-muted'} style={noteError ? { color: '#DC2626', fontWeight: 600 } : undefined}>
              {noteError || 'Add notes (optional)'}
            </p>
            <div className="form-group">
              <textarea
                value={visitNote}
                onChange={(e) => { setVisitNote(e.target.value); if (noteError) setNoteError(''); }}
                placeholder="How did the visit go?"
                rows={4}
                style={noteError ? { borderColor: '#DC2626' } : undefined}
              />
            </div>

            {/* Visit photos — proof-of-care */}
            <div className="form-group">
              <label style={{ display: 'block', fontWeight: 700, marginBottom: 6 }}>
                📷 Photos ({pendingPhotos.length}) <span style={{ fontWeight: 400, fontSize: '0.8rem', color: '#6B7280' }}>optional</span>
              </label>
              {/* Native file picker — on mobile, capture="environment" defaults to rear camera */}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={(e) => { Array.from(e.target.files || []).forEach(f => handlePhotoFile(f, 'task')); e.target.value = ''; }}
                style={{ display: 'block', marginBottom: 8 }}
              />
              {pendingPhotos.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 6, marginBottom: 6 }}>
                  {pendingPhotos.map((p, i) => (
                    <div key={i} style={{ position: 'relative', border: '1px solid #E5E7EB', borderRadius: 6, overflow: 'hidden', background: '#000' }}>
                      <img src={p.dataUri} alt={p.caption || `Photo ${i+1}`} style={{ width: '100%', height: 100, objectFit: 'cover', display: 'block' }} />
                      <button type="button" onClick={() => setPendingPhotos(prev => prev.filter((_, idx) => idx !== i))}
                        style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(220,38,38,0.9)', color: '#fff', border: 'none', borderRadius: 4, width: 22, height: 22, cursor: 'pointer', fontSize: 14, lineHeight: '20px' }}
                        title="Remove">×</button>
                      <input type="text" value={p.caption} onChange={(e) => setPendingPhotos(prev => prev.map((x, idx) => idx === i ? { ...x, caption: e.target.value } : x))}
                        placeholder="Caption…"
                        style={{ width: '100%', border: 'none', borderTop: '1px solid #E5E7EB', padding: '3px 5px', fontSize: '0.7rem' }} />
                    </div>
                  ))}
                </div>
              )}
              {photoUploading && <div style={{ fontSize: '0.8rem', color: '#0891B2' }}>Uploading photos…</div>}
            </div>

            <div className="form-actions">
              <button className="btn btn-secondary" disabled={clockingOut} onClick={() => { setShowNoteModal(false); setNoteError(''); }}>Cancel</button>
              <button className="btn btn-primary" disabled={clockingOut} onClick={completeClockOut}
                style={clockingOut ? { opacity: 0.7, cursor: 'wait' } : undefined}>
                {clockingOut ? '⏳ Clocking Out...' : 'Clock Out'}
              </button>
            </div>
          </div>
        </div>
      )}

      <CaregiverClientModal clientId={viewingClientId} isOpen={!!viewingClientId} onClose={() => setViewingClientId(null)} token={token} />

      <SignaturePad
        open={!!signTarget}
        onClose={() => setSignTarget(null)}
        documentName={signTarget?.name || signTarget?.document_name || signTarget?.file_name}
        onSign={submitDocSignature}
      />

      {swapModal && (
        <div className="modal active" onClick={() => setSwapModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h2>🔄 Request Shift Swap</h2><button className="close-btn" onClick={() => setSwapModal(null)}>×</button></div>
            <p className="text-muted">
              {getClientName(swapModal.client_id)} on {swapModal.resolvedDate || (swapModal.date && swapModal.date.split('T')[0])} ({formatTime(swapModal.start_time)}–{formatTime(swapModal.end_time)})
            </p>
            <div className="form-group">
              <label>Ask coworker</label>
              <select value={swapForm.targetCaregiverId} onChange={(e) => setSwapForm({ ...swapForm, targetCaregiverId: e.target.value })}>
                <option value="">Pick a coworker…</option>
                {otherCaregivers.map(cg => <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Reason (optional, but helps)</label>
              <textarea value={swapForm.reason} onChange={(e) => setSwapForm({ ...swapForm, reason: e.target.value })} placeholder="Doctor appointment, family emergency, etc." rows={3} />
            </div>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setSwapModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitSwapRequest}>Send Request</button>
            </div>
          </div>
        </div>
      )}

      {/* Messages Modal */}
      {showMessages && <CaregiverMessages token={token} onClose={() => { setShowMessages(false); setUnreadMessages(0); }} />}

      {/* Payday Verification Modal — persistent until caregiver confirms or disputes */}
      {pendingVerification && !showMessages && (
        <PaydayVerificationModal
          pending={pendingVerification}
          token={token}
          onResolved={() => setPendingVerification(null)}
        />
      )}

      {/* Help Modal */}
      {showHelp && <CaregiverHelp onClose={() => setShowHelp(false)} />}

      {/* Shift Miss Report Modal */}
      {showMissReport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '16px 16px 0 0', padding: '1.5rem', width: '100%', maxWidth: '500px', maxHeight: '90vh', overflowY: 'auto' }}>
            <ShiftMissReport token={token} userId={user.id} onClose={() => setShowMissReport(false)} />
          </div>
        </div>
      )}

      {/* ── Mobile Bottom Navigation ── */}
      {showMoreDrawer && <div className="mobile-more-drawer-overlay" onClick={() => setShowMoreDrawer(false)} />}

      <div className={`mobile-more-drawer ${showMoreDrawer ? 'open' : ''}`}>
        <div className="mobile-more-drawer-handle" />
        <div className="mobile-more-drawer-section">
          <div className="mobile-more-drawer-section-title">Self Service</div>
          {[
            { page: 'open-shifts',   icon: '📋', label: 'Open Shifts' },
            { page: 'availability',  icon: '⏰', label: 'Availability' },
            { page: 'miss-report',   icon: '🚨', label: 'Report Miss' },
            { page: 'time-off',      icon: '🏖️', label: 'Time Off' },
          ].map(({ page, icon, label }) => (
            <button
              key={page}
              className={`mobile-more-drawer-item ${currentPage === page ? 'active' : ''}`}
              onClick={() => { setCurrentPage(page); setShowMoreDrawer(false); }}
            >
              <span className="mobile-more-drawer-item-icon">{icon}</span>
              {label}
            </button>
          ))}
        </div>
        <div className="mobile-more-drawer-section">
          <div className="mobile-more-drawer-section-title">Account</div>
          <button
            className={`mobile-more-drawer-item ${currentPage === 'settings' ? 'active' : ''}`}
            onClick={() => { setCurrentPage('settings'); setShowMoreDrawer(false); }}
          >
            <span className="mobile-more-drawer-item-icon">⚙️</span>
            Settings
          </button>
          <button
            className="mobile-more-drawer-item"
            onClick={onLogout}
            style={{ color: '#DC2626' }}
          >
            <span className="mobile-more-drawer-item-icon" style={{ background: '#FEE2E2' }}>⏻</span>
            Log Out
          </button>
        </div>
      </div>

      <nav className="mobile-bottom-nav">
        {[
          { page: 'home',     icon: '🏠', label: 'Home' },
          { page: 'schedule', icon: '📅', label: 'Schedule' },
          { page: 'clients',  icon: '👥', label: 'Clients' },
          { page: 'history',  icon: '📜', label: 'History' },
        ].map(({ page, icon, label }) => (
          <button
            key={page}
            className={`mobile-bottom-nav-item ${currentPage === page ? 'active' : ''}`}
            onClick={() => { setCurrentPage(page); setShowMoreDrawer(false); }}
          >
            <span className="mobile-bottom-nav-icon">{icon}</span>
            {label}
          </button>
        ))}
        <button
          className={`mobile-bottom-nav-item ${showMoreDrawer ? 'active' : ''}`}
          onClick={() => setShowMoreDrawer(v => !v)}
        >
          <span className="mobile-bottom-nav-icon">⋯</span>
          More
        </button>
      </nav>
    </div>
  );
};

export default CaregiverDashboard;
