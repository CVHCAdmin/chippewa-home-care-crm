// src/components/HelpPanel.jsx
// Slide-out admin help panel with searchable articles per section
import React, { useState, useEffect, useRef } from 'react';

const HELP_ARTICLES = [
  {
    section: 'Dashboard',
    icon: '🏠',
    articles: [
      {
        title: 'Reading the Today Panel',
        content: `The Today Panel at the top of the dashboard shows four live numbers:
• Active Shifts Today — total shifts scheduled for today
• Clocked In Now — caregivers currently on the clock
• Shifts Remaining — shifts that haven't started yet
• Coverage Gaps — shifts with no caregiver assigned (red = urgent)

If you see a red "Find Coverage →" button, click it immediately to open Emergency Coverage.`
      },
      {
        title: 'Notification Bell',
        content: `The bell icon in the top-right header shows unread alerts. It refreshes every 30 seconds automatically.

Notifications include:
• Caregiver miss reports (highest priority)
• Clock-in/out confirmations
• Coverage assignments
• System alerts

Click the bell to see the list and mark items as read.`
      },
      {
        title: 'Quick Actions',
        content: `The six Quick Action buttons are shortcuts to the most common tasks:
• New Client → opens client onboarding
• New Caregiver → opens add caregiver form
• Billing → goes to invoice management
• Reports → goes to analytics
• Emergency Coverage → opens the coverage tool
• Background Checks → opens compliance overview`
      },
    ]
  },
  {
    section: 'Clients',
    icon: '👥',
    articles: [
      {
        title: 'Adding a New Client',
        content: `Go to Operations → Clients → click "+ Add Client".

Required fields: first name, last name, phone, address, and service type.

After saving, the client appears in your active list and can be assigned to schedules immediately.`
      },
      {
        title: 'Setting Up a Care Plan',
        content: `Care plans define what services a client is authorized for and how many hours per week.

Go to Operations → Care Plans → select the client → click "+ Add Care Plan Entry".

Enter the service type, authorized hours/week, and any instructions. The system will warn you if you try to leave with unsaved changes.

Note: Care plans set authorization only — scheduling is done separately in the Schedule Hub.`
      },
      {
        title: 'Difference: Clients vs Referrals',
        content: `Clients = people actively receiving services who are signed up in the system.
Referrals = prospects who have been referred but haven't started care yet.

Use Operations → Referrals for new leads. When they convert to active clients, use the "Convert to Client" action on their referral record. This keeps your active client list clean.`
      },
    ]
  },
  {
    section: 'Scheduling',
    icon: '📅',
    articles: [
      {
        title: 'Schedule Types Explained',
        content: `One-Time: Single shift on a specific date. Good for substitutes or trial shifts.

Recurring (Single Day): Same day every week forever (or until deactivated). Example: every Monday 9am–1pm.

Multi-Day Recurring: Multiple days per week. Creates one schedule entry per day selected.

Bi-Weekly: Every other week. You'll be asked to pick the "ON week" anchor date — choose any date in the first week the caregiver should work. The system handles the alternating pattern automatically.`
      },
      {
        title: 'Conflict Detection',
        content: `When you add a schedule, the system checks if the caregiver already has a conflicting schedule at the same time.

A red conflict warning appears in the form before you submit if an overlap is detected. You can still save if you choose, but the warning won't go away until the conflict is resolved.

For bi-weekly schedules, the system is smart enough to check if two bi-weekly schedules actually overlap (based on their anchor dates) before flagging a conflict.`
      },
      {
        title: 'Ending a Recurring Schedule',
        content: `Never delete a recurring schedule — this removes history.

Instead, click on the schedule and click "Deactivate." This stops future occurrences while keeping all past shift records intact for payroll and reporting.

If you need to change a schedule (different time, different client), deactivate the old one and create a new one.`
      },
      {
        title: 'Bi-Weekly Anchor Date',
        content: `The anchor date tells the system which week is the "ON" week for a bi-weekly schedule.

When creating a bi-weekly schedule, pick any date in the first week the caregiver should work. You don't need to pick a Sunday — just any day in that week. The system normalizes it.

If you change the anchor date later (in the edit modal), you're changing which weeks are "on" and "off" — this takes effect immediately, so double-check the next few weeks in the calendar after making changes.`
      },
    ]
  },
  {
    section: 'Emergency Coverage',
    icon: '🚨',
    articles: [
      {
        title: 'How to Find Coverage Fast',
        content: `1. Go to Scheduling → Emergency Coverage
2. Check the "Pending Coverage Needs" section at the top for any submitted miss reports
3. Click "Find Coverage" next to the affected shift
4. Review the ranked list of available caregivers
5. Call the caregiver first to confirm verbally
6. Click "Assign Coverage" to create the schedule and notify them

The whole process should take under 5 minutes if you have available caregivers.`
      },
      {
        title: 'Caregiver Status Badges',
        content: `Available (green): Under 32 hours this week — no concerns.

Moderate Hours (yellow): 32–37 hours — can take the shift, but watch their total for the week.

Near Overtime (red): 37+ hours — assigning this shift will push them into or further into overtime. Use as a last resort and make sure payroll is aware.

Preferred (teal): This caregiver has worked with this specific client before — they know the client's routine, which usually means a smoother shift.`
      },
      {
        title: 'Manual Coverage Search',
        content: `You don't need a miss report to use the coverage search tool. Use the manual search form to find available caregivers for any date and time — useful for proactive planning or filling new client openings.

Enter the date, start time, and end time. Optionally filter by client to surface caregivers who have worked with them before.`
      },
    ]
  },
  {
    section: 'Caregivers',
    icon: '👤',
    articles: [
      {
        title: 'Bulk SMS to Caregivers',
        content: `Select caregivers using the checkboxes on the left of the caregiver table. A blue bulk actions bar will appear at the top.

Click "📱 Send SMS" to open a compose window. Type your message once and it goes to all selected caregivers simultaneously.

Only caregivers with a phone number on file will receive the SMS.`
      },
      {
        title: 'Viewing GPS Route History',
        content: `Click "🕐 History" on any caregiver to see their full shift timeline.

Shifts with GPS data show a "View Route" button. Click it to open an interactive map showing the caregiver's path during that shift — with a green start marker and red end marker.

This is useful for verifying a caregiver was actually at the client's home and for resolving any disputes about a visit.`
      },
      {
        title: 'Promoting to Admin',
        content: `In the caregiver table, click "Make Admin" on any caregiver to give them admin access. They'll be able to log in and see the full admin dashboard.

This is useful for lead caregivers or supervisors who need system access.

Warning: Admin users can see all client and caregiver data, billing, and payroll. Only grant this to trusted staff.`
      },
    ]
  },
  {
    section: 'Billing & Payroll',
    icon: '💰',
    articles: [
      {
        title: 'Generating an Invoice',
        content: `Go to Financial → Billing → click "Generate Invoice."

Select the client, billing period start and end dates, and the payer. The system pulls scheduled hours for that period.

Review the line items and adjust if needed. Click "Create Invoice" to finalize.

Tip: Set the client's payer (Medicaid, private pay, insurance, VA) on their profile before generating invoices — this auto-populates the correct billing info.`
      },
      {
        title: 'Running Payroll',
        content: `Go to Financial → Payroll. Select your pay period dates and click "Calculate Payroll."

Hours come from actual clock-in/out records — not from schedules. If a caregiver didn't clock in, they won't have hours.

Review each row. Adjust the overtime threshold (default 40 hrs/week) and differentials if needed. Approve individually or click "Approve All."

Export to QuickBooks CSV or standard CSV for your accounting system.`
      },
      {
        title: 'Why Hours Might Look Wrong',
        content: `Payroll hours come from time_entries (clock-in/clock-out records), not from schedules.

Common reasons for missing or wrong hours:
• Caregiver forgot to clock in or out — check Caregiver History and manually adjust
• Caregiver clocked in to the wrong client — fix in the time entry record
• Clock-out was never recorded — the shift stays "open" indefinitely

Always run a quick audit before approving payroll — look for any caregivers with zero hours who were scheduled to work.`
      },
    ]
  },
  {
    section: 'Compliance',
    icon: '🛡️',
    articles: [
      {
        title: 'Background Check Expiry Dashboard',
        content: `Go to Compliance → Background Checks → click the "Overview" tab.

This shows ALL caregivers and their background check status in one view. Use the dropdown to filter by expiry window (30, 60, 90, or 180 days).

Click on a status card (Expired, Expiring Soon, etc.) to filter the list to just those caregivers. Click it again to show all.

Run this check monthly at minimum. Any "Expired" or "No Check on File" caregivers should be addressed before their next scheduled shift.`
      },
      {
        title: 'Submitting a WORCS Check',
        content: `Wisconsin caregivers must be checked through the DOJ WORCS system.

1. Go to Compliance → Background Checks
2. Select the caregiver
3. Click "Submit WORCS Check"
4. Enter their SSN — it is encrypted immediately and never stored in plain text
5. Submit — the check goes to Wisconsin DOJ automatically
6. Results return in 24–72 hours. Click "Poll Results" to update the status.

You need your WORCS credentials (username, password, account number) configured in environment settings first.`
      },
      {
        title: 'SSN Security',
        content: `SSNs are encrypted with AES-256-GCM encryption before being saved. They are never stored in plain text anywhere in the system.

The full SSN is never displayed. You can only see the last 4 digits in the UI.

If you need to verify a full SSN, click "Reveal SSN" — this requires admin access and creates an audit log entry showing who accessed it and when. All SSN reveals are logged permanently.`
      },
    ]
  },
  {
    section: 'Reports',
    icon: '📊',
    articles: [
      {
        title: 'Available Report Types',
        content: `Overview / Caregiver Hours: Actual hours worked per caregiver from clock-in records.

Revenue / Billing: Invoice totals, collections, and outstanding balances.

Compliance: Background check status and expiration for all caregivers.

Clients: Full roster with service types, enrollment dates, assigned caregivers.

Payroll: Hours and gross pay per caregiver for any date range.

Each report exports to CSV (for Excel) or PDF (branded, printable).`
      },
      {
        title: 'Exporting to PDF',
        content: `Every report has an "Export" button. Select PDF from the format dropdown.

The PDF is automatically formatted with CVHC branding, the report title, your selected date range, and a table of all records.

For large date ranges (e.g., a full year), PDFs may be multiple pages. The record count is shown at the bottom of each export.`
      },
    ]
  },
];

const HelpPanel = ({ isOpen, onClose, currentPage = '' }) => {
  const [search, setSearch] = useState('');
  const [activeSection, setActiveSection] = useState(null);
  const [activeArticle, setActiveArticle] = useState(null);
  const panelRef = useRef(null);

  // Auto-open to matching section when page changes
  useEffect(() => {
    if (!isOpen) return;
    const match = HELP_ARTICLES.find(s =>
      s.section.toLowerCase().includes(currentPage.toLowerCase()) ||
      currentPage.toLowerCase().includes(s.section.toLowerCase())
    );
    if (match) {
      setActiveSection(match.section);
      setActiveArticle(null);
    }
  }, [currentPage, isOpen]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onClose]);

  const filtered = HELP_ARTICLES.map(section => ({
    ...section,
    articles: section.articles.filter(a =>
      !search ||
      a.title.toLowerCase().includes(search.toLowerCase()) ||
      a.content.toLowerCase().includes(search.toLowerCase()) ||
      section.section.toLowerCase().includes(search.toLowerCase())
    )
  })).filter(s => s.articles.length > 0);

  const currentSection = HELP_ARTICLES.find(s => s.section === activeSection);
  const currentArticle = currentSection?.articles.find(a => a.title === activeArticle);

  const s = {
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 9998, opacity: isOpen ? 1 : 0, pointerEvents: isOpen ? 'all' : 'none', transition: 'opacity 0.2s' },
    panel: { position: 'fixed', top: 0, right: 0, bottom: 0, width: '420px', maxWidth: '95vw', background: '#fff', zIndex: 9999, boxShadow: '-4px 0 24px rgba(0,0,0,0.15)', transform: isOpen ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)', display: 'flex', flexDirection: 'column' },
    header: { padding: '1.25rem 1.25rem 0', borderBottom: '1px solid #E5E7EB', paddingBottom: '1rem' },
    body: { flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' },
  };

  return (
    <>
      <div style={s.overlay} onClick={onClose} />
      <div ref={panelRef} style={s.panel}>
        {/* Header */}
        <div style={s.header}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.875rem' }}>
            <div>
              <div style={{ fontWeight: '800', fontSize: '1.1rem', color: '#111827' }}>
                {currentArticle ? (
                  <button onClick={() => setActiveArticle(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2ABBA7', fontWeight: '700', fontSize: '0.85rem', padding: 0, marginBottom: '0.25rem', display: 'block' }}>
                    ← {activeSection}
                  </button>
                ) : activeSection ? (
                  <button onClick={() => setActiveSection(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2ABBA7', fontWeight: '700', fontSize: '0.85rem', padding: 0, marginBottom: '0.25rem', display: 'block' }}>
                    ← All Topics
                  </button>
                ) : null}
                {currentArticle ? currentArticle.title : activeSection ? `${currentSection?.icon} ${activeSection}` : '❓ Help Center'}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: '#6B7280', padding: '0.25rem' }}>✕</button>
          </div>
          {!currentArticle && (
            <input
              placeholder="Search help articles..."
              value={search}
              onChange={e => { setSearch(e.target.value); setActiveSection(null); setActiveArticle(null); }}
              style={{ width: '100%', padding: '0.6rem 0.875rem', border: '1px solid #D1D5DB', borderRadius: '8px', fontSize: '0.9rem', boxSizing: 'border-box', outline: 'none' }}
              autoFocus={isOpen}
            />
          )}
        </div>

        {/* Body */}
        <div style={s.body}>
          {/* Single article view */}
          {currentArticle ? (
            <div>
              {currentArticle.content.split('\n').map((line, i) => {
                if (line.startsWith('•')) {
                  return (
                    <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', paddingLeft: '0.5rem' }}>
                      <span style={{ color: '#2ABBA7', fontWeight: '700', flexShrink: 0 }}>•</span>
                      <span style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.6 }}>{line.slice(1).trim()}</span>
                    </div>
                  );
                }
                if (line.match(/^\d+\./)) {
                  return (
                    <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', paddingLeft: '0.5rem' }}>
                      <span style={{ color: '#2ABBA7', fontWeight: '700', flexShrink: 0, minWidth: '1.2rem' }}>{line.match(/^\d+/)[0]}.</span>
                      <span style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.6 }}>{line.replace(/^\d+\./, '').trim()}</span>
                    </div>
                  );
                }
                if (line.trim() === '') return <div key={i} style={{ height: '0.5rem' }} />;
                return <p key={i} style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.6, margin: '0 0 0.5rem' }}>{line}</p>;
              })}
              <div style={{ marginTop: '1.5rem', padding: '0.875rem', background: '#F0FDFB', borderRadius: '8px', border: '1px solid #BBF7D0' }}>
                <p style={{ margin: 0, fontSize: '0.82rem', color: '#065F46' }}>💡 Still need help? Contact your system administrator or call the office directly.</p>
              </div>
            </div>
          ) : activeSection ? (
            /* Section article list */
            <div>
              {currentSection?.articles.map((article, i) => (
                <button key={i} onClick={() => setActiveArticle(article.title)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.875rem 1rem', marginBottom: '0.5rem', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: '10px', cursor: 'pointer', transition: 'all 0.15s' }}>
                  <div style={{ fontWeight: '600', color: '#111827', fontSize: '0.9rem', marginBottom: '0.2rem' }}>{article.title}</div>
                  <div style={{ fontSize: '0.8rem', color: '#6B7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {article.content.split('\n')[0].slice(0, 80)}...
                  </div>
                </button>
              ))}
            </div>
          ) : (
            /* Main topics list (or search results) */
            <div>
              {filtered.map((section, i) => (
                <div key={i} style={{ marginBottom: '0.5rem' }}>
                  <button onClick={() => { setActiveSection(section.section); setSearch(''); }}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '0.875rem 1rem', background: '#fff', border: '1px solid #E5E7EB', borderRadius: '10px', cursor: 'pointer', transition: 'all 0.15s' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontSize: '1.3rem' }}>{section.icon}</span>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontWeight: '700', color: '#111827', fontSize: '0.9rem' }}>{section.section}</div>
                        <div style={{ fontSize: '0.78rem', color: '#6B7280' }}>{section.articles.length} article{section.articles.length !== 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <span style={{ color: '#D1D5DB', fontSize: '1rem' }}>›</span>
                  </button>
                  {search && section.articles.map((article, j) => (
                    <button key={j} onClick={() => { setActiveSection(section.section); setActiveArticle(article.title); setSearch(''); }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.6rem 1rem 0.6rem 3rem', background: '#F9FAFB', border: '1px solid #E5E7EB', borderTop: 'none', borderRadius: j === section.articles.length - 1 ? '0 0 8px 8px' : 0, cursor: 'pointer' }}>
                      <div style={{ fontSize: '0.85rem', color: '#2ABBA7', fontWeight: '600' }}>{article.title}</div>
                    </button>
                  ))}
                </div>
              ))}
              {filtered.length === 0 && (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#6B7280' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔍</div>
                  <p style={{ margin: 0 }}>No results for "{search}"</p>
                  <p style={{ fontSize: '0.82rem', marginTop: '0.5rem' }}>Try different keywords or browse by topic above</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '0.875rem 1.25rem', borderTop: '1px solid #E5E7EB', background: '#F9FAFB' }}>
          <p style={{ margin: 0, fontSize: '0.78rem', color: '#9CA3AF', textAlign: 'center' }}>
            Chippewa Valley Home Care CRM — Help Center
          </p>
        </div>
      </div>
    </>
  );
};

export default HelpPanel;
