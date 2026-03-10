// Central Time "today" utility for schedule column highlighting
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

const TIMEZONE = 'America/Chicago';

/** Returns today's date string (YYYY-MM-DD) in Central Time */
export function getTodayCT() {
  return dayjs().tz(TIMEZONE).format('YYYY-MM-DD');
}

/** Returns a Date object set to midnight of today in Central Time */
export function getTodayDateCT() {
  const str = dayjs().tz(TIMEZONE).format('YYYY-MM-DD');
  return new Date(str + 'T00:00:00');
}
