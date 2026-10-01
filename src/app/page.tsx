import Link from "next/link";

export default function HomePage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold mb-2">Automatyczny Grafik</h1>
      <p className="text-gray-500 mb-8">
        Kwartalny grafik zmian generowany algorytmem genetycznym, zgodny z polskim prawem pracy
      </p>

      <div className="grid gap-4">
        <Link
          href="/schedules"
          className="block p-6 bg-white rounded-lg border border-gray-200 hover:border-blue-300 transition-colors"
        >
          <h2 className="text-lg font-semibold mb-1">Grafiki</h2>
          <p className="text-sm text-gray-500">Twórz i generuj grafiki kwartalne</p>
        </Link>

        <Link
          href="/employees"
          className="block p-6 bg-white rounded-lg border border-gray-200 hover:border-blue-300 transition-colors"
        >
          <h2 className="text-lg font-semibold mb-1">Pracownicy</h2>
          <p className="text-sm text-gray-500">Etat, okres zatrudnienia, osoby na wyurlopowanie</p>
        </Link>
      </div>
    </div>
  );
}
