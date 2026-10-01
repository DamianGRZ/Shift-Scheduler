// Calendar: public holidays, trading Sundays and day kind for any year.
// Dates are "YYYY-MM-DD" strings; arithmetic is done in UTC to avoid time-zone issues.

export type DayKind = "workday" | "holySaturday" | "tradingSunday" | "closed";

const toDate = (iso: string) => new Date(iso + "T00:00:00Z");
const toIso = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(iso: string, n: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

/** 0 = Sunday ... 6 = Saturday */
export const weekday = (iso: string) => toDate(iso).getUTCDay();

/** Easter Sunday (Meeus/Jones/Butcher algorithm). */
export function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Polish public holidays (Christmas Eve is a holiday from 2025). */
export function holidays(year: number): string[] {
  const e = easter(year);
  const fixed = ["01-01", "01-06", "05-01", "05-03", "08-15", "11-01", "11-11", "12-25", "12-26"];
  if (year >= 2025) fixed.push("12-24");
  return [
    ...fixed.map((md) => `${year}-${md}`),
    e,
    addDays(e, 1), // Easter Monday
    addDays(e, 49), // Pentecost
    addDays(e, 60), // Corpus Christi
  ].sort();
}

function lastSundayOfMonth(year: number, month: number): string {
  // last day of the month, then step back to Sunday
  const last = toIso(new Date(Date.UTC(year, month, 0)));
  return addDays(last, -weekday(last));
}

/** Trading Sundays (Polish Sunday trading ban act, Art. 7). A Sunday that is a holiday is excluded. */
export function tradingSundays(year: number): string[] {
  const xmasEve = `${year}-12-24`;
  const firstSundayBefore = addDays(xmasEve, -(weekday(xmasEve) || 7));
  const december =
    year >= 2025
      ? [-14, -7, 0].map((n) => addDays(firstSundayBefore, n))
      : [-7, 0].map((n) => addDays(firstSundayBefore, n));
  const off = new Set(holidays(year));
  return [
    lastSundayOfMonth(year, 1),
    addDays(easter(year), -7), // Palm Sunday
    lastSundayOfMonth(year, 4),
    lastSundayOfMonth(year, 6),
    lastSundayOfMonth(year, 8),
    ...december,
  ]
    .filter((d) => !off.has(d))
    .sort();
}

export function dayKind(iso: string): DayKind {
  const year = Number(iso.slice(0, 4));
  if (holidays(year).includes(iso)) return "closed";
  if (weekday(iso) === 0) return tradingSundays(year).includes(iso) ? "tradingSunday" : "closed";
  if (iso === addDays(easter(year), -1)) return "holySaturday";
  return "workday";
}

/** All days of a quarter (1–4). */
export function quarterDays(year: number, quarter: number): string[] {
  const start = `${year}-${String((quarter - 1) * 3 + 1).padStart(2, "0")}-01`;
  const end = toIso(new Date(Date.UTC(year, quarter * 3, 1)));
  const days: string[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) days.push(d);
  return days;
}
