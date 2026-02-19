// src/components/caregiver/CaregiverHelp.jsx
// Mobile-first help guide for caregivers
import React, { useState } from 'react';

const TOPICS = [
  {
    id: 'clockin',
    icon: '⏰',
    title: 'How to Clock In',
    color: '#2ABBA7',
    bg: '#F0FDFB',
    steps: [
      { step: '1', text: 'Arrive at the client\'s home first — clock in from inside or just outside, not from your car.' },
      { step: '2', text: 'Open the app and look for "Ready to Start a Shift?" on the home screen.' },
      { step: '3', text: 'Tap the "Select Client" dropdown and choose your client\'s name.' },
      { step: '4', text: 'Wait until you see "GPS Active" — this confirms your location is recorded.' },
      { step: '5', text: 'Tap the green "▶️ Clock In" button.' },
      { step: '6', text: 'You\'ll get a push notification confirming you\'re clocked in. You\'re good to go!' },
    ],
    tips: ['Always clock in from the client\'s home — GPS records where you are.', 'If GPS shows "unavailable," you can still clock in — just let your supervisor know.'],
    warning: 'Do not clock in before you arrive at the client\'s home.'
  },
  {
    id: 'clockout',
    icon: '🛑',
    title: 'How to Clock Out',
    color: '#EF4444',
    bg: '#FEF2F2',
    steps: [
      { step: '1', text: 'When your shift is complete, go back to the home screen.' },
      { step: '2', text: 'You\'ll see a red "🛑 Clock Out" button and a timer showing how long you\'ve been working.' },
      { step: '3', text: 'Tap "Clock Out."' },
      { step: '4', text: 'You\'ll get a push notification confirming your clock-out with your total hours for the shift.' },
    ],
    tips: ['Always clock out as soon as your shift ends — don\'t wait until you get home.', 'If you forgot to clock out, call your supervisor right away.'],
    warning: 'Leaving a shift open affects your payroll and triggers an alert for supervisors.'
  },
  {
    id: 'missreport',
    icon: '🚨',
    title: 'I Can\'t Make My Shift',
    color: '#EF4444',
    bg: '#FEF2F2',
    steps: [
      { step: '1', text: 'Tap the red "🚨 Miss Report" card on your home screen as soon as you know you can\'t make it.' },
      { step: '2', text: 'If your upcoming shifts are shown, tap the one you can\'t make to auto-fill the date.' },
      { step: '3', text: 'Select your reason from the dropdown.' },
      { step: '4', text: 'Add any notes if helpful (optional).' },
      { step: '5', text: 'Tap "🚨 Submit Miss Report." Your supervisor is notified immediately.' },
    ],
    tips: ['Submit as early as possible — give your supervisor at least 2 hours if you can.', 'Follow up by phone if you don\'t hear back within 30 minutes.'],
    warning: 'Submitting a miss report does not guarantee approval. Always follow up if you\'re unsure.'
  },
  {
    id: 'schedule',
    icon: '📅',
    title: 'Viewing My Schedule',
    color: '#6366F1',
    bg: '#EEF2FF',
    steps: [
      { step: '1', text: 'Tap the 📅 Schedule tab at the bottom of the app.' },
      { step: '2', text: 'Your upcoming shifts are listed in order, showing client, date, and time.' },
      { step: '3', text: 'Tap any shift to see the full details including the client\'s address.' },
      { step: '4', text: 'Tap "Select for Clock-In" to pre-load that client on the home screen so it\'s ready when you arrive.' },
    ],
    tips: ['Check your schedule the night before to plan your day.', 'If you see a shift you don\'t recognize, contact your supervisor before that date.'],
    warning: null
  },
  {
    id: 'openshifts',
    icon: '📋',
    title: 'Picking Up Open Shifts',
    color: '#F59E0B',
    bg: '#FFFBEB',
    steps: [
      { step: '1', text: 'Tap "📋 Open Shifts" on the home screen.' },
      { step: '2', text: 'Browse available shifts — each one shows the client, date, time, and duration.' },
      { step: '3', text: 'Tap a shift to see full details.' },
      { step: '4', text: 'Tap "Claim Shift" if you want it.' },
      { step: '5', text: 'Your supervisor will receive a notification and confirm the assignment. You\'ll be notified once it\'s confirmed.' },
    ],
    tips: ['You don\'t have the shift until your supervisor confirms it — don\'t assume it\'s yours just from claiming.'],
    warning: null
  },
  {
    id: 'availability',
    icon: '🗓️',
    title: 'Setting My Availability',
    color: '#8B5CF6',
    bg: '#F5F3FF',
    steps: [
      { step: '1', text: 'Tap "⏰ Availability" on the home screen.' },
      { step: '2', text: 'For each day of the week, toggle it on or off depending on whether you\'re available.' },
      { step: '3', text: 'For days you\'re available, set your earliest start time and latest end time.' },
      { step: '4', text: 'Set your maximum hours per week if you want to limit how much you\'re scheduled.' },
      { step: '5', text: 'Tap Save.' },
    ],
    tips: ['Your availability is used when supervisors search for emergency coverage.', 'To request time off, scroll down in the Availability screen to the Time Off section.'],
    warning: 'Approved time off blocks new assignments but does NOT automatically remove existing shifts. Talk to your supervisor about shifts during your time off.'
  },
  {
    id: 'gps',
    icon: '📍',
    title: 'GPS & Location',
    color: '#10B981',
    bg: '#F0FDF4',
    steps: null,
    faq: [
      { q: 'Why does the app need my location?', a: 'GPS verifies you\'re at the client\'s home when you clock in and records your route during the shift. This protects you and the client.' },
      { q: 'What does "GPS Active (±Xm)" mean?', a: 'Your location is working. The number is accuracy in meters — lower is better. Under 20m is great.' },
      { q: 'What if GPS shows unavailable?', a: 'Check that Location permissions are set to "Always Allow" for this app in your phone Settings. Try stepping outside. You can still clock in even without GPS.' },
      { q: 'Does GPS run all shift?', a: 'Yes — it records a trail of your movements during the shift, which your supervisor can view as a map. It stops when you clock out.' },
      { q: 'Can I turn off GPS?', a: 'You can, but it may prevent you from clocking in. Your employer requires GPS for compliance.' },
    ],
    tips: [],
    warning: null
  },
  {
    id: 'mileage',
    icon: '🚗',
    title: 'Mileage Tracking',
    color: '#64748B',
    bg: '#F8FAFC',
    steps: [
      { step: '1', text: 'Tap the 🚗 Mileage icon or find Mileage in the menu.' },
      { step: '2', text: 'Tap "Start Trip" when you leave home or your previous location.' },
      { step: '3', text: 'Drive to your destination.' },
      { step: '4', text: 'Tap "End Trip" when you arrive. The trip is logged with distance and a map.' },
    ],
    tips: ['Your GPS route during each shift is saved automatically — your supervisor can see it. The mileage tracker is for trips between locations (home to client, client to client, etc.).', 'Talk to your supervisor about what trips qualify for reimbursement.'],
    warning: null
  },
  {
    id: 'forgot',
    icon: '🔑',
    title: 'Forgot Password / Login Issues',
    color: '#6B7280',
    bg: '#F9FAFB',
    steps: [
      { step: '1', text: 'On the login screen, tap "Forgot Password."' },
      { step: '2', text: 'Enter your email address and tap Send Reset Link.' },
      { step: '3', text: 'Check your email (including spam/junk folder).' },
      { step: '4', text: 'Click the link in the email and enter a new password.' },
      { step: '5', text: 'If you still can\'t log in, contact your supervisor to reset your account.' },
    ],
    tips: ['Make sure you\'re using the email your employer has on file for you.'],
    warning: null
  },
];

const CaregiverHelp = ({ onClose }) => {
  const [activeTopic, setActiveTopic] = useState(null);
  const [search, setSearch] = useState('');

  const topic = TOPICS.find(t => t.id === activeTopic);

  const filtered = TOPICS.filter(t =>
    !search ||
    t.title.toLowerCase().includes(search.toLowerCase()) ||
    (t.steps || []).some(s => s.text.toLowerCase().includes(search.toLowerCase())) ||
    (t.faq || []).some(f => f.q.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#fff', zIndex: 9999, display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '1rem 1rem 0.75rem', borderBottom: '1px solid #E5E7EB', background: '#fff', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
          {topic ? (
            <button onClick={() => setActiveTopic(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2ABBA7', fontWeight: '700', fontSize: '1rem', padding: 0 }}>←</button>
          ) : (
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: '1.2rem', padding: 0 }}>✕</button>
          )}
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '800', color: '#111827' }}>
              {topic ? topic.title : '❓ Help & How-To'}
            </h2>
            {!topic && <p style={{ margin: 0, fontSize: '0.8rem', color: '#6B7280' }}>Tap any topic for step-by-step help</p>}
          </div>
        </div>
        {!topic && (
          <input
            placeholder="🔍 Search help topics..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '0.6rem 0.875rem', border: '1px solid #D1D5DB', borderRadius: '10px', fontSize: '0.9rem', boxSizing: 'border-box', outline: 'none', background: '#F9FAFB' }}
          />
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
        {topic ? (
          /* Single topic view */
          <div>
            {/* Topic header card */}
            <div style={{ background: topic.bg, borderRadius: '14px', padding: '1.25rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span style={{ fontSize: '2.5rem' }}>{topic.icon}</span>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '800', color: topic.color }}>{topic.title}</h3>
                {topic.steps && <p style={{ margin: 0, fontSize: '0.82rem', color: '#6B7280', marginTop: '0.2rem' }}>{topic.steps.length} steps</p>}
              </div>
            </div>

            {/* Warning */}
            {topic.warning && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '10px', padding: '0.875rem 1rem', marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                <span style={{ flexShrink: 0 }}>⚠️</span>
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#991B1B', fontWeight: '600' }}>{topic.warning}</p>
              </div>
            )}

            {/* Steps */}
            {topic.steps && (
              <div style={{ marginBottom: '1.25rem' }}>
                {topic.steps.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: '0.875rem', marginBottom: '0.875rem', alignItems: 'flex-start' }}>
                    <div style={{ width: '2rem', height: '2rem', borderRadius: '50%', background: topic.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '0.9rem', flexShrink: 0 }}>{s.step}</div>
                    <p style={{ margin: 0, fontSize: '0.9rem', color: '#374151', lineHeight: 1.6, paddingTop: '0.3rem' }}>{s.text}</p>
                  </div>
                ))}
              </div>
            )}

            {/* FAQ */}
            {topic.faq && (
              <div style={{ marginBottom: '1.25rem' }}>
                {topic.faq.map((f, i) => (
                  <div key={i} style={{ marginBottom: '0.875rem', padding: '0.875rem 1rem', background: '#F9FAFB', borderRadius: '10px', border: '1px solid #E5E7EB' }}>
                    <p style={{ margin: '0 0 0.4rem', fontWeight: '700', color: '#111827', fontSize: '0.875rem' }}>Q: {f.q}</p>
                    <p style={{ margin: 0, color: '#4B5563', fontSize: '0.875rem', lineHeight: 1.6 }}>{f.a}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Tips */}
            {topic.tips?.length > 0 && (
              <div style={{ background: '#F0FDFB', border: '1px solid #A7F3D0', borderRadius: '10px', padding: '0.875rem 1rem' }}>
                <p style={{ margin: '0 0 0.5rem', fontWeight: '700', color: '#065F46', fontSize: '0.85rem' }}>💡 Tips</p>
                {topic.tips.map((tip, i) => (
                  <p key={i} style={{ margin: i < topic.tips.length - 1 ? '0 0 0.4rem' : 0, fontSize: '0.85rem', color: '#065F46', lineHeight: 1.6 }}>• {tip}</p>
                ))}
              </div>
            )}

            {/* Still need help */}
            <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#F3F4F6', borderRadius: '10px', textAlign: 'center' }}>
              <p style={{ margin: '0 0 0.25rem', fontWeight: '700', color: '#374151', fontSize: '0.875rem' }}>Still stuck?</p>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#6B7280' }}>Call or text your supervisor directly.</p>
            </div>
          </div>
        ) : (
          /* Topic list */
          <div>
            {filtered.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#6B7280' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🔍</div>
                <p style={{ fontWeight: '700', margin: '0 0 0.5rem' }}>No results for "{search}"</p>
                <p style={{ fontSize: '0.85rem', margin: 0 }}>Try different words or scroll through all topics below.</p>
              </div>
            ) : (
              filtered.map((t) => (
                <button key={t.id} onClick={() => setActiveTopic(t.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '1rem', width: '100%', padding: '1rem', background: t.bg, border: `1px solid ${t.color}22`, borderRadius: '12px', marginBottom: '0.625rem', cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent' }}>
                  <span style={{ fontSize: '2rem', flexShrink: 0 }}>{t.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '700', color: '#111827', fontSize: '0.95rem', marginBottom: '0.15rem' }}>{t.title}</div>
                    <div style={{ fontSize: '0.78rem', color: '#6B7280' }}>
                      {t.steps ? `${t.steps.length} steps` : t.faq ? `${t.faq.length} questions` : 'Tap to view'}
                    </div>
                  </div>
                  <span style={{ color: t.color, fontSize: '1.2rem', fontWeight: '700' }}>›</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default CaregiverHelp;
