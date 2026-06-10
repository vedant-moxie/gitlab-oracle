import NextAuth, { NextAuthOptions } from "next-auth";
import { JWT } from "next-auth/jwt";
import GitLabProvider from "next-auth/providers/gitlab";

// GitLab OAuth access tokens expire after ~2 hours. Rotate them with the
// refresh token so long-lived sessions keep working (GitLab also rotates the
// refresh token on every use — always store the new one).
async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const res = await fetch("https://gitlab.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GITLAB_CLIENT_ID || "",
        client_secret: process.env.GITLAB_CLIENT_SECRET || "",
        grant_type: "refresh_token",
        refresh_token: token.refreshToken || "",
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "refresh failed");
    return {
      ...token,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? token.refreshToken,
      expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
      error: undefined,
    };
  } catch {
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    GitLabProvider({
      clientId: process.env.GITLAB_CLIENT_ID || "",
      clientSecret: process.env.GITLAB_CLIENT_SECRET || "",
      authorization: {
        url: "https://gitlab.com/oauth/authorize",
        params: { scope: "read_api read_user" },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // Initial sign-in: persist all token material.
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at
          ? account.expires_at * 1000
          : Date.now() + 7200 * 1000;
        token.error = undefined;
        return token;
      }
      // Still valid (with 60s safety margin)?
      if (token.expiresAt && Date.now() < token.expiresAt - 60_000) {
        return token;
      }
      return refreshAccessToken(token);
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      session.error = token.error;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
