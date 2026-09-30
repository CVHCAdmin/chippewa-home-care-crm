// Client Hours by Week — renders who was where and when from /api/reports/client-week.
import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import ClientWeekHours from '../components/admin/ClientWeekHours';

const week = {
  weekStart: '2026-09-20', weekEnd: '2026-09-26',
  clients: [{
    client_id: 'd', name: 'Diane Shantz', is_private_pay: true, scheduled_minutes: 240, clocked_minutes: 123, missing_clock_ins: 1,
    rows: [
      { type: 'visit', day: '2026-09-21', caregiver_name: 'Patricia Wittmann', sched_start: '14:00:00', sched_end: '16:00:00', sched_minutes: 120,
        clock_in: '2026-09-21T19:00:00.000Z', clock_out: '2026-09-21T21:03:00.000Z', clocked_minutes: 123, flags: [] },
      { type: 'visit', day: '2026-09-24', caregiver_name: 'Patricia Wittmann', sched_start: '14:00:00', sched_end: '16:00:00', sched_minutes: 120,
        clock_in: null, clock_out: null, clocked_minutes: null, flags: [], payroll: { kind: 'paid_no_clock_in', payable_minutes: 120, note: null } },
      { type: 'cancelled', day: '2026-09-26', caregiver_name: 'Patricia Wittmann', sched_start: '14:00:00', sched_end: '16:00:00', cancel_reason: 'client_hospital', flags: [] },
    ],
  }, {
    client_id: 'k', name: 'Kathy Boardman', is_private_pay: false, scheduled_minutes: 240, clocked_minutes: 151, missing_clock_ins: 0,
    rows: [{ type: 'visit', day: '2026-09-24', caregiver_name: 'Gina Schneider', sched_start: '13:00:00', sched_end: '17:00:00', sched_minutes: 240,
      clock_in: '2026-09-24T20:53:00.000Z', clock_out: '2026-09-24T23:25:00.000Z', clocked_minutes: 151, flags: ['time_variance', 'offline_punch'], payroll: { kind: 'manual', payable_minutes: 290, note: 'caregiver reported 1:10-6:00' } }],
  }],
};

afterEach(() => vi.unstubAllGlobals());

describe('Client Hours by Week', () => {
  test('shows each visit: caregiver, scheduled, clocked, and what is missing', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => week });
    vi.stubGlobal('fetch', fetch);
    render(<ClientWeekHours token="t" />);
    await waitFor(() => expect(screen.getByRole('heading', { name: /Diane Shantz/ })).toBeTruthy());
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/reports\/client-week\?weekStart=\d{4}-\d{2}-\d{2}$/);
    expect(screen.getAllByText('2:00 PM – 4:00 PM').length).toBeGreaterThan(0);
    expect(screen.getByText('2:00 PM – 4:03 PM')).toBeTruthy();            // clock times in Chicago
    expect(screen.getByText('No clock-in')).toBeTruthy();
    expect(screen.getByText('8.2')).toBeTruthy();                           // 123 clocked min = 8.2 units
    expect(screen.getAllByText('4.00 h (16 units)').length).toBe(2);        // weekly scheduled totals
    expect(screen.getByText('2.05 h (8.2 units)')).toBeTruthy();             // Diane's clocked total
    expect(screen.getByText(/Cancelled — /)).toBeTruthy();
    expect(screen.getByText(/saved offline/)).toBeTruthy();
    expect(screen.getByText('3:53 PM – 6:25 PM')).toBeTruthy();
    expect(screen.getByText('✏️ Paid 4.83 h / 19.33 units (manual entry) — caregiver reported 1:10-6:00')).toBeTruthy();
    expect(screen.getByText('✅ Paid 2.00 h / 8 units, no clock-in')).toBeTruthy();

    // Filter to one client.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'k' } });
    expect(screen.queryByRole('heading', { name: /Diane Shantz/ })).toBeNull();
    expect(screen.getByRole('heading', { name: /Kathy Boardman/ })).toBeTruthy();
  });

  test('Prev week asks for the Sunday seven days earlier', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...week, clients: [] }) });
    vi.stubGlobal('fetch', fetch);
    render(<ClientWeekHours token="t" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const first = fetch.mock.calls[0][0].split('weekStart=')[1];
    expect(new Date(`${first}T12:00:00`).getDay()).toBe(0);
    fireEvent.click(screen.getByText('← Prev week'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const prev = fetch.mock.calls[1][0].split('weekStart=')[1];
    expect((new Date(`${first}T12:00:00`) - new Date(`${prev}T12:00:00`)) / 86400000).toBe(7);
  });
});
