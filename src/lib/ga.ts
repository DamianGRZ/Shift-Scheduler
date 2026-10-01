// Genetic algorithm. Chromosome = grid [employee][day] of shift codes.
// Genes marked `locked` (user entries and accepted cells) never change.
import { weekday } from "./calendar";
import { allowedCodes, check, isEmployed, penalty, weekStarts, type Code, type Ctx, type Grid } from "./rules";

export interface Individual {
  grid: Grid;
  score: number; // penalty, lower is better
}

/** Seeded random generator (mulberry32); a fixed seed makes tests reproducible. */
export function makeRng(seed = Date.now()) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pick = <T>(items: T[], rng: Rng) => items[Math.floor(rng() * items.length)];

function evaluate(ctx: Ctx, grid: Grid, locked: boolean[][]): Individual {
  return { grid, score: penalty(check(ctx, grid, locked)) };
}

function randomGene(ctx: Ctx, e: number, d: number, rng: Rng): Code {
  const codes = allowedCodes(ctx, e, d);
  return codes.length > 1 && rng() < 0.55 ? pick(codes.slice(1), rng) : "-";
}

function randomGrid(ctx: Ctx, base: Grid, locked: boolean[][], rng: Rng): Grid {
  return base.map((row, e) => row.map((c, d) => (locked[e][d] ? c : randomGene(ctx, e, d, rng))));
}

/** Mutation: change one gene, or swap the genes of two employees on the same day. */
function mutate(ctx: Ctx, grid: Grid, locked: boolean[][], rng: Rng): Grid {
  const child = grid.map((row) => [...row]);
  const times = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < times; i++) {
    const d = Math.floor(rng() * ctx.days.length);
    const a = Math.floor(rng() * child.length);
    const b = Math.floor(rng() * child.length);
    if (locked[a][d]) continue;
    if (rng() < 0.5 || locked[b][d]) {
      child[a][d] = randomGene(ctx, a, d, rng);
    } else if (allowedCodes(ctx, a, d).includes(child[b][d]) && allowedCodes(ctx, b, d).includes(child[a][d])) {
      [child[a][d], child[b][d]] = [child[b][d], child[a][d]];
    }
  }
  return child;
}

/** Crossover: each 7-day block (for all employees) is taken from one of the parents. */
function crossover(a: Grid, b: Grid, rng: Rng): Grid {
  const days = a[0]?.length ?? 0;
  const child = a.map((row) => [...row]);
  for (let w = 0; w < days; w += 7) {
    if (rng() < 0.5) continue;
    for (let e = 0; e < child.length; e++) {
      for (let d = w; d < Math.min(w + 7, days); d++) child[e][d] = b[e][d];
    }
  }
  return child;
}

function tournament(pop: Individual[], rng: Rng): Individual {
  const a = pick(pop, rng);
  const b = pick(pop, rng);
  const c = pick(pop, rng);
  return [a, b, c].reduce((best, x) => (x.score < best.score ? x : best));
}

/**
 * Initial population. If there is a champion (previous result, possibly edited by the user),
 * the population = champion + its mutants + ~10% random individuals.
 */
export function initPopulation(ctx: Ctx, base: Grid, locked: boolean[][], rng: Rng, hasChampion: boolean, size = 80) {
  const pop: Individual[] = [];
  if (hasChampion) {
    pop.push(evaluate(ctx, base, locked));
    while (pop.length < size * 0.9) pop.push(evaluate(ctx, mutate(ctx, base, locked, rng), locked));
  }
  while (pop.length < size) pop.push(evaluate(ctx, randomGrid(ctx, base, locked, rng), locked));
  return pop.sort((x, y) => x.score - y.score);
}

/** Runs generations. Returns the population sorted best-first (pop[0] = champion). */
export function evolve(ctx: Ctx, pop: Individual[], locked: boolean[][], rng: Rng, generations: number) {
  for (let g = 0; g < generations; g++) {
    const next = pop.slice(0, 2); // elite
    while (next.length < pop.length) {
      const a = tournament(pop, rng);
      const b = tournament(pop, rng);
      const grid = rng() < 0.8 ? crossover(a.grid, b.grid, rng) : a.grid;
      next.push(evaluate(ctx, mutate(ctx, grid, locked, rng), locked));
    }
    pop = next.sort((x, y) => x.score - y.score);
  }
  return pop;
}

/** Evolves for about `ms` milliseconds (in chunks of 5 generations). Returns the population and generation count. */
export function evolveFor(ctx: Ctx, pop: Individual[], locked: boolean[][], rng: Rng, ms: number) {
  const until = performance.now() + ms;
  let generations = 0;
  while (performance.now() < until) {
    pop = evolve(ctx, pop, locked, rng, 5);
    generations += 5;
  }
  return { pop, generations };
}

export interface LeaveSuggestion {
  emp: number;
  from: number; // day index
  to: number;
}

/**
 * Weeks in which an employee can take leave: on every open day enough people remain
 * to cover staffing, and 48h per person is enough to cover the whole week.
 * Weeks where a temporary (cover) employee works come first.
 */
export function suggestLeaves(ctx: Ctx, grid: Grid): LeaveSuggestion[] {
  const { days, kinds, employees } = ctx;
  const available = (e: number, d: number) => isEmployed(employees[e], days[d]) && grid[e][d] !== "U";
  const openHours = (d: number) =>
    kinds[d] === "workday" ? 12 : kinds[d] === "holySaturday" ? 7.5 : kinds[d] === "tradingSunday" ? 5 : 0;
  const result: (LeaveSuggestion & { withTemp: boolean })[] = [];

  const starts = weekStarts(days);
  for (const [i, w] of starts.entries()) {
    const week = days.slice(w, starts[i + 1] ?? days.length).map((_, j) => w + j);
    const needed = week.reduce((sum, d) => sum + ctx.staff[d] * openHours(d), 0);
    const withTemp = employees.some(
      (emp, e) => (emp.employedFrom || emp.employedTo) && week.some((d) => available(e, d))
    );

    employees.forEach((emp, e) => {
      if (emp.employedFrom || emp.employedTo) return;
      if (!week.some((d) => available(e, d) && weekday(days[d]) !== 0 && kinds[d] !== "closed")) return;
      const others = employees.map((_, o) => o).filter((o) => o !== e);
      const enoughPeople = week.every(
        (d) => openHours(d) === 0 || others.filter((o) => available(o, d)).length >= ctx.staff[d]
      );
      const capacity = others.reduce((sum, o) => sum + (48 * week.filter((d) => available(o, d)).length) / 7, 0);
      if (enoughPeople && capacity >= needed) result.push({ emp: e, from: w, to: week[week.length - 1], withTemp });
    });
  }

  return result.sort((a, b) => Number(b.withTemp) - Number(a.withTemp)).map(({ emp, from, to }) => ({ emp, from, to }));
}
