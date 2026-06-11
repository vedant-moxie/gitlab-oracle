'use client';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Brand from '@/components/Brand';
import { getSettings, saveSettings, clearPat } from '@/lib/settings';

/* ---------------- Types ---------------- */

type Project = { id: number; path: string; name: string };

type TokenCheck =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; projects: number }
  | { state: 'error'; message: string };

const CONVERSATIONS_KEY = 'oracle.conversations.v1';

function readConversationCount(): number {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

/* ---------------- Page ---------------- */

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [pat, setPat] = useState('');
  const [patSaved, setPatSaved] = useState(false);
  const [showPat, setShowPat] = useState(false);
  const [tokenCheck, setTokenCheck] = useState<TokenCheck>({ state: 'idle' });

  const [projects, setProjects] = useState<Project[]>([]);
  const [defaultRepo, setDefaultRepo] = useState('');
  const [conversationCount, setConversationCount] = useState(0);

  /* ----- Auth gate ----- */
  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

  /* ----- Load persisted settings + data counts ----- */
  useEffect(() => {
    const s = getSettings();
    if (s.pat) {
      setPat(s.pat);
      setPatSaved(true);
    }
    if (s.defaultRepo) setDefaultRepo(s.defaultRepo);
    setConversationCount(readConversationCount());
  }, []);

  /* ----- Projects for the default-repo select ----- */
  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/projects')
      .then(r => (r.ok ? r.json() : []))
      .then(p => { if (Array.isArray(p)) setProjects(p); })
      .catch(() => { /* swallow */ });
  }, [status]);

  /* ----- Actions ----- */
  const savePat = async () => {
    const token = pat.trim();
    if (!token) return;
    saveSettings({ pat: token });
    setPatSaved(true);
    setTokenCheck({ state: 'checking' });
    try {
      const res = await fetch('/api/projects', { headers: { 'x-gitlab-pat': token } });
      if (res.ok) {
        const list = await res.json();
        setTokenCheck({ state: 'ok', projects: Array.isArray(list) ? list.length : 0 });
      } else {
        setTokenCheck({
          state: 'error',
          message: `Token saved, but GitLab returned ${res.status}. Check that it has the read_api scope and hasn't expired.`,
        });
      }
    } catch {
      setTokenCheck({
        state: 'error',
        message: 'Token saved, but we could not reach the server to validate it.',
      });
    }
  };

  const removePat = () => {
    clearPat();
    setPat('');
    setPatSaved(false);
    setTokenCheck({ state: 'idle' });
  };

  const onRepoChange = (value: string) => {
    setDefaultRepo(value);
    saveSettings({ defaultRepo: value || undefined });
  };

  const clearHistory = () => {
    if (!window.confirm('Delete all stored chat conversations? This cannot be undone.')) return;
    try { localStorage.removeItem(CONVERSATIONS_KEY); } catch { /* ignore */ }
    setConversationCount(readConversationCount());
  };

  /* ----- Auth gates ----- */
  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}>
        Loading…
      </div>
    );
  }
  if (status === 'unauthenticated') return null;

  const name = session?.user?.name || 'You';
  const email = session?.user?.email || '';
  const image = session?.user?.image;
  const initial = (name[0] || '?').toUpperCase();

  return (
    <div style={{ minHeight: '100dvh' }}>
      {/* ============ Header ============ */}
      <header style={{
        borderBottom: '1px solid var(--line)',
        padding: '14px 24px',
        display: 'flex', alignItems: 'center', gap: '18px',
        position: 'sticky', top: 0, zIndex: 10,
        background: 'var(--glass)',
        backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
      }}>
        <Brand markSize={26} textSize={15} />
        <div style={{ flex: 1 }} />
        <a href="/dashboard" style={headerLink}>← Dashboard</a>
        <a href="/chat" style={headerLink}>Chat</a>
      </header>

      {/* ============ Content column ============ */}
      <main style={{ maxWidth: '760px', margin: '0 auto', padding: '40px 24px 80px' }}>
        <div style={overlineStyle}>Settings</div>
        <h1 style={{
          fontWeight: 800, fontSize: '30px', letterSpacing: '-0.03em',
          margin: '6px 0 26px', color: 'var(--ink)', lineHeight: 1.15,
        }}>
          Your DevGenie
        </h1>

        {/* ---------- Account ---------- */}
        <section style={cardStyle}>
          <div style={sectionTitle}>Account</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                alt=""
                width={44}
                height={44}
                style={{ borderRadius: '50%', flex: 'none', border: '1px solid var(--line-strong)' }}
              />
            ) : (
              <div style={{
                width: '44px', height: '44px', borderRadius: '50%', flex: 'none',
                background: 'rgba(61, 218, 232, .15)', color: 'var(--teal2)',
                border: '1px solid rgba(61, 218, 232, .35)',
                display: 'grid', placeItems: 'center',
                fontSize: '17px', fontWeight: 800,
              }}>
                {initial}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '14.5px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {name}
              </div>
              <div style={{ fontSize: '12.5px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {email}
              </div>
            </div>
            <button onClick={() => signOut({ callbackUrl: '/' })} style={dangerButton}>
              Sign out
            </button>
          </div>
        </section>

        {/* ---------- GitLab access token ---------- */}
        <section style={cardStyle}>
          <div style={sectionTitle}>GitLab access token</div>
          <p style={explainerText}>
            Your OAuth sign-in token expires after about 2 hours. Adding a Personal
            Access Token keeps DevGenie working without re-login, can raise your
            GitLab API rate limits, and grants exactly the scopes you choose — we
            recommend just <code style={codeChip}>read_api</code>.{' '}
            <a href="https://gitlab.com/-/user_settings/personal_access_tokens" target="_blank" rel="noopener noreferrer">
              Create one
            </a>
          </p>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '14px', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: '240px' }}>
              <input
                type={showPat ? 'text' : 'password'}
                value={pat}
                onChange={e => setPat(e.target.value)}
                placeholder="glpat-…"
                autoComplete="off"
                spellCheck={false}
                style={{ ...inputStyle, width: '100%', paddingRight: '64px', fontFamily: 'var(--font-mono)', fontSize: '13px' }}
              />
              <button
                onClick={() => setShowPat(s => !s)}
                type="button"
                style={{
                  position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                  border: 'none', background: 'transparent', color: 'var(--muted)',
                  fontSize: '11.5px', fontWeight: 700, cursor: 'pointer', padding: '4px 6px',
                }}
              >
                {showPat ? 'Hide' : 'Show'}
              </button>
            </div>
            <button onClick={savePat} disabled={!pat.trim()} style={{ ...primaryButton, opacity: pat.trim() ? 1 : 0.5 }}>
              Save
            </button>
            <button onClick={removePat} disabled={!patSaved} style={{ ...dangerButton, opacity: patSaved ? 1 : 0.5 }}>
              Remove
            </button>
          </div>

          {tokenCheck.state === 'checking' && (
            <div style={{ ...statusText, color: 'var(--muted)' }}>Checking token against GitLab…</div>
          )}
          {tokenCheck.state === 'ok' && (
            <div style={{ ...statusText, color: 'var(--green)' }}>
              ✓ Token works — {tokenCheck.projects} project{tokenCheck.projects === 1 ? '' : 's'} visible
            </div>
          )}
          {tokenCheck.state === 'error' && (
            <div style={{ ...statusText, color: 'var(--amber)' }}>{tokenCheck.message}</div>
          )}

          <p style={{ ...explainerText, fontSize: '12px', color: 'var(--faint)', marginTop: '14px', marginBottom: 0 }}>
            Stored only in this browser (localStorage). Sent over HTTPS only to your
            DevGenie server with each request — never stored server-side.
          </p>
        </section>

        {/* ---------- Preferences ---------- */}
        <section style={cardStyle}>
          <div style={sectionTitle}>Preferences</div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, marginBottom: '8px' }}>
            Default repository
          </label>
          <select
            value={defaultRepo}
            onChange={e => onRepoChange(e.target.value)}
            style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}
          >
            <option value="">Last used</option>
            {projects.map(p => (
              <option key={p.id} value={p.path}>{p.path}</option>
            ))}
          </select>
          <div style={{ fontSize: '12px', color: 'var(--faint)', fontWeight: 600, marginTop: '8px' }}>
            Dashboard and Chat will open this repo first.
          </div>
        </section>

        {/* ---------- Data ---------- */}
        <section style={cardStyle}>
          <div style={sectionTitle}>Data</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ flex: 1, fontSize: '13.5px', fontWeight: 600, color: 'var(--ink)' }}>
              {conversationCount} conversation{conversationCount === 1 ? '' : 's'} stored in this browser
            </div>
            <button
              onClick={clearHistory}
              disabled={conversationCount === 0}
              style={{ ...dangerButton, opacity: conversationCount === 0 ? 0.5 : 1 }}
            >
              Clear chat history
            </button>
          </div>
        </section>

        {/* ---------- About ---------- */}
        <section style={{ ...cardStyle, marginBottom: 0 }}>
          <div style={sectionTitle}>About</div>
          <div style={{ fontSize: '12.5px', color: 'var(--muted)', fontWeight: 600, lineHeight: 1.8 }}>
            Model: <span style={{ color: 'var(--ink)' }}>gemini-2.5-pro</span> on Vertex AI
            {' '}·{' '}
            Backend:{' '}
            <a href="https://devgenie-70965519212.us-central1.run.app" target="_blank" rel="noopener noreferrer">
              devgenie-70965519212.us-central1.run.app
            </a>
            <br />
            DevGenie — institutional memory for GitLab repos.
          </div>
        </section>
      </main>
    </div>
  );
}

/* ---------------- Style helpers ---------------- */

const headerLink: React.CSSProperties = {
  color: 'var(--muted)',
  fontSize: '13px',
  fontWeight: 700,
  textDecoration: 'none',
};

const overlineStyle: React.CSSProperties = {
  fontSize: '11.5px',
  fontWeight: 700,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  color: 'var(--teal2)',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: '20px',
  marginBottom: '16px',
  boxShadow: 'var(--shadow-sm)',
};

const sectionTitle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
  marginBottom: '14px',
};

const inputStyle: React.CSSProperties = {
  background: 'var(--card-soft)',
  border: '1px solid var(--line-strong)',
  color: 'var(--ink)',
  borderRadius: '10px',
  padding: '11px 12px',
  fontSize: '13.5px',
  fontWeight: 600,
  outline: 'none',
};

const primaryButton: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: '999px',
  cursor: 'pointer',
  border: '1px solid rgba(61, 218, 232, .35)',
  background: 'rgba(61, 218, 232, .10)',
  color: 'var(--teal2)',
  fontSize: '13px',
  fontWeight: 700,
  boxShadow: 'var(--shadow-sm)',
};

const dangerButton: React.CSSProperties = {
  padding: '10px 18px',
  borderRadius: '999px',
  cursor: 'pointer',
  border: '1px solid rgba(255, 93, 143, .30)',
  background: 'rgba(255, 93, 143, .10)',
  color: 'var(--red)',
  fontSize: '13px',
  fontWeight: 700,
};

const explainerText: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--muted)',
  fontWeight: 500,
  lineHeight: 1.6,
  margin: 0,
};

const codeChip: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.86em',
  background: 'rgba(47, 212, 232, .08)',
  border: '1px solid rgba(47, 212, 232, .18)',
  borderRadius: '6px',
  padding: '0.1em 0.4em',
  color: 'var(--teal2)',
};

const statusText: React.CSSProperties = {
  marginTop: '12px',
  fontSize: '13px',
  fontWeight: 700,
};
