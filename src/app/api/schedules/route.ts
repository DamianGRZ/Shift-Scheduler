import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { bad, intParam, parseBody } from "@/lib/http";

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
      staffOverrides: z.record(z.iso.date(), z.int().min(1).max(50)).optional(),
    })
  );
  if (!body) return bad();
  const { id, staffOverrides, ...rest } = body;
  const result = db
    .update(schema.schedules)
    .set({ ...rest, staffOverrides: staffOverrides && JSON.stringify(staffOverrides) }) // undefined = unchanged
    .where(eq(schema.schedules.id, id))
    .run();
  return result.changes ? NextResponse.json({ success: true }) : bad("Nie znaleziono", 404);
}

export async function DELETE(req: NextRequest) {
  const id = intParam(req, "id");
  if (!id) return bad();
  const result = db.delete(schema.schedules).where(eq(schema.schedules.id, id)).run();
  return result.changes ? NextResponse.json({ success: true }) : bad("Nie znaleziono", 404);
}
