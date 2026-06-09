'use client';
import Orb from '@/components/Orb';
import { signIn, signOut, useSession } from "next-auth/react";

import { useRouter } from 'next/navigation';

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', textAlign: 'center' }}>
      <Orb />
      {status === "authenticated" ? (
        <>
          <h2 style={{ fontSize: '38px', lineHeight: '1.08', fontWeight: 800, letterSpacing: '-0.03em', marginTop: '24px' }}>
            Hi, <span style={{ background: 'var(--grad)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{session?.user?.name}</span>
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: '15.5px', marginTop: '16px', fontWeight: 500 }}>
            How may I help you today?
          </p>
          <div style={{ display: 'flex', gap: '16px', marginTop: '32px' }}>
            <button onClick={() => router.push('/chat')} style={{ ...btnStyle, background: 'var(--grad)', color: '#fff' }}>
              Launch Assistant
            </button>
            <button onClick={() => signOut()} style={{ ...btnStyle, border: '1px solid var(--line)', background: 'transparent', boxShadow: 'none' }}>
              Sign Out
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 style={{ fontSize: '38px', lineHeight: '1.08', fontWeight: 800, letterSpacing: '-0.03em', marginTop: '24px' }}>
            Your <span style={{ background: 'var(--grad)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Smart Assistant</span><br/>for Any Tasks
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: '15.5px', marginTop: '16px', fontWeight: 500 }}>
            Get instant help and support with any task or problem.
          </p>
          <button onClick={() => signIn('gitlab')} style={btnStyle}>
            Login with GitLab &rarr;
          </button>
        </>
      )}
    </div>
  );
}

const btnStyle = {
  marginTop: '32px',
  padding: '16px 32px',
  borderRadius: '24px',
  border: 'none',
  background: '#fff',
  boxShadow: 'var(--shadow)',
  fontSize: '16px',
  fontWeight: 600 as const,
  cursor: 'pointer',
  color: 'var(--ink)'
};