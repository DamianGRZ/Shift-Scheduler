import { NextResponse } from "next/server";

// Lets the desktop launcher check that the server on its port is really this app.
export async function GET() {
  return NextResponse.json({ app: "shift-scheduler" });
}
