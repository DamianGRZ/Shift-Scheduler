import { expect, it } from "vitest";
import { quarterDays, tradingSundays } from "../calendar";
import { check, makeCtx, targetHours, workedHours, type Code, type Grid } from "../rules";
import { evolve, initPopulation, makeRng } from "../ga";

// 4 people: with 2 per shift there is ~150h of slack per quarter for leave.
const employees = [1, 2, 3, 4].map((id) => ({ id, name: `P${id}`, fte: 1, employedFrom: null, employedTo: null }));
const emptyGrid = (rows: number, days: number): Grid => Array.from({ length: rows }, () => Array<Code>(days).fill("-"));

it("trading Sundays 2026", () => {
  expect(tradingSundays(2026)).toEqual([
    "2026-01-25", "2026-03-29", "2026-04-26", "2026-06-28",
    "2026-08-30", "2026-12-06", "2026-12-13", "2026-12-20",
  ]);
});

it("after a P shift, R on the next day is not allowed", () => {
  const ctx = makeCtx(quarterDays(2026, 4), employees.slice(0, 1));
  const grid = emptyGrid(1, ctx.days.length);
  grid[0][0] = "P";
  grid[0][1] = "R";
  expect(check(ctx, grid).some((v) => v.rule === "doba" && v.hard)).toBe(true);
});

it("5 D shifts Mon 12 Oct to Sat 17 Oct exceed 48h and give 3 consecutive 12h shifts", () => {
  const ctx = makeCtx(quarterDays(2026, 4), employees.slice(0, 1));
  const grid = emptyGrid(1, ctx.days.length);
  for (const day of ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-16", "2026-10-17"]) grid[0][ctx.days.indexOf(day)] = "D";
  const rules = check(ctx, grid).filter((v) => v.hard).map((v) => v.rule);
  expect(rules).toContain("week48");
  expect(rules).toContain("threeD");
});

it("staffing: exactly as many people as set globally or for a given day", () => {
  const days = quarterDays(2026, 4);
  const ctx = makeCtx(days, employees, null, 2, { "2026-10-02": 3 });
  const grid = emptyGrid(4, days.length);
  for (let e = 0; e < 3; e++) grid[e][0] = grid[e][1] = "D"; // 3 people on 1 Oct (too many) and 2 Oct (exact)
  const v = check(ctx, grid).filter((x) => x.day <= 1 && x.emp === -1);
  expect(v.filter((x) => x.day === 0).map((x) => x.rule)).toEqual(["overstaff", "overstaff"]);
  expect(v.filter((x) => x.day === 1)).toEqual([]);
});

it("Mon–Sat work with Sunday off gives 36h rest, so no 35h violation", () => {
  const ctx = makeCtx(quarterDays(2026, 4), employees.slice(0, 1));
  const grid = emptyGrid(1, ctx.days.length);
  ctx.days.forEach((day, d) => {
    if (day >= "2026-10-12" && day <= "2026-10-24" && ctx.kinds[d] === "workday") grid[0][d] = d % 2 ? "R" : "P";
  });
  expect(check(ctx, grid).map((v) => v.rule)).not.toContain("rest35");
});

it("GA: no hard violations, even hours, locked genes untouched", () => {
  const ctx = makeCtx(quarterDays(2026, 4), employees);
  const base = emptyGrid(4, ctx.days.length);
  const locked = base.map((row) => row.map(() => false));
  base[0][0] = "U";
  locked[0][0] = true;

  const rng = makeRng(42);
  const best = evolve(ctx, initPopulation(ctx, base, locked, rng, false), locked, rng, 3000)[0].grid;

  expect(check(ctx, best, locked).filter((v) => v.hard && v.amount > 0)).toEqual([]);
  // Shop hours (~1830h) do not cover 4 × 496h; the rest is leave, and the shortfall must be split evenly.
  const worked = employees.map((_, e) => workedHours(ctx, best, e));
  expect(Math.max(...worked) - Math.min(...worked)).toBeLessThanOrEqual(18); // about one shift of difference
  expect(worked.every((h, e) => h <= targetHours(ctx, best, e) && h >= 440)).toBe(true);
  expect(best[0][0]).toBe("U");
}, 120_000);
