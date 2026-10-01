// API client for components: one place for headers and error handling.
import type { employees, schedules } from "@/db/schema";

export type Employee = typeof employees.$inferSelect;
export type Schedule = Omit<typeof schedules.$inferSelect, "staffOverrides"> & {
  staffOverrides: Record<string, number>; // the API sends/receives an object; the DB stores JSON text
};

/** fetch that throws an Error with the server message when the response is not 2xx. */
export async function api<T = unknown>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Błąd ${res.status}`);
  return data as T;
}

/**
 * "Latest only" queue: while a save is in flight, newer calls replace each other and
 * only the last one is sent when the current save finishes. Prevents racing PUTs.
 */
export function latestOnly(onError: (e: Error) => void) {
  let busy = false;
  let next: (() => Promise<unknown>) | null = null;
  const run = async (job: () => Promise<unknown>) => {
    if (busy) return void (next = job);
    busy = true;
    try {
      await job();
    } catch (e) {
      onError(e as Error);
    } finally {
      busy = false;
      if (next) {
        const job = next;
        next = null;
        run(job);
      }
    }
  };
  return run;
}
