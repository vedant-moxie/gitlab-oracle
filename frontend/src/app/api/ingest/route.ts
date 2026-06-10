import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/route";

const backendUrl = () => process.env.BACKEND_URL || 'http://127.0.0.1:8001';

// Start ingesting a repository's history, authorized by the USER's GitLab
// token — they can only ingest repos they can already read.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { project_id } = await req.json();
  if (!project_id) {
    return NextResponse.json({ error: "Missing project_id" }, { status: 400 });
  }
  try {
    const res = await fetch(`${backendUrl()}/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({ project_id }),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
  }
}

// Poll ingestion status.
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('project_id') || '';
  try {
    const res = await fetch(`${backendUrl()}/ingest/status?project_id=${encodeURIComponent(projectId)}`);
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
  }
}
