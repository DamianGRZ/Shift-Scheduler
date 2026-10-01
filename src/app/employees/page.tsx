"use client";

import { useState, useEffect } from "react";
import { api, type Employee } from "@/lib/api";

const input = "px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [newName, setNewName] = useState("");
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const refresh = () => api<Employee[]>("/api/employees").then(setEmployees).catch((e) => setError(e.message));

  useEffect(() => {
    refresh();
  }, []);

  // Every action: save → refresh the list; errors are shown in a red bar.
  const act = (job: Promise<unknown>) => {
    setError("");
    job.then(refresh).catch((e) => setError(e.message));
  };

  const addEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    act(api("/api/employees", "POST", { name: newName }));
    setNewName("");
  };

  const saveEmployee = (emp: Employee) => act(api("/api/employees", "PUT", emp));

  // First click asks "Na pewno?", second deletes (confirm() may be blocked by the browser).
  const deleteEmployee = (id: number) => {
    if (confirmId !== id) return setConfirmId(id);
    setConfirmId(null);
    act(api(`/api/employees?id=${id}`, "DELETE"));
  };

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold mb-2">Pracownicy</h1>
      <p className="text-sm text-gray-500 mb-6">
        Osoba „na wyurlopowanie” to pracownik z okresem zatrudnienia (od–do). Puste pola = zatrudniony na stałe.
      </p>
      {error && <p className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</p>}

      <form onSubmit={addEmployee} className="flex gap-3 mb-8">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Imię i nazwisko"
          className={`flex-1 ${input}`}
        />
        <button type="submit" className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          Dodaj
        </button>
      </form>

      <table className="w-full bg-white rounded-lg border border-gray-200 text-sm">
        <thead className="text-left text-gray-500">
          <tr>
            <th className="p-3">Pracownik</th>
            <th className="p-3">Etat</th>
            <th className="p-3">Zatrudniony od</th>
            <th className="p-3">do</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => (
            <tr key={emp.id} className="border-t border-gray-100">
              <td className="p-3 font-medium">{emp.name}</td>
              <td className="p-3">
                <input
                  type="number"
                  step="0.25"
                  min="0.25"
                  max="1"
                  defaultValue={emp.fte}
                  onBlur={(e) => {
                    const fte = Number(e.target.value);
                    if (fte > 0 && fte <= 1 && fte !== emp.fte) saveEmployee({ ...emp, fte });
                    else e.target.value = String(emp.fte);
                  }}
                  className={`w-20 ${input}`}
                />
              </td>
              <td className="p-3">
                <input
                  type="date"
                  defaultValue={emp.employedFrom ?? ""}
                  onBlur={(e) => saveEmployee({ ...emp, employedFrom: e.target.value || null })}
                  className={input}
                />
              </td>
              <td className="p-3">
                <input
                  type="date"
                  defaultValue={emp.employedTo ?? ""}
                  onBlur={(e) => saveEmployee({ ...emp, employedTo: e.target.value || null })}
                  className={input}
                />
              </td>
              <td className="p-3 text-right">
                <button onClick={() => deleteEmployee(emp.id)} className="text-red-600 hover:text-red-800">
                  {confirmId === emp.id ? "Na pewno?" : "Usuń"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
