'use client';
import { useSession, signOut, signIn } from "next-auth/react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from 'next/navigation';
import Genie from "@/components/Genie";
import Brand from "@/components/Brand";
import Markdown from "@/components/Markdown";
import RiskRadarModal from "@/components/RiskRadarModal";

/* ---------------- Types ---------------- */

type Msg = { role: 'user' | 'assistant'; content: string; error?: boolean; attachments?: string[] };
type Attachment = { name: string; content: string };
type Conversation = {
  id: string;
  title: string;
  projectId: string;
  messages: Msg[];
  updatedAt: number;
};
type Project = { id: number; path: string; name: string };
type Stats = { repo: string; repo_url: string; counts: Record<string, number> } | null;

const DEFAULT_REPO = 'gitlab-org/gitlab';
const STORE_KEY = 'oracle.conversations.v1';

type Suggestion = { icon: string; label: string; prompt?: string; action?: 'risk' };
const SUGGESTIONS: Suggestion[] = [
  { icon: '🎯', label: 'Score an MR', action: 'risk' },
  { icon: '📈', label: 'Recent activity', prompt: 'Summarize the most important changes in this repository over the last month.' },
  { icon: '🔥', label: 'Risky areas', prompt: 'Which parts of this codebase are the riskiest to touch, based on revert and bug history?' },
  { icon: '↩️', label: 'Past mistakes', prompt: 'What changes have been tried and reverted in this repo? What should we learn from them?' },
  { icon: '🧭', label: 'Onboard me', prompt: 'I just joined this team. Walk me through how this repository is structured and where the important decisions live.' },
];

/* ---------------- Page ---------------- */

export default function Chat() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [stats, setStats] = useState<Stats>(null);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [riskOpen, setRiskOpen] = useState(false);
  const [riskInitialTitle, setRiskInitialTitle] = useState('');

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const active = conversations.find(c => c.id === activeId) || null;
  const messages = active?.messages ?? [];

  /* ----- persistence ----- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) setConversations(JSON.parse(raw));
    } catch { /* corrupted store — start fresh */ }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem(STORE_KEY, JSON.stringify(conversations.slice(0, 50)));
  }, [conversations, loaded]);

  /* ----- data fetching ----- */
  const [authExpired, setAuthExpired] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (session?.error === 'RefreshAccessTokenError') {
      setAuthExpired(true);
      return;
    }
    fetch('/api/projects').then(r => {
      if (r.status === 401) { setAuthExpired(true); return []; }
      return r.ok ? r.json() : [];
    }).then(p => {
      if (Array.isArray(p) && p.length) { setProjects(p); setAuthExpired(false); }
    }).catch(() => {});
  }, [status, session?.error]);

  useEffect(() => {
    if (status !== "authenticated") return;
    setStats(null);
    fetch(`/api/stats?project_id=${encodeURIComponent(repo)}`)
      .then(r => r.ok ? r.json() : null)
      .then(setStats)
      .catch(() => setStats(null));
  }, [repo, status]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, loading]);

  /* ----- actions ----- */
  const newChat = useCallback(() => {
    setActiveId(null);
    setInput('');
    inputRef.current?.focus();
  }, []);

  const openConversation = (c: Conversation) => {
    setActiveId(c.id);
    setRepo(c.projectId);
  };

  const deleteConversation = (id: string) => {
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeId === id) setActiveId(null);
  };

  // Append a pre-formatted assistant message — used by Risk Radar's "send to chat".
  // Creates a new conversation if none is active so the result always lands somewhere stable.
  const appendRiskAssistantMessage = (content: string) => {
    let convId = activeId;
    if (!convId) {
      convId = crypto.randomUUID();
      const conv: Conversation = {
        id: convId,
        title: 'Risk Radar — MR score',
        projectId: repo,
        messages: [],
        updatedAt: Date.now(),
      };
      setConversations(prev => [conv, ...prev]);
      setActiveId(convId);
    }
    const finalId = convId;
    setConversations(prev => prev.map(c =>
      c.id === finalId
        ? { ...c, messages: [...c.messages, { role: 'assistant', content }], updatedAt: Date.now() }
        : c
    ));
  };

  const startIngest = async () => {
    setIngesting(true);
    try {
      await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: repo }),
      });
    } catch { /* polling below will surface the state */ }
  };

  // While ingesting, poll status; refresh stats when it finishes.
  useEffect(() => {
    if (!ingesting) return;
    const t = setInterval(async () => {
      try {
        const s = await fetch(`/api/ingest?project_id=${encodeURIComponent(repo)}`).then(r => r.json());
        if (s.state === 'done' || s.state === 'error') {
          setIngesting(false);
          const fresh = await fetch(`/api/stats?project_id=${encodeURIComponent(repo)}`).then(r => r.ok ? r.json() : null);
          setStats(fresh);
        }
      } catch { /* keep polling */ }
    }, 8000);
    return () => clearInterval(t);
  }, [ingesting, repo]);

  // Open the Risk Radar with a fresh state (button entry points).
  const openRiskRadar = (prefilled: string = '') => {
    setRiskInitialTitle(prefilled);
    setRiskOpen(true);
  };

  const send = async (text?: string) => {
    const raw = (text ?? input).trim();
    if (!raw || loading) return;

    // Slash command: `/score <title>` or `/risk <title>` opens Risk Radar
    // pre-filled. Empty title (just "/score") opens it blank.
    const slashMatch = /^\/(?:score|risk)(?:\s+(.+))?$/i.exec(raw);
    if (slashMatch) {
      openRiskRadar((slashMatch[1] || '').trim());
      setInput('');
      return;
    }

    const userMsg = raw;
    setInput('');

    // Inline any attached files/snippets so the agent can use them as context.
    const attachments = files;
    setFiles([]);
    let outgoing = userMsg;
    if (attachments.length) {
      outgoing += '\n\nThe user attached the following file(s) as context:\n' +
        attachments.map(f => `\n--- ${f.name} ---\n\`\`\`\n${f.content}\n\`\`\``).join('\n');
    }

    let convId = activeId;
    if (!convId) {
      convId = crypto.randomUUID();
      const conv: Conversation = {
        id: convId,
        title: userMsg.length > 48 ? userMsg.slice(0, 48) + '…' : userMsg,
        projectId: repo,
        messages: [],
        updatedAt: Date.now(),
      };
      setConversations(prev => [conv, ...prev]);
      setActiveId(convId);
    }

    const append = (msg: Msg) =>
      setConversations(prev => prev.map(c =>
        c.id === convId ? { ...c, messages: [...c.messages, msg], updatedAt: Date.now() } : c
      ));

    append({ role: 'user', content: userMsg, attachments: attachments.map(f => f.name) });
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: outgoing, project_id: repo, conversation_id: convId }),
      });
      const data = await res.json();
      if (!res.ok || !data.answer) {
        append({ role: 'assistant', content: data.error || 'Something went wrong reaching DevGenie. Please try again.', error: true });
      } else {
        append({ role: 'assistant', content: data.answer });
      }
    } catch {
      append({ role: 'assistant', content: 'Network error — could not reach the DevGenie backend.', error: true });
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  /* ----- auth gates ----- */
  if (status === "loading") {
    return <div style={centerStyle}><Genie size={56} think /></div>;
  }
  if (status === "unauthenticated") {
    router.replace('/');
    return null;
  }

  const firstName = session?.user?.name?.split(' ')[0] || 'there';
  const greeting = getGreeting();
  const ingested = !!stats && (stats.counts?.commits ?? 0) > 0;

  return (
    <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden' }}>
      <RiskRadarModal
        open={riskOpen}
        onClose={() => setRiskOpen(false)}
        projectId={repo}
        repoLabel={repo}
        initialTitle={riskInitialTitle}
        onSendToChat={appendRiskAssistantMessage}
      />

      {/* ============ Sidebar ============ */}
      <aside className="glass" style={{
        width: sidebarOpen ? '280px' : '0px',
        flex: 'none',
        borderRight: sidebarOpen ? '1px solid var(--line)' : 'none',
        display: 'flex', flexDirection: 'column',
        transition: 'width 0.22s cubic-bezier(.4,0,.2,1)',
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '280px' }}>
          {/* Brand */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '20px 18px 14px' }}>
            <Brand markSize={28} textSize={16} />
          </div>

          {/* New chat */}
          <div style={{ padding: '4px 14px 14px' }}>
            <button onClick={newChat} style={{
              width: '100%', padding: '12px 16px', borderRadius: '999px', border: 'none',
              background: 'var(--grad)', color: '#fff', fontSize: '14px', fontWeight: 700,
              cursor: 'pointer', boxShadow: '0 10px 28px rgba(244,116,44,.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}>
              <span style={{ fontSize: '17px', lineHeight: 1 }}>+</span> New chat
            </button>
          </div>

          {/* Session-expired notice */}
          {authExpired && (
            <div style={{
              margin: '0 14px 12px', padding: '10px 12px', borderRadius: '10px',
              background: 'rgba(246,166,9,.08)', border: '1px solid rgba(246,166,9,.35)',
              fontSize: '12.5px', color: 'var(--amber)', fontWeight: 600, lineHeight: 1.5,
            }}>
              Your GitLab session expired, so your repository list can&apos;t refresh.
              <button
                onClick={() => signIn('gitlab')}
                style={{
                  display: 'block', marginTop: '8px', padding: '7px 12px', borderRadius: '8px',
                  border: 'none', background: 'var(--amber)', color: '#1a1205',
                  fontSize: '12px', fontWeight: 800, cursor: 'pointer',
                }}
              >
                Sign in again
              </button>
            </div>
          )}

          {/* Repo picker */}
          <div style={{ padding: '0 18px 10px' }}>
            <label style={sectionLabel}>Repository</label>
            <select
              value={repo}
              onChange={e => { setRepo(e.target.value); setActiveId(null); }}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '12px',
                border: '1px solid var(--line)', background: 'var(--card)',
                fontSize: '13px', fontWeight: 600, color: 'var(--ink)', cursor: 'pointer',
                boxShadow: 'var(--shadow-sm)', outline: 'none',
              }}
            >
              <option value={DEFAULT_REPO}>{DEFAULT_REPO}</option>
              {projects.filter(p => p.path !== DEFAULT_REPO).map(p => (
                <option key={p.id} value={p.path}>{p.path}</option>
              ))}
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '10px', fontSize: '12px' }}>
              <span style={{
                width: '8px', height: '8px', borderRadius: '50%', flex: 'none',
                background: stats === null ? 'var(--faint)' : ingested ? 'var(--green)' : ingesting ? 'var(--teal)' : 'var(--amber)',
                boxShadow: ingested ? '0 0 8px rgba(52,211,153,.6)' : ingesting ? '0 0 8px rgba(47,212,232,.6)' : 'none',
              }} />
              <span style={{ color: 'var(--muted)', fontWeight: 600 }}>
                {stats === null ? 'Checking memory…' : ingested ? 'Memory active' : ingesting ? 'Ingesting history…' : 'Not ingested yet'}
              </span>
            </div>
            {!ingested && !ingesting && stats !== null && (
              <button onClick={startIngest} style={{
                width: '100%', marginTop: '10px', padding: '9px 12px', borderRadius: '10px',
                border: '1px solid rgba(47,212,232,.4)', background: 'rgba(47,212,232,.08)',
                color: 'var(--teal2)', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer',
              }}>
                ✨ Ingest this repository
              </button>
            )}
          </div>

          {/* Memory stats */}
          {ingested && stats && (
            <div style={{
              margin: '8px 18px', padding: '14px 16px', background: 'var(--card)',
              borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-sm)',
            }}>
              <div style={{ ...sectionLabel, marginBottom: '10px' }}>Repository memory</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px' }}>
                <StatItem label="Commits" value={stats.counts.commits} />
                <StatItem label="MRs" value={stats.counts.merge_requests} />
                <StatItem label="Issues" value={stats.counts.issues} />
                <StatItem label="Decisions" value={stats.counts.decisions} />
                <StatItem label="Reverts" value={stats.counts.reverts} accent />
              </div>
            </div>
          )}

          {/* Conversations */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px 8px 18px', minHeight: 0 }}>
            <label style={sectionLabel}>History</label>
            {conversations.length === 0 && (
              <div style={{ color: 'var(--faint)', fontSize: '13px', padding: '8px 0', fontWeight: 500 }}>No conversations yet</div>
            )}
            {conversations.map(c => (
              <div
                key={c.id}
                onClick={() => openConversation(c)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '9px 12px', borderRadius: '12px', cursor: 'pointer',
                  background: c.id === activeId ? 'var(--card)' : 'transparent',
                  boxShadow: c.id === activeId ? 'var(--shadow-sm)' : 'none',
                  marginBottom: '3px', marginRight: '8px',
                  transition: 'background .12s ease',
                }}
                onMouseEnter={e => { if (c.id !== activeId) e.currentTarget.style.background = 'rgba(255,255,255,.05)'; }}
                onMouseLeave={e => { if (c.id !== activeId) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{
                  flex: 1, fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden',
                  textOverflow: 'ellipsis', color: c.id === activeId ? 'var(--ink)' : 'var(--muted)',
                }}>
                  {c.title}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); deleteConversation(c.id); }}
                  title="Delete conversation"
                  style={{
                    border: 'none', background: 'transparent', color: 'var(--faint)',
                    cursor: 'pointer', fontSize: '14px', padding: '0 2px', lineHeight: 1,
                  }}
                >×</button>
              </div>
            ))}
          </div>

          {/* User footer */}
          <div style={{
            padding: '14px 18px', borderTop: '1px solid var(--line)',
            display: 'flex', alignItems: 'center', gap: '10px',
          }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '50%', background: 'var(--grad)',
              color: '#fff', display: 'grid', placeItems: 'center',
              fontSize: '13px', fontWeight: 800, flex: 'none',
            }}>
              {firstName[0]?.toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {session?.user?.name}
              </div>
            </div>
            <button onClick={() => signOut({ callbackUrl: '/' })} title="Sign out" style={{
              border: 'none', background: 'transparent', color: 'var(--faint)',
              cursor: 'pointer', fontSize: '12.5px', fontWeight: 600,
            }}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* ============ Main ============ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Top bar */}
        <header className="glass" style={{
          flex: 'none', display: 'flex', alignItems: 'center', gap: '12px',
          padding: '12px 20px', borderBottom: '1px solid var(--line)',
        }}>
          <button onClick={() => setSidebarOpen(o => !o)} title="Toggle sidebar" style={{
            border: '1px solid var(--line)', background: 'var(--card)', borderRadius: '10px',
            width: '34px', height: '34px', cursor: 'pointer', color: 'var(--muted)',
            display: 'grid', placeItems: 'center', fontSize: '14px', boxShadow: 'var(--shadow-sm)',
          }}>
            ☰
          </button>
          <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {active ? active.title : 'New conversation'}
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => openRiskRadar('')}
            title="Score an MR against this repo's memory (or type /score <title> in chat)"
            style={{
              fontSize: '12px', fontWeight: 700, color: 'var(--ink)',
              border: '1px solid var(--line-strong)', borderRadius: '999px',
              padding: '6px 14px', background: 'var(--card)',
              cursor: 'pointer', boxShadow: 'var(--shadow-sm)',
              display: 'inline-flex', alignItems: 'center', gap: '6px',
            }}
          >
            🎯 Score MR
          </button>
          <a
            href={stats?.repo_url || `https://gitlab.com/${repo}`}
            target="_blank" rel="noopener noreferrer"
            style={{
              fontSize: '12px', fontWeight: 600, color: 'var(--muted)', textDecoration: 'none',
              border: '1px solid var(--line)', borderRadius: '999px', padding: '6px 14px',
              background: 'var(--card)', whiteSpace: 'nowrap', overflow: 'hidden',
              textOverflow: 'ellipsis', maxWidth: '320px', boxShadow: 'var(--shadow-sm)',
            }}
          >
            {repo} ↗
          </a>
        </header>

        {messages.length === 0 ? (
          /* ----- Empty state: orb + greeting + composer ----- */
          <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', overflowY: 'auto' }}>
            <div style={{ width: '100%', maxWidth: '660px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div className="rise"><Genie size={190} hero /></div>
              <h1 className="rise" style={{
                fontWeight: 800, fontSize: 'clamp(26px, 3.4vw, 34px)',
                letterSpacing: '-0.03em', textAlign: 'center', margin: '20px 0 6px', animationDelay: '0.06s',
              }}>
                {greeting}, <span className="grad-text">{firstName}</span>
              </h1>
              <p className="rise" style={{ color: 'var(--muted)', fontSize: '15px', fontWeight: 500, margin: '0 0 30px', animationDelay: '0.1s' }}>
                Ask me anything about this repository&apos;s history.
              </p>
              <div className="rise" style={{ width: '100%', animationDelay: '0.14s' }}>
                <Composer
                  inputRef={inputRef} input={input} setInput={setInput}
                  onSend={() => send()} loading={loading} repo={repo} autoFocus
                  files={files} setFiles={setFiles}
                />
              </div>
              <div className="rise" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center', marginTop: '22px', animationDelay: '0.2s' }}>
                {SUGGESTIONS.map(s => (
                  <button
                    key={s.label}
                    className="chip"
                    onClick={() => {
                      if (s.action === 'risk') openRiskRadar('');
                      else if (s.prompt) send(s.prompt);
                    }}
                  >
                    <span style={{ marginRight: '6px' }}>{s.icon}</span>{s.label}
                  </button>
                ))}
              </div>
              <p className="rise" style={{
                textAlign: 'center', color: 'var(--faint)', fontSize: '12px',
                marginTop: '14px', fontWeight: 500, animationDelay: '0.24s',
              }}>
                Tip: type <code style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: '11.5px', padding: '1px 6px', borderRadius: '6px',
                  background: 'rgba(0,0,0,.05)',
                }}>/score &lt;MR title&gt;</code> to risk-rate an MR without leaving the chat.
              </p>
              {!ingested && stats !== null && (
                <p style={{ textAlign: 'center', color: 'var(--faint)', fontSize: '13px', marginTop: '22px', fontWeight: 500 }}>
                  {ingesting
                    ? '✨ Ingesting this repository’s history — commits, MRs and issues are being embedded into memory. You can already chat using live GitLab lookups.'
                    : 'This repository hasn’t been ingested yet — use “Ingest this repository” in the sidebar to build its memory, or chat with live GitLab lookups only.'}
                </p>
              )}
            </div>
          </main>
        ) : (
          /* ----- Conversation ----- */
          <>
            <main style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              <div style={{ maxWidth: '780px', margin: '0 auto', padding: '28px 20px 12px', display: 'flex', flexDirection: 'column', gap: '22px' }}>
                {messages.map((m, i) => (
                  m.role === 'user' ? (
                    <div key={i} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <div style={{
                        maxWidth: '80%', padding: '14px 20px', borderRadius: '20px',
                        borderBottomRightRadius: '6px', background: 'var(--grad)',
                        color: '#fff', fontSize: '14.5px', fontWeight: 500, lineHeight: 1.6,
                        whiteSpace: 'pre-wrap', boxShadow: '0 10px 28px rgba(244,116,44,.25)',
                      }}>
                        {m.content}
                        {!!m.attachments?.length && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
                            {m.attachments.map(name => (
                              <span key={name} style={{
                                fontSize: '11.5px', fontWeight: 700, background: 'rgba(255,255,255,.18)',
                                borderRadius: '999px', padding: '3px 10px',
                              }}>
                                📎 {name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <AssistantMessage key={i} content={m.content} error={m.error} />
                  )
                ))}
                {loading && (
                  <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                    <Genie size={34} think />
                    <div style={{
                      background: 'var(--card)', borderRadius: '20px', borderTopLeftRadius: '6px',
                      padding: '16px 20px', boxShadow: 'var(--shadow-sm)',
                    }}>
                      <div className="thinking-dots"><span /><span /><span /></div>
                    </div>
                  </div>
                )}
                <div ref={endRef} />
              </div>
            </main>
            <footer style={{ flex: 'none', padding: '12px 20px 18px' }}>
              <div style={{ maxWidth: '780px', margin: '0 auto' }}>
                <Composer
                  inputRef={inputRef} input={input} setInput={setInput}
                  onSend={() => send()} loading={loading} repo={repo}
                  files={files} setFiles={setFiles}
                />
                <p style={{ textAlign: 'center', color: 'var(--faint)', fontSize: '11.5px', margin: '10px 0 0', fontWeight: 500 }}>
                  DevGenie grounds answers in your repository history, but can still make mistakes. Verify citations.
                </p>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- Sub-components ---------------- */

function AssistantMessage({ content, error }: { content: string; error?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="rise" style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
      <Genie size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {error ? (
          <div style={{
            color: 'var(--red)', fontSize: '14px', fontWeight: 500, background: 'rgba(255,107,107,.08)',
            border: '1px solid rgba(255,107,107,.3)', borderRadius: 'var(--radius)', padding: '14px 18px',
          }}>
            {content}
          </div>
        ) : (
          <div style={{
            background: 'var(--card)', borderRadius: '20px', borderTopLeftRadius: '6px',
            padding: '16px 22px', boxShadow: 'var(--shadow-sm)',
          }}>
            <Markdown content={content} />
            <button onClick={copy} style={{
              marginTop: '10px', border: 'none', background: 'transparent', cursor: 'pointer',
              color: 'var(--faint)', fontSize: '12px', fontWeight: 600, padding: 0,
            }}>
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const MAX_FILE_BYTES = 120_000;
const MAX_FILES = 5;

function Composer({ inputRef, input, setInput, onSend, loading, repo, autoFocus, files, setFiles }: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  loading: boolean;
  repo: string;
  autoFocus?: boolean;
  files: Attachment[];
  setFiles: React.Dispatch<React.SetStateAction<Attachment[]>>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const picked = Array.from(list).slice(0, MAX_FILES);
    const read = await Promise.all(picked.map(async f => {
      const text = await f.text();
      return { name: f.name, content: text.slice(0, MAX_FILE_BYTES) };
    }));
    setFiles(prev => [...prev, ...read].slice(0, MAX_FILES));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div style={{
      background: 'var(--card)', borderRadius: '26px',
      boxShadow: 'var(--shadow)', padding: '14px 16px 12px',
      border: '1px solid var(--line-strong)',
    }}>
      {files.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px', padding: '0 6px' }}>
          {files.map(f => (
            <span key={f.name} style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              fontSize: '12px', fontWeight: 600, color: 'var(--teal2)',
              background: 'rgba(47,212,232,.08)', border: '1px solid rgba(47,212,232,.25)',
              borderRadius: '999px', padding: '4px 10px',
            }}>
              📎 {f.name}
              <button
                onClick={() => setFiles(prev => prev.filter(x => x.name !== f.name))}
                style={{ border: 'none', background: 'transparent', color: 'var(--faint)', cursor: 'pointer', padding: 0, fontSize: '13px', lineHeight: 1 }}
              >×</button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={inputRef}
        value={input}
        autoFocus={autoFocus}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder="Ask about decisions, history, risky changes, or how something works…"
        rows={Math.min(6, Math.max(1, input.split('\n').length))}
        style={{
          width: '100%', border: 'none', outline: 'none', resize: 'none',
          background: 'transparent', fontSize: '14.5px', fontWeight: 500,
          lineHeight: 1.55, color: 'var(--ink)', padding: '2px 6px',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
        <input
          ref={fileInputRef} type="file" multiple style={{ display: 'none' }}
          accept=".txt,.md,.py,.js,.jsx,.ts,.tsx,.rb,.go,.rs,.java,.kt,.c,.h,.cpp,.cs,.php,.sql,.sh,.yml,.yaml,.json,.toml,.css,.html,.vue,.diff,.patch,.log"
          onChange={e => addFiles(e.target.files)}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Attach files or code snippets for context"
          style={{
            width: '34px', height: '34px', borderRadius: '50%', cursor: 'pointer',
            border: '1px solid var(--line-strong)', background: 'transparent',
            color: 'var(--muted)', display: 'grid', placeItems: 'center', fontSize: '15px',
          }}
        >
          📎
        </button>
        <span style={{
          fontSize: '11.5px', fontWeight: 600, color: 'var(--muted)', background: 'var(--card-soft)',
          borderRadius: '999px', padding: '5px 12px', maxWidth: '45%',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          📁 {repo}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '11.5px', color: 'var(--faint)', fontWeight: 500 }}>Enter ↵</span>
        <button
          onClick={onSend}
          disabled={loading || !input.trim()}
          style={{
            width: '38px', height: '38px', borderRadius: '50%', border: 'none',
            background: 'var(--grad)', color: '#fff',
            opacity: (loading || !input.trim()) ? 0.45 : 1,
            cursor: (loading || !input.trim()) ? 'default' : 'pointer',
            display: 'grid', placeItems: 'center', fontSize: '16px',
            boxShadow: '0 8px 20px rgba(244,116,44,.35)',
            transition: 'opacity 0.15s ease',
          }}
        >
          ↑
        </button>
      </div>
    </div>
  );
}

function StatItem({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px' }}>
      <span style={{ color: 'var(--muted)', fontWeight: 500 }}>{label}</span>
      <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }} className={accent ? 'grad-text' : undefined}>
        {value?.toLocaleString?.() ?? value}
      </span>
    </div>
  );
}

/* ---------------- Helpers ---------------- */

function getGreeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const centerStyle: React.CSSProperties = {
  display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center',
};

const sectionLabel: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--faint)',
  marginBottom: '7px',
};
