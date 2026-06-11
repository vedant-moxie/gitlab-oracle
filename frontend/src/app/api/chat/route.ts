import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/route";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // A user-supplied PAT (from Settings) takes precedence over the OAuth
    // token, which expires after ~2h. The session is still required.
    const pat = req.headers.get('x-gitlab-pat') || undefined;
    const token = pat || session.accessToken;

    const body = await req.json();
    const { message, project_id, conversation_id } = body;

    if (!message || !project_id) {
      return NextResponse.json({ error: "Missing message or project_id" }, { status: 400 });
    }

    // Proxy the request to our Python FastAPI backend
    // Assuming the Python backend is running on port 8001 locally
    const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:8001';
    
    const backendRes = await fetch(`${backendUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Pass the user's GitLab token (PAT-preferred) securely to the backend
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ 
        message, 
        project_id,
        // Scope backend session to user + conversation so each thread keeps
        // its own multi-turn context instead of one global session per user.
        session_id: `user-${session.user?.email}-${conversation_id || 'default'}`
      }),
    });

    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      console.error("Backend error:", errorText);
      // Surface the backend's human-readable detail when it provides one.
      let detail = "The Oracle backend returned an error. Please try again.";
      try {
        const parsed = JSON.parse(errorText);
        if (typeof parsed.detail === 'string') detail = parsed.detail;
      } catch { /* non-JSON error body */ }
      return NextResponse.json({ error: detail }, { status: backendRes.status });
    }

    const data = await backendRes.json();
    return NextResponse.json(data);

  } catch (error: any) {
    console.error("Chat API error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}