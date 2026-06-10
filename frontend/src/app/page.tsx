'use client';
import { signIn, useSession } from "next-auth/react";
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Brand from '@/components/Brand';

const FEATURES = [
  {
    icon: '🧠',
    title: 'Deep repository memory',
    body: 'Every commit, merge request, issue and review thread — woven into a temporal knowledge graph your team can actually query.',
  },
  {
    icon: '💬',
    title: 'Ask "why", not just "what"',
    body: 'Why does this code exist? Who decided this? Has this been tried before? Answers cited back to real MRs and commits.',
  },
  {
    icon: '🛡️',
    title: 'Catch repeat mistakes',
    body: 'DevGenie watches new merge requests and warns when a change re-attempts a pattern your team already reverted.',
  },
];

export default function Home() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") router.replace('/chat');
  }, [status, router]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Nav */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '22px 40px', maxWidth: '1140px', width: '100%', margin: '0 auto',
      }}>
        <Brand markSize={32} textSize={19} />
        <button onClick={() => signIn('gitlab')} style={{
          padding: '10px 20px', borderRadius: '999px', border: '1px solid var(--line-strong)',
          background: 'var(--card)', color: 'var(--ink)', fontSize: '14px', fontWeight: 700,
          cursor: 'pointer', boxShadow: 'var(--shadow-sm)',
        }}>
          Sign in
        </button>
      </nav>

      {/* Hero */}
      <main style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', textAlign: 'center', padding: '32px 24px 80px',
      }}>
        <div className="rise" style={{ position: 'relative' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/devgenie.png"
            alt="DevGenie — your AI GitLab companion"
            style={{
              width: 'min(560px, 90vw)', borderRadius: 'var(--radius-lg)',
              boxShadow: '0 30px 80px rgba(47, 212, 232, .22), var(--shadow-lg)',
              border: '1px solid var(--line)',
            }}
          />
        </div>

        <h1 className="rise" style={{
          fontWeight: 800, fontSize: 'clamp(32px, 4.6vw, 50px)', lineHeight: 1.12,
          letterSpacing: '-0.03em', margin: '40px 0 0', maxWidth: '780px', animationDelay: '0.06s',
        }}>
          Your repository <span className="genie-text">remembers everything</span>.<br />
          Now you can <span className="grad-text">ask it</span>.
        </h1>

        <p className="rise" style={{
          color: 'var(--muted)', fontSize: '17px', lineHeight: 1.65, fontWeight: 500,
          maxWidth: '560px', marginTop: '20px', animationDelay: '0.12s',
        }}>
          DevGenie turns years of commits, merge requests and review threads into
          institutional memory — so any engineer can ask what happened, why it
          happened, and what to do next.
        </p>

        <button
          className="rise"
          onClick={() => signIn('gitlab')}
          style={{
            marginTop: '34px', padding: '16px 34px', borderRadius: '999px', border: 'none',
            background: 'var(--grad)', color: '#fff', fontSize: '16px', fontWeight: 700,
            cursor: 'pointer', boxShadow: '0 16px 40px rgba(244, 116, 44, .35)',
            animationDelay: '0.18s',
          }}
        >
          Continue with GitLab →
        </button>
        <p className="rise" style={{ color: 'var(--faint)', fontSize: '13px', marginTop: '16px', fontWeight: 500, animationDelay: '0.22s' }}>
          Read-only access · Your token, your permissions · Private repos stay private
        </p>

        {/* Feature cards */}
        <div className="rise" style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))',
          gap: '18px', maxWidth: '980px', width: '100%', marginTop: '76px', animationDelay: '0.28s',
        }}>
          {FEATURES.map(f => (
            <div key={f.title} style={{
              background: 'var(--card)', borderRadius: 'var(--radius-lg)',
              padding: '28px 26px', textAlign: 'left', boxShadow: 'var(--shadow)',
              border: '1px solid var(--line)',
            }}>
              <div style={{
                width: '44px', height: '44px', borderRadius: '14px', background: 'var(--grad-soft)',
                display: 'grid', placeItems: 'center', fontSize: '20px', marginBottom: '16px',
              }}>
                {f.icon}
              </div>
              <h3 style={{ fontSize: '17px', fontWeight: 800, letterSpacing: '-0.01em', margin: '0 0 8px' }}>
                {f.title}
              </h3>
              <p style={{ color: 'var(--muted)', fontSize: '14px', lineHeight: 1.65, margin: 0, fontWeight: 500 }}>
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </main>

      <footer style={{ textAlign: 'center', padding: '24px', color: 'var(--faint)', fontSize: '13px', fontWeight: 500 }}>
        DevGenie · Built on Google Cloud · Gemini · GitLab
      </footer>
    </div>
  );
}
