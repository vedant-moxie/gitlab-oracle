import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/route";

// Lists the GitLab projects the signed-in user is a member of, using THEIR
// OAuth token — so access control is enforced by GitLab, not by us.
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !session.accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A user-supplied PAT takes precedence over the (expiring) OAuth token.
  const pat = req.headers.get('x-gitlab-pat') || undefined;
  const token = pat || session.accessToken;

  const gitlabUrl = process.env.GITLAB_URL || 'https://gitlab.com';
  try {
    const res = await fetch(
      `${gitlabUrl}/api/v4/projects?membership=true&simple=true&order_by=last_activity_at&per_page=40`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!res.ok) {
      return NextResponse.json({ error: "GitLab API error" }, { status: res.status });
    }
    const projects = await res.json();
    return NextResponse.json(
      projects.map((p: any) => ({
        id: p.id,
        path: p.path_with_namespace,
        name: p.name,
        avatar: p.avatar_url,
        web_url: p.web_url,
      }))
    );
  } catch {
    return NextResponse.json({ error: "Failed to reach GitLab" }, { status: 502 });
  }
}
