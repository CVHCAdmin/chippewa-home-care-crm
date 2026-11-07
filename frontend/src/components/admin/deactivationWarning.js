// Builds the confirm text for deactivating a caregiver, from
// GET /api/caregivers/:id/deactivation-impact. Deactivating ends their schedules,
// and that silently wiped days already handed to other caregivers (2026-11-07:
// three days Amanda had taken vanished when Christine was deactivated). This
// spells out every such day before anyone confirms.
import { API_BASE_URL } from '../../config';

const hm = (t) => {
  const [h, m] = String(t || '').split(':').map(Number);
  if (Number.isNaN(h)) return '';
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m || 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const day = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
const line = (r, extra) => `• ${day(r.date)} ${hm(r.start_time)}–${hm(r.end_time)} · ${r.client}${extra ? ` (${extra})` : ''}`;
const list = (rows, extraFn) => {
  const shown = rows.slice(0, 12).map(r => line(r, extraFn && extraFn(r)));
  if (rows.length > 12) shown.push(`…and ${rows.length - 12} more`);
  return shown.join('\n');
};

// Returns { message, hasProblems }.
export async function deactivationWarning(caregiverId, name, token) {
  const base = `Deactivate ${name}? Their visits from today on will end and they will no longer appear on schedules.`;
  let impact;
  try {
    const r = await fetch(`${API_BASE_URL}/api/caregivers/${caregiverId}/deactivation-impact`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    impact = await r.json();
  } catch {
    return { message: `${base}\n\n⚠ Couldn't check whether other caregivers have taken any of their days. Check the schedule before deactivating.`, hasProblems: true };
  }
  const parts = [base];
  const { handedOff = [], openShifts = [], covering = [] } = impact || {};
  if (handedOff.length) {
    parts.push(`⚠ These days were handed to someone else, but they sit on ${name}'s schedule. Deactivating will REMOVE them from that caregiver's schedule too, and nobody will be scheduled:\n${list(handedOff, r => r.covering_caregiver)}`);
  }
  if (openShifts.length) {
    parts.push(`⚠ These open shifts are for ${name}'s visits. They'll still show as available, but the visit won't exist. Remove them, or post them again from another schedule:\n${list(openShifts)}`);
  }
  if (covering.length) {
    parts.push(`⚠ ${name} is covering these days on other caregivers' schedules. Deactivating does NOT remove them. Reassign them first:\n${list(covering)}`);
  }
  if (parts.length === 1) parts.push('No days handed to or from other caregivers are affected.');
  return { message: parts.join('\n\n'), hasProblems: parts.length > 1 && (handedOff.length + openShifts.length + covering.length) > 0 };
}
