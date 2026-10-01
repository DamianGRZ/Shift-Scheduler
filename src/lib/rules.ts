// Schedule rules. The same `check` function is the validator in the UI and the fitness in the GA.
import { dayKind, weekday, type DayKind } from "./calendar";
import type { employees } from "@/db/schema";

// D 6:30–18:30, R 6:30–12:30, P 12:30–18:30, N 8–13 (trading Sunday), U leave, - day off
type WorkCode = "D" | "R" | "P" | "N";
export type Code = WorkCode | "U" | "-";
export type Grid = Code[][]; // [employee][day]

export type Employee = typeof employees.$inferSelect;

export const DEFAULT_QUARTER_HOURS = 496;

export interface Ctx {
  days: string[];
  kinds: DayKind[];
  employees: Employee[];
  quarterHours: number; // default 496
  staff: number[]; // exact staffing for each day
}

export interface Violation {
  rule: string;
  emp: number; // -1 = whole shop
  day: number; // -1 = whole period
  hard: boolean;
  amount: number;
}

export const RULE_LABELS: Record<string, string> = {
  staff: "Za mało osób w sklepie",
  code: "Zmiana w dniu zamkniętym lub poza zatrudnieniem",
  doba: "Ponowna praca w tej samej dobie pracowniczej",
  threeD: "Więcej niż 2 zmiany 12h pod rząd",
  week48: "Ponad 48h w tygodniu (pon–ndz)",
  rest35: "Brak 35h odpoczynku tygodniowego",
  freeSunday: "Brak wolnej niedzieli w 4 tygodniach",
  december: "Więcej niż 2 z 3 grudniowych niedziel handlowych",
  hours: "Odchylenie od wymiaru godzin",
  overstaff: "Za dużo osób w sklepie",
  fairness: "Nierówny rozkład niedziel / zmian 12h",
};

// Shift start and end in minutes from midnight.
const SHIFTS: Record<WorkCode, [number, number]> = {
  D: [390, 1110],
  R: [390, 750],
  P: [750, 1110],
  N: [480, 780],
};

export const isWork = (c: Code): c is WorkCode => c in SHIFTS;

function shiftTimes(c: WorkCode, kind: DayKind): [number, number] {
  const [start, end] = SHIFTS[c];
  return [start, kind === "holySaturday" ? Math.min(end, 840) : end]; // Holy Saturday: shop closes at 14:00
}

export function hours(c: Code, kind: DayKind): number {
  if (!isWork(c)) return 0;
  const [start, end] = shiftTimes(c, kind);
  return (end - start) / 60;
}

export function makeCtx(
  days: string[],
  employees: Employee[],
  quarterHours: number | null = null,
  staff = 2,
  staffOverrides: Record<string, number> = {}
): Ctx {
  return {
    days,
    kinds: days.map(dayKind),
    employees,
    quarterHours: quarterHours ?? DEFAULT_QUARTER_HOURS,
    staff: days.map((day) => staffOverrides[day] ?? staff),
  };
}

export function isEmployed(emp: Employee, day: string): boolean {
  return (!emp.employedFrom || day >= emp.employedFrom) && (!emp.employedTo || day <= emp.employedTo);
}

/** Codes the GA may insert (leave is entered by the user only). */
export function allowedCodes(ctx: Ctx, e: number, d: number): Code[] {
  const kind = ctx.kinds[d];
  if (kind === "closed" || !isEmployed(ctx.employees[e], ctx.days[d])) return ["-"];
  if (kind === "tradingSunday") return ["-", "N"];
  return ["-", "R", "P", "D"];
}

/** Target: 496h × FTE × employed fraction of the quarter, minus 8h per leave day (Mon–Sat, not a holiday). */
export function targetHours(ctx: Ctx, grid: Grid, e: number): number {
  const emp = ctx.employees[e];
  const employedDays = ctx.days.filter((day) => isEmployed(emp, day)).length;
  const leaveDays = grid[e].filter(
    (c, d) => c === "U" && ctx.kinds[d] !== "closed" && weekday(ctx.days[d]) !== 0
  ).length;
  const base = Math.round((2 * ctx.quarterHours * emp.fte * employedDays) / ctx.days.length) / 2;
  return Math.max(0, base - 8 * leaveDays);
}

export function workedHours(ctx: Ctx, grid: Grid, e: number): number {
  return grid[e].reduce((sum, c, d) => sum + hours(c, ctx.kinds[d]), 0);
}

/** Day indexes where calendar weeks start (first day of the period and every Monday). */
export function weekStarts(days: string[]): number[] {
  return days.map((_, d) => d).filter((d) => d === 0 || weekday(days[d]) === 1);
}

/**
 * Returns the list of violations. A working-day violation between two locked user
 * entries is only a warning (amount 0), because user entries are never changed.
 */
export function check(ctx: Ctx, grid: Grid, locked?: boolean[][]): Violation[] {
  const out: Violation[] = [];
  const add = (rule: string, emp: number, day: number, hard: boolean, amount: number) =>
    out.push({ rule, emp, day, hard, amount });
  const { days, kinds, employees } = ctx;

  // Staffing: exactly ctx.staff[d] people in the morning (R+D+N) and afternoon (P+D); Sundays count the morning only.
  for (let d = 0; d < days.length; d++) {
    if (kinds[d] === "closed") continue;
    const column = grid.map((row) => row[d]);
    const morning = column.filter((c) => c === "D" || c === "R" || c === "N").length;
    const afternoon = column.filter((c) => c === "D" || c === "P").length;
    const counts = kinds[d] === "tradingSunday" ? [morning] : [morning, afternoon];
    for (const n of counts) {
      if (n < ctx.staff[d]) add("staff", -1, d, true, ctx.staff[d] - n);
      if (n > ctx.staff[d]) add("overstaff", -1, d, true, n - ctx.staff[d]);
    }
  }

  // [week start index, number of days up to and including Sunday]
  const weeks = weekStarts(days).map((w) => [w, Math.min(days.length - w, 7 - ((weekday(days[w]) + 6) % 7))]);
  const sundays = days.map((_, d) => d).filter((d) => weekday(days[d]) === 0);
  const decemberSundays = sundays.filter((d) => kinds[d] === "tradingSunday" && days[d].slice(5, 7) === "12");

  grid.forEach((row, e) => {
    for (let d = 0; d < days.length; d++) {
      const c = row[d];
      if (isWork(c) && !allowedCodes(ctx, e, d).includes(c)) add("code", e, d, true, 1);

      // Working day (doba pracownicza): tomorrow's shift may not start earlier than today's.
      const next = row[d + 1];
      if (next && isWork(c) && isWork(next) && SHIFTS[next][0] < SHIFTS[c][0]) {
        const byUser = !!locked?.[e][d] && !!locked?.[e][d + 1];
        add("doba", e, d + 1, !byUser, byUser ? 0 : 1);
      }
    }

    // At most 2 consecutive 12h shifts.
    for (let d = 2; d < days.length; d++) {
      if (row[d] === "D" && row[d - 1] === "D" && row[d - 2] === "D") add("threeD", e, d, true, 1);
    }

    // Calendar weeks Mon–Sun: max 48h.
    for (const [w, length] of weeks) {
      const sum = row.slice(w, w + length).reduce((s, c, i) => s + hours(c, kinds[w + i]), 0);
      if (sum > 48) add("week48", e, w, true, sum - 48);
    }

    // 35h weekly rest: every full week must overlap some break ≥ 35h
    // (the break may span Saturday to Monday). Time in minutes from the start of the period.
    const rested = new Set<number>();
    const markRest = (from: number, to: number) => {
      if (to - from < 35 * 60) return;
      for (const [w, length] of weeks) if (from < (w + length) * 1440 && to > w * 1440) rested.add(w);
    };
    let lastEnd = 0;
    for (let d = 0; d < days.length; d++) {
      const c = row[d];
      if (!isWork(c)) continue;
      const [start, end] = shiftTimes(c, kinds[d]);
      markRest(lastEnd, d * 1440 + start);
      lastEnd = d * 1440 + end;
    }
    markRest(lastEnd, days.length * 1440);
    for (const [w, length] of weeks) if (length === 7 && !rested.has(w)) add("rest35", e, w, true, 1);

    // At least one free Sunday in every 4 consecutive Sundays (Art. 151¹² of the Labour Code).
    // The current calendar never has 4 trading Sundays in a row, so this rule rarely fires;
    // it stays in case the law changes.
    for (let i = 0; i + 4 <= sundays.length; i++) {
      if (sundays.slice(i, i + 4).every((d) => row[d] === "N")) add("freeSunday", e, sundays[i + 3], true, 1);
    }

    const decemberWorked = decemberSundays.filter((d) => row[d] === "N").length;
    if (decemberWorked > 2) add("december", e, decemberSundays[2], true, decemberWorked - 2);

    // Squared deviation: when there are not enough hours for everyone, the shortfall is spread evenly.
    const diff = Math.abs(workedHours(ctx, grid, e) - targetHours(ctx, grid, e));
    if (diff > 0) add("hours", e, -1, false, (diff * diff) / 10);
  });

  // Fair split of Sundays and 12h shifts among permanent employees.
  const regular = grid.filter((_, e) => !employees[e].employedFrom && !employees[e].employedTo);
  for (const code of ["N", "D"]) {
    const counts = regular.map((row) => row.filter((c) => c === code).length);
    const spread = counts.length ? Math.max(...counts) - Math.min(...counts) : 0;
    if (spread > 1) add("fairness", -1, -1, false, spread - 1);
  }

  return out;
}

/** Penalty to minimise: a hard violation weighs 1000, a soft one 1. */
export function penalty(violations: Violation[]): number {
  return violations.reduce((sum, v) => sum + (v.hard ? 1000 : 1) * v.amount, 0);
}
