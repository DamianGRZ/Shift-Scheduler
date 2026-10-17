// Rejects requests whose Host header is not this machine. The app has no login, so this stops
// web pages from reaching the local API through DNS rebinding.
import { NextResponse, type NextRequest } from "next/server";

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

export function proxy(req: NextRequest) {
  if (!LOCAL_HOST.test(req.headers.get("host") ?? "")) return new NextResponse("Forbidden", { status: 403 });
  return NextResponse.next();
}
