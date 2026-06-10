import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/route";

// Proxies file-level hotspot analytics for a project from the Python backend.
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('project_id') || '';
  const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8001';

  try {
    const res = await fetch(`${backendUrl}/hotspots?project_id=${encodeURIComponent(projectId)}`);
    if (!res.ok) {
      return NextResponse.json({ error: "Backend error" }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
  }
}
