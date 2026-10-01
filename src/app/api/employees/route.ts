import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { bad, intParam, parseBody } from "@/lib/http";

const Employee = z.object({
  name: z.string().trim().min(1).max(100),
  fte: z.number().positive().max(1).default(1),
  employedFrom: z.iso.date().nullable().default(null),
  employedTo: z.iso.date().nullable().default(null),
});

export async function GET() {
  return NextResponse.json(db.select().from(schema.employees).all());
}

export async function POST(req: NextRequest) {
  const body = await parseBody(req, Employee);
  if (!body) return bad();
  return NextResponse.json(db.insert(schema.employees).values(body).returning().get(), { status: 201 });
}

export async function PUT(req: NextRequest) {
  const body = await parseBody(req, Employee.extend({ id: z.int().positive() }));
  if (!body) return bad();
  const { id, ...data } = body;
  const result = db.update(schema.employees).set(data).where(eq(schema.employees.id, id)).run();
  return result.changes ? NextResponse.json({ success: true }) : bad("Nie znaleziono", 404);
}

export async function DELETE(req: NextRequest) {
  const id = intParam(req, "id");
  if (!id) return bad();
  const result = db.delete(schema.employees).where(eq(schema.employees.id, id)).run();
  return result.changes ? NextResponse.json({ success: true }) : bad("Nie znaleziono", 404);
}
