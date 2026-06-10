import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/route";

// Proxy the explainable MR risk score from the Python backend's /risk endpoint.
// Powers the Risk Radar quick-action in /chat.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { project_id?: string; title?: string; description?: string; files?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { project_id, title, description, files } = body || {};
  if (!project_id || !title) {
    return NextResponse.json({ error: "Missing project_id or title" }, { status: 400 });
  }

  const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8001';

  try {
    const res = await fetch(`${backendUrl}/risk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward the user's GitLab token so the backend can attribute
        // hotspot lookups to the caller's project access.
        'Authorization': `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({
        project_id,
        title,
        description: description || '',
        files: Array.isArray(files) ? files : null,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      let detail = "Backend error";
      try {
        const parsed = JSON.parse(errText);
        if (typeof parsed.detail === 'string') detail = parsed.detail;
        else if (typeof parsed.error === 'string') detail = parsed.error;
      } catch { /* non-JSON */ }
      return NextResponse.json({ error: detail }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: "Backend unreachable" }, { status: 502 });
  }
}
