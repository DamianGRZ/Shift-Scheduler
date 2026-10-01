import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { bad, intParam, parseBody } from "@/lib/http";
import { quarterDays } from "@/lib/calendar";

export async function GET(req: NextRequest) {
  const scheduleId = intParam(req, "scheduleId");
  if (!scheduleId) return bad();
  return NextResponse.json(
    db.select().from(schema.assignments).where(eq(schema.assignments.scheduleId, scheduleId)).all()
  );
}

const Body = z.object({
  scheduleId: z.int().positive(),
  cells: z
    .array(
      z.object({
        employeeId: z.int().positive(),
        date: z.iso.date(),
        code: z.enum(["D", "R", "P", "N", "U", "-"]),
        locked: z.boolean(),
      })
    )
    .max(50 * 92), // 50 employees × days in a quarter
});

/** Replaces the whole schedule. Only cells with a code or a lock are stored. */
export async function PUT(req: NextRequest) {
  const body = await parseBody(req, Body);
  if (!body) return bad();
  const { scheduleId, cells } = body;

  const schedule = db.select().from(schema.schedules).where(eq(schema.schedules.id, scheduleId)).get();
  if (!schedule) return bad("Nie znaleziono grafiku", 404);
  const days = new Set(quarterDays(schedule.year, schedule.quarter));
  const employees = new Set(db.select({ id: schema.employees.id }).from(schema.employees).all().map((e) => e.id));
  const keys = new Set(cells.map((c) => `${c.employeeId}:${c.date}`));
  if (keys.size !== cells.length) return bad("Powtórzona komórka");
  if (!cells.every((c) => days.has(c.date) && employees.has(c.employeeId))) return bad("Komórka spoza grafiku");

  const rows = cells.filter((c) => c.code !== "-" || c.locked).map((c) => ({ ...c, scheduleId }));
  db.transaction((tx) => {
    tx.delete(schema.assignments).where(eq(schema.assignments.scheduleId, scheduleId)).run();
    if (rows.length) tx.insert(schema.assignments).values(rows).run();
  });
  return NextResponse.json({ success: true });
}
