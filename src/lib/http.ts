// Helpers for route handlers: safe parsing of JSON bodies and URL params.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const bad = (error = "Nieprawidłowe dane", status = 400) => NextResponse.json({ error }, { status });

/** Body parsed as JSON and validated against the schema; null when the JSON is broken or does not match. */
export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const parsed = schema.safeParse(await req.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Positive int from the query string; null when missing or invalid. */
export function intParam(req: NextRequest, key: string): number | null {
  const parsed = z.coerce.number().int().positive().safeParse(req.nextUrl.searchParams.get(key));
  return parsed.success ? parsed.data : null;
}
