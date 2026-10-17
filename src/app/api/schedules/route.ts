import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { bad, intParam, parseBody } from "@/lib/http";
import { quarterDays } from "@/lib/calendar";

// staffOverrides is JSON text in the DB; the API accepts and returns an object { "YYYY-MM-DD": number }.
const withOverrides = (s: typeof schema.schedules.$inferSelect) => ({
  ...s,
  staffOverrides: JSON.parse(s.staffOverrides) as Record<string, number>,
});

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.has("id")) {
    const id = intParam(req, "id");
    const schedule = id && db.select().from(schema.schedules).where(eq(schema.schedules.id, id)).get();
    return schedule ? NextResponse.json(withOverrides(schedule)) : bad("Nie znaleziono", 404);
  }
  return NextResponse.json(db.select().from(schema.schedules).all().map(withOverrides));
}

export async function POST(req: NextRequest) {
  const body = await parseBody(
    req,
    z.object({
      year: z.int().min(2025).max(2100),
      quarter: z.int().min(1).max(4),
      hoursOverride: z.int().positive().max(1000).nullable().default(null),
    })
  );
  if (!body) return bad();
  const existing = db
    .select({ id: schema.schedules.id })
    .from(schema.schedules)
    .where(and(eq(schema.schedules.year, body.year), eq(schema.schedules.quarter, body.quarter)))
    .get();
  if (existing) return bad("Grafik na ten kwartał już istnieje", 409);
  const created = db.insert(schema.schedules).values(body).returning().get();
  return NextResponse.json(withOverrides(created), { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await parseBody(
    req,
    z.object({
      id: z.int().positive(),
      status: z.enum(["draft", "published"]).optional(),
      hoursOverride: z.int().positive().max(1000).nullable().optional(),
      staff: z.int().min(1).max(50).optional(),
      staffOverrides: z
        .record(z.iso.date(), z.int().min(1).max(50))
        .refine((o) => Object.keys(o).length <= 92) // at most one entry per day of a quarter
        .optional(),
    })
  );
  if (!body) return bad();
  const { id, staffOverrides, ...rest } = body;
  const schedule = db.select().from(schema.schedules).where(eq(schema.schedules.id, id)).get();
  if (!schedule) return bad("Nie znaleziono", 404);
  // Per-day staffing may only refer to days of this schedule's quarter.
  const days = new Set(quarterDays(schedule.year, schedule.quarter));
  if (staffOverrides && !Object.keys(staffOverrides).every((day) => days.has(day))) return bad("Dzień spoza grafiku");
  db.update(schema.schedules)
    .set({ ...rest, staffOverrides: staffOverrides && JSON.stringify(staffOverrides) }) // undefined = unchanged
    .where(eq(schema.schedules.id, id))
    .run();
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const id = intParam(req, "id");
  if (!id) return bad();
  const result = db.delete(schema.schedules).where(eq(schema.schedules.id, id)).run();
  return result.changes ? NextResponse.json({ success: true }) : bad("Nie znaleziono", 404);
}
