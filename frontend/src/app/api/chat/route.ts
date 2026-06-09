import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/route";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { message, project_id } = body;

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
        // Pass the user's GitLab OAuth token securely to the backend
        'Authorization': `Bearer ${session.accessToken}`
      },
      body: JSON.stringify({ 
        message, 
        project_id,
        session_id: `user-${session.user?.email}` // Scope session to user
      }),
    });

    if (!backendRes.ok) {
      const errorText = await backendRes.text();
      console.error("Backend error:", errorText);
      return NextResponse.json({ error: "Backend error" }, { status: backendRes.status });
    }

    const data = await backendRes.json();
    return NextResponse.json(data);

  } catch (error: any) {
    console.error("Chat API error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}