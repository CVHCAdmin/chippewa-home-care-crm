// Hours between two HH:MM (or HH:MM:SS) times, wrapping past midnight.
// 13:00 -> 12:00 returns 23 (overnight), not -1.
function shiftHours(start, end) {
  if (!start || !end) return 0;
  const h = (new Date(`2000-01-01T${end}`) - new Date(`2000-01-01T${start}`)) / (1000 * 60 * 60);
  return h <= 0 ? h + 24 : h;
}

module.exports = { shiftHours };
