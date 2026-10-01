"use client";

import { use, useEffect, useRef, useState } from "react";
import { quarterDays, weekday } from "@/lib/calendar";
import { allowedCodes, check, makeCtx, penalty, RULE_LABELS, targetHours, workedHours, hours, weekStarts } from "@/lib/rules";
import type { Code, Ctx, Grid } from "@/lib/rules";
import { evolveFor, initPopulation, makeRng, suggestLeaves, type LeaveSuggestion } from "@/lib/ga";
import { api, latestOnly, type Employee, type Schedule } from "@/lib/api";

interface Assignment {
  employeeId: number;
  date: string;
  code: Code;
  locked: boolean;
}

const COLORS: Record<Code, string> = {
  D: "bg-blue-200",
  R: "bg-green-200",
  P: "bg-amber-200",
  N: "bg-purple-200",
  U: "bg-gray-300",
  "-": "bg-white",
};
const DAY_NAMES = ["Nd", "Pn", "Wt", "Śr", "Cz", "Pt", "So"];
const daysUntil = (iso: string) => (new Date(iso).getTime() - Date.now()) / 86_400_000;

export default function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [grid, setGrid] = useState<Grid>([]);
  const [locked, setLocked] = useState<boolean[][]>([]);
  const [running, setRunning] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [selection, setSelection] = useState<{ e0: number; d0: number; e1: number; d1: number } | null>(null);
  const [suggestions, setSuggestions] = useState<LeaveSuggestion[]>([]);
  const [publishLate, setPublishLate] = useState(false);
  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const stopRef = useRef(false); // a ref, because the GA loop cannot see fresh React state
  const draggingRef = useRef(false);
  // Saves run one at a time; with several quick changes only the latest state is sent.
  const queue = useRef(latestOnly((e) => setError(e.message))).current;

  useEffect(() => {
    (async () => {
      const [s, employees, cells] = await Promise.all([
        api<Schedule>(`/api/schedules?id=${id}`),
        api<Employee[]>("/api/employees"),
        api<Assignment[]>(`/api/assignments?scheduleId=${id}`),
      ]);
      const c = makeCtx(quarterDays(s.year, s.quarter), employees, s.hoursOverride, s.staff, s.staffOverrides);
      const g: Grid = employees.map(() => c.days.map(() => "-"));
      const l = employees.map(() => c.days.map(() => false));
      for (const cell of cells) {
        const e = employees.findIndex((emp) => emp.id === cell.employeeId);
        const d = c.days.indexOf(cell.date);
        if (e < 0 || d < 0) continue;
        g[e][d] = cell.code;
        l[e][d] = cell.locked;
      }
      setSchedule(s);
      setCtx(c);
      setGrid(g);
      setLocked(l);
    })().catch((e) => setError(e.message));
    return () => void (stopRef.current = true); // leaving the page stops the GA
  }, [id]);

  if (error && !schedule) return <div className="text-red-600">{error}</div>;
  if (!schedule || !ctx) return <div className="text-gray-500">Ładowanie...</div>;

  const save = (g: Grid, l: boolean[][]) =>
    queue(() =>
      api("/api/assignments", "PUT", {
        scheduleId: schedule.id,
        cells: g.flatMap((row, e) =>
          row.map((code, d) => ({ employeeId: ctx.employees[e].id, date: ctx.days[d], code, locked: l[e][d] }))
        ),
      })
    );

  const update = (g: Grid, l: boolean[][]) => {
    setGrid(g);
    setLocked(l);
    save(g, l);
  };

  // Schedule settings change (staffing, status): save + rebuild the rules context.
  const saveSchedule = (patch: Partial<Schedule>) => {
    const s = { ...schedule, ...patch };
    setSchedule(s);
    setCtx(makeCtx(ctx.days, ctx.employees, s.hoursOverride, s.staff, s.staffOverrides));
    queue(() => api("/api/schedules", "PUT", { id: schedule.id, ...patch }));
  };

  // Staffing for one day: empty value (or equal to global) = back to global; 0 and fractions are ignored.
  const setDayStaff = (day: string, value: string) => {
    const n = Number(value);
    const staffOverrides = { ...schedule.staffOverrides };
    if (value === "" || n === schedule.staff) delete staffOverrides[day];
    else if (Number.isInteger(n) && n >= 1) staffOverrides[day] = n;
    else return;
    saveSchedule({ staffOverrides });
  };

  // GA: runs until "Stop" is clicked. The champion is shown live in the table.
  const run = async () => {
    stopRef.current = false;
    setRunning(true);
    const rng = makeRng();
    const hasChampion = grid.some((row, e) => row.some((c, d) => c !== "-" && !locked[e][d]));
    let pop = initPopulation(ctx, grid, locked, rng, hasChampion);
    let gen = 0;
    while (!stopRef.current) {
      // Compute for ~100 ms, then yield to the browser so Stop reacts immediately.
      const step = evolveFor(ctx, pop, locked, rng, 100);
      pop = step.pop;
      gen += step.generations;
      setGrid(pop[0].grid);
      setGeneration(gen);
      await new Promise((r) => setTimeout(r, 0));
    }
    setRunning(false);
    save(pop[0].grid, locked);
  };

  // Double-click: next code with a lock (-, R, P, D, U); after the last one the cell becomes empty and unlocked.
  const cycle = (e: number, d: number) => {
    const codes: Code[] = [...allowedCodes(ctx, e, d), "U"];
    const i = codes.indexOf(grid[e][d]);
    const unlock = locked[e][d] && i === codes.length - 1;
    const g = grid.map((row) => [...row]);
    const l = locked.map((row) => [...row]);
    g[e][d] = unlock ? "-" : codes[(i + 1) % codes.length];
    l[e][d] = !unlock;
    update(g, l);
  };

  const inSelection = (e: number, d: number) =>
    !!selection &&
    e >= Math.min(selection.e0, selection.e1) &&
    e <= Math.max(selection.e0, selection.e1) &&
    d >= Math.min(selection.d0, selection.d1) &&
    d <= Math.max(selection.d0, selection.d1);

  // Keyboard: D/R/P/N/U writes the code with a lock into the selected cells (only where allowed);
  // Delete/Backspace clears and unlocks. Other keys are ignored.
  const typeCode = (key: string) => {
    const code = key.toUpperCase() as Code;
    const clear = key === "Delete" || key === "Backspace";
    if (!selection || running || (!clear && !"DRPNU".includes(code))) return false;
    const g = grid.map((row) => [...row]);
    const l = locked.map((row) => [...row]);
    grid.forEach((row, e) =>
      row.forEach((_, d) => {
        if (!inSelection(e, d)) return;
        if (clear) {
          g[e][d] = "-";
          l[e][d] = false;
        } else if (code === "U" || allowedCodes(ctx, e, d).includes(code)) {
          g[e][d] = code;
          l[e][d] = true;
        }
      })
    );
    update(g, l);
    return true;
  };

  const lockSelection = (value: boolean) =>
    update(grid, locked.map((row, e) => row.map((x, d) => (inSelection(e, d) ? value : x))));

  const applyLeave = (s: LeaveSuggestion) => {
    const g = grid.map((row) => [...row]);
    const l = locked.map((row) => [...row]);
    for (let d = s.from; d <= s.to; d++) {
      if (ctx.kinds[d] === "closed" || weekday(ctx.days[d]) === 0) continue;
      g[s.emp][d] = "U";
      l[s.emp][d] = true;
    }
    update(g, l);
    setSuggestions([]);
  };

  // Reset: clears only cells filled by the GA; locked user entries stay.
  const reset = () => {
    if (!confirmReset) return setConfirmReset(true);
    setConfirmReset(false);
    setGeneration(0);
    setSuggestions([]);
    update(grid.map((row, e) => row.map((c, d) => (locked[e][d] ? c : "-"))), locked);
  };

  const publish = () => {
    // The schedule must be handed out at least 7 days before the period (Art. 129 §3); when late, a second click confirms.
    if (daysUntil(ctx.days[0]) < 7 && !publishLate) return setPublishLate(true);
    saveSchedule({ status: "published" });
  };

  const violations = check(ctx, grid, locked);
  const errors = violations.filter((v) => v.hard);
  const warnings = violations.filter((v) => !v.hard && v.rule === "doba");
  const badCells = new Set(errors.map((v) => `${v.emp}:${v.day}`));
  const weeks = weekStarts(ctx.days);
  const button = "px-4 py-2 rounded-lg text-white disabled:opacity-40";

  return (
    <div onMouseUp={() => (draggingRef.current = false)}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold">
            {schedule.quarter}. kwartał {schedule.year}
            {schedule.status === "published" && <span className="ml-2 text-sm text-green-700">zatwierdzony</span>}
          </h1>
          <p className="text-sm text-gray-500">
            Wymiar {ctx.quarterHours}h · kara {penalty(violations)} · generacja {generation}
            <label className="ml-4">
              Obsada (osób na zmianie):
              <input
                type="number"
                min="1"
                value={schedule.staff}
                disabled={running}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 1) saveSchedule({ staff: n });
                }}
                className="ml-1 w-14 px-2 py-0.5 border border-gray-300 rounded"
              />
            </label>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={run} disabled={running} className={`${button} bg-blue-600`}>
            {grid.some((row) => row.some((c) => c !== "-")) ? "Wznów GA" : "Generuj GA"}
          </button>
          <button onClick={() => (stopRef.current = true)} disabled={!running} className={`${button} bg-red-600`}>
            Stop
          </button>
          <button onClick={() => lockSelection(true)} disabled={running || !selection} className={`${button} bg-gray-700`}>
            Akceptuj zaznaczenie
          </button>
          <button onClick={() => lockSelection(false)} disabled={running || !selection} className={`${button} bg-gray-500`}>
            Odblokuj
          </button>
          <button onClick={() => setSuggestions(suggestLeaves(ctx, grid))} disabled={running} className={`${button} bg-teal-600`}>
            Podpowiedz urlopy
          </button>
          <button onClick={reset} disabled={running} className={`${button} bg-orange-600`}>
            {confirmReset ? "Wyczyścić wynik GA?" : "Reset GA"}
          </button>
          <button onClick={publish} disabled={running || errors.length > 0} className={`${button} bg-green-600`}>
            {publishLate ? "Mniej niż 7 dni do startu — zatwierdzić?" : "Zatwierdź"}
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          Błąd zapisu: {error}
          <button onClick={() => setError("")} className="ml-3 underline">
            ukryj
          </button>
        </p>
      )}

      <p className="text-xs text-gray-500 mb-2">
        D 6:30–18:30 · R 6:30–12:30 · P 12:30–18:30 · N niedziela 8–13 · U urlop. Zaznacz komórkę (lub przeciągnij zakres)
        i wpisz literę z klawiatury — kod zostaje zablokowany 🔒; Delete czyści i odblokowuje. Dwuklik przełącza kody po kolei
        (po U wraca do pustej, odblokowanej).
      </p>

      <div
        tabIndex={0}
        onKeyDown={(e) => typeCode(e.key) && e.preventDefault()}
        className="overflow-x-auto bg-white border border-gray-200 rounded-lg select-none focus:outline-none"
      >
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white p-1 text-left">Pracownik</th>
              <th className="p-1">Godz.</th>
              {ctx.days.map((day, d) => (
                <th key={day} className={`p-0.5 font-normal ${ctx.kinds[d] === "closed" ? "bg-gray-100 text-gray-400" : ""}`}>
                  <div>{DAY_NAMES[weekday(day)]}</div>
                  <div>{day.slice(8)}.{day.slice(5, 7)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, e) => {
              const worked = workedHours(ctx, grid, e);
              const target = targetHours(ctx, grid, e);
              return (
                <tr key={ctx.employees[e].id}>
                  <td className="sticky left-0 bg-white p-1 whitespace-nowrap font-medium">{ctx.employees[e].name}</td>
                  <td className={`p-1 whitespace-nowrap ${Math.abs(worked - target) > 6 ? "text-red-600" : ""}`}>
                    {worked}/{target}
                  </td>
                  {row.map((code, d) => (
                    <td
                      key={d}
                      onMouseDown={() => {
                        if (running) return;
                        draggingRef.current = true;
                        setSelection({ e0: e, d0: d, e1: e, d1: d });
                      }}
                      onMouseEnter={() => draggingRef.current && setSelection((s) => s && { ...s, e1: e, d1: d })}
                      onDoubleClick={() => !running && cycle(e, d)}
                      className={`w-7 h-7 text-center border cursor-pointer ${COLORS[code]} ${
                        badCells.has(`${e}:${d}`) ? "border-red-500 border-2" : "border-gray-200"
                      } ${inSelection(e, d) ? "outline-2 outline-blue-500" : ""} ${ctx.kinds[d] === "closed" && code === "-" ? "bg-gray-100" : ""}`}
                    >
                      {code === "-" ? "" : code}
                      {locked[e][d] && <span className="text-[8px]">🔒</span>}
                    </td>
                  ))}
                </tr>
              );
            })}
            <tr className="text-gray-500">
              <td className="sticky left-0 bg-white p-1">Wymagana obsada</td>
              <td />
              {ctx.days.map((day, d) =>
                ctx.kinds[d] === "closed" ? (
                  <td key={d} />
                ) : (
                  <td key={d} className="p-0">
                    <input
                      type="number"
                      min="1"
                      value={ctx.staff[d]}
                      disabled={running}
                      onChange={(e) => setDayStaff(day, e.target.value)}
                      className={`w-7 h-6 text-center text-xs border-0 ${ctx.staff[d] !== schedule.staff ? "bg-orange-100 font-bold" : "bg-transparent"}`}
                    />
                  </td>
                )
              )}
            </tr>
            <tr className="text-gray-500">
              <td className="sticky left-0 bg-white p-1">Obsada rano/po poł.</td>
              <td />
              {ctx.days.map((_, d) => {
                const col = grid.map((row) => row[d]);
                const morning = col.filter((c) => c === "D" || c === "R" || c === "N").length;
                const afternoon = col.filter((c) => c === "D" || c === "P").length;
                return (
                  <td key={d} className={`text-center ${badCells.has(`-1:${d}`) ? "text-red-600 font-bold" : ""}`}>
                    {ctx.kinds[d] === "closed" ? "" : ctx.kinds[d] === "tradingSunday" ? morning : `${morning}/${afternoon}`}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="font-semibold mt-6 mb-2">Godziny w tygodniach pon–ndz (maks. 48h)</h2>
      <table className="text-xs bg-white border border-gray-200 rounded-lg">
        <tbody>
          {grid.map((row, e) => (
            <tr key={e}>
              <td className="p-1 font-medium">{ctx.employees[e].name}</td>
              {weeks.map((w, i) => {
                const end = weeks[i + 1] ?? ctx.days.length;
                const sum = row.slice(w, end).reduce((s, c, j) => s + hours(c, ctx.kinds[w + j]), 0);
                return (
                  <td key={w} className={`p-1 text-center w-10 ${sum > 48 ? "text-red-600 font-bold" : ""}`}>
                    {sum}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {suggestions.length > 0 && (
        <div className="mt-6 p-4 bg-teal-50 border border-teal-200 rounded-lg">
          <h2 className="font-semibold mb-2">Możliwe urlopy tygodniowe</h2>
          <ul className="space-y-1 text-sm">
            {suggestions.map((s, i) => (
              <li key={i}>
                {ctx.employees[s.emp].name}: {ctx.days[s.from]} – {ctx.days[s.to]}
                <button onClick={() => applyLeave(s)} className="ml-3 text-teal-700 underline">
                  Wpisz urlop
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(errors.length > 0 || warnings.length > 0) && (
        <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm">
          <h2 className="font-semibold text-red-800 mb-2">
            Błędy: {errors.length}, ostrzeżenia: {warnings.length}
          </h2>
          <ul className="space-y-1 max-h-64 overflow-y-auto">
            {[...errors, ...warnings].map((v, i) => (
              <li key={i} className={v.hard ? "text-red-700" : "text-yellow-700"}>
                {RULE_LABELS[v.rule]}
                {v.emp >= 0 && ` — ${ctx.employees[v.emp].name}`}
                {v.day >= 0 && ` — ${ctx.days[v.day]}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
