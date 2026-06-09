import NextAuth, { NextAuthOptions } from "next-auth";
import GitLabProvider from "next-auth/providers/gitlab";

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
      if (account) {
        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
