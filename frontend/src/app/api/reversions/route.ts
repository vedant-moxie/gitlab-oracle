import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/route";

// Proxies reverted-decision rows for a project from the Python backend.
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A user-supplied PAT takes precedence over the (expiring) OAuth token.
  const pat = request.headers.get('x-gitlab-pat') || undefined;
  const token = pat || session.accessToken;

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('project_id') || '';
  const limit = searchParams.get('limit') || '';
  const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8001';

  const qs = new URLSearchParams({ project_id: projectId });
  if (limit) qs.set('limit', limit);

  try {
    const res = await fetch(`${backendUrl}/reversions?${qs.toString()}`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Backend error" }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
  }
}
