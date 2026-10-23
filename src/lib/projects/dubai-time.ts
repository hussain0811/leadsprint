// Viewing times are entered and shown in Dubai time. Dubai keeps UTC+4 all year (no daylight saving),
// so a fixed offset is exact. Dates are "YYYY-MM-DD" and times "HH:MM" strings, as HTML date and time inputs use.

const OFFSET_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isClockTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** The moment a Dubai wall-clock date and time happen. */
export function dubaiToUtc(date: string, time: string): Date {
  return new Date(Date.parse(`${date}T${time}:00Z`) - OFFSET_MS);
}

/** The calendar date in Dubai at a moment, as "YYYY-MM-DD". */
export function dubaiDate(at: Date): string {
  return new Date(at.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** The clock time in Dubai at a moment, as "HH:MM". */
export function dubaiClock(at: Date): string {
  return new Date(at.getTime() + OFFSET_MS).toISOString().slice(11, 16);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Every start time for the given Dubai times on `date` and the `extraDays` days after it, earliest first. */
export function slotStarts(date: string, times: string[], extraDays: number): Date[] {
  const unique = [...new Set(times)].sort();
  const starts: Date[] = [];
  for (let day = 0; day <= extraDays; day++) {
    const on = addDays(date, day);
    for (const time of unique) starts.push(dubaiToUtc(on, time));
  }
  return starts;
}
