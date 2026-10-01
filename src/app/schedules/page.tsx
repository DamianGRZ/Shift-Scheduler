"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { api, type Schedule } from "@/lib/api";
import { DEFAULT_QUARTER_HOURS } from "@/lib/rules";

const input = "px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(new Date().getMonth() / 3) + 1);
  const [hours, setHours] = useState("");
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const refresh = () => api<Schedule[]>("/api/schedules").then(setSchedules).catch((e) => setError(e.message));

  useEffect(() => {
    refresh();
  }, []);

  const act = (job: Promise<unknown>) => {
    setError("");
    job.then(refresh).catch((e) => setError(e.message));
  };

  const addSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    act(api("/api/schedules", "POST", { year, quarter, hoursOverride: hours ? Number(hours) : null }));
  };

  // First click asks "Na pewno?", second deletes (confirm() may be blocked by the browser).
  const deleteSchedule = (id: number) => {
    if (confirmId !== id) return setConfirmId(id);
    setConfirmId(null);
    act(api(`/api/schedules?id=${id}`, "DELETE"));
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">Grafiki kwartalne</h1>
      {error && <p className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</p>}

      <form onSubmit={addSchedule} className="flex flex-wrap items-end gap-3 mb-8 p-4 bg-white rounded-lg border border-gray-200">
        <label className="text-sm">
          Rok
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className={`block w-28 ${input}`} />
        </label>
        <label className="text-sm">
          Kwartał
          <select value={quarter} onChange={(e) => setQuarter(Number(e.target.value))} className={`block ${input}`}>
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Wymiar (h)
          <input
            type="number"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder={String(DEFAULT_QUARTER_HOURS)}
            className={`block w-28 ${input}`}
          />
        </label>
        <button type="submit" className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Utwórz grafik
        </button>
      </form>

      <div className="space-y-2">
        {schedules.map((s) => (
          <div key={s.id} className="flex items-center justify-between px-4 py-3 bg-white rounded-lg border border-gray-200">
            <div>
              <Link href={`/schedules/${s.id}`} className="font-medium text-blue-600 hover:underline">
                {s.quarter}. kwartał {s.year}
              </Link>
              <span className="ml-3 text-sm text-gray-500">{s.hoursOverride ?? DEFAULT_QUARTER_HOURS}h</span>
              <span
                className={`ml-2 px-2 py-0.5 text-xs rounded ${
                  s.status === "published" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                }`}
              >
                {s.status === "published" ? "Zatwierdzony" : "Szkic"}
              </span>
            </div>
            <button onClick={() => deleteSchedule(s.id)} className="text-sm text-red-600 hover:text-red-800">
              {confirmId === s.id ? "Na pewno?" : "Usuń"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
