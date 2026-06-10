'use client';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Brand from '@/components/Brand';
import Genie from '@/components/Genie';
import RiskRadarModal from '@/components/RiskRadarModal';

/* ---------------- Types ---------------- */

type Project = { id: number; path: string; name: string };
type Counts = {
  commits: number;
  merge_requests: number;
  issues: number;
  decisions: number;
  reverts: number;
};
type Stats = { repo: string; repo_url: string; counts: Counts } | null;

type CommitRow = {
  id?: string;
  short_id?: string;
  message?: string;
  web_url?: string;
  timestamp?: string;
  author_name?: string;
};
type MRRow = {
  iid?: number;
  title?: string;
  web_url?: string;
  created_at?: string;
  state?: string;
};
type IssueRow = {
  iid?: number;
  title?: string;
  web_url?: string;
  created_at?: string;
  state?: string;
};
type Activity = {
  commits?: CommitRow[];
  merge_requests?: MRRow[];
  issues?: IssueRow[];
};

type Hotspot = {
  file: string;
  churn?: number;
  reverts?: number;
  decisions?: number;
  authors?: number;
  bus_factor_risk?: boolean;
  // Backend returns a numeric score (reverts*20 + decisions*4 + churn).
  // HotspotRow buckets it into HIGH/MEDIUM/LOW for display.
  risk?: number;
};
type HotspotsResponse = { hotspots?: Hotspot[] };

type Reversion = {
  title?: string;
  web_url?: string;
  source_type?: string;
  source_id?: string | number;
  reverted_mr_id?: string | number;
  linked_issues?: unknown[];
  timestamp?: string;
};
type ReversionsResponse = { reversions?: Reversion[] };

type StreamItem = {
  kind: 'commit' | 'mr' | 'issue';
  title: string;
  url?: string;
  ts: string; // ISO
};

const DEFAULT_REPO = 'gitlab-org/gitlab';
const REPO_KEY = 'devgenie.repo.v1';

/* ---------------- Page ---------------- */

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [projects, setProjects] = useState<Project[]>([]);
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [stats, setStats] = useState<Stats>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [composer, setComposer] = useState('');

  const [riskOpen, setRiskOpen] = useState(false);
  const [reversionsOpen, setReversionsOpen] = useState(false);
  const [repoMenuOpen, setRepoMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const recentRef = useRef<HTMLDivElement>(null);
  const riskyRef = useRef<HTMLDivElement>(null);

  /* ----- Auth gate ----- */
  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

  /* ----- Persisted repo ----- */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(REPO_KEY);
      if (saved) setRepo(saved);
    } catch { /* localStorage unavailable */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem(REPO_KEY, repo); } catch { /* ignore */ }
  }, [repo]);

  /* ----- Data ----- */
  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/projects')
      .then(r => r.ok ? r.json() : [])
      .then(p => { if (Array.isArray(p)) setProjects(p); })
      .catch(() => { /* swallow */ });
  }, [status]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    setStats(null);
    setActivity(null);
    setHotspots([]);
    fetch(`/api/stats?project_id=${encodeURIComponent(repo)}`)
      .then(r => r.ok ? r.json() : null)
      .then(setStats)
      .catch(() => setStats(null));
    fetch(`/api/activity?project_id=${encodeURIComponent(repo)}&limit=8`)
      .then(r => r.ok ? r.json() : null)
      .then(setActivity)
      .catch(() => setActivity(null));
    fetch(`/api/hotspots?project_id=${encodeURIComponent(repo)}`)
      .then(r => r.ok ? r.json() : null)
      .then((j: HotspotsResponse | null) => setHotspots(j?.hotspots || []))
      .catch(() => setHotspots([]));
  }, [repo, status]);

  /* ----- Derived: unified activity stream ----- */
  const stream: StreamItem[] = useMemo(() => {
    if (!activity) return [];
    const items: StreamItem[] = [];
    (activity.commits || []).forEach(c => {
      const title = (c.message || '').split('\n')[0] || '(no message)';
      items.push({ kind: 'commit', title, url: c.web_url, ts: c.timestamp || '' });
    });
    (activity.merge_requests || []).forEach(m => {
      items.push({ kind: 'mr', title: m.title || '(untitled MR)', url: m.web_url, ts: m.created_at || '' });
    });
    (activity.issues || []).forEach(i => {
      items.push({ kind: 'issue', title: i.title || '(untitled issue)', url: i.web_url, ts: i.created_at || '' });
    });
    items.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
    return items.slice(0, 4);
  }, [activity]);

  /* ----- Actions ----- */
  const ingested = !!stats && (stats.counts?.commits ?? 0) > 0;
  const firstName = session?.user?.name?.split(' ')[0] || 'there';
  const userHandle = (session?.user?.email?.split('@')[0]) || firstName.toLowerCase();

  const sendComposer = useCallback(() => {
    const text = composer.trim();
    if (!text) return;
    router.push(`/chat?ask=${encodeURIComponent(text)}`);
  }, [composer, router]);

  const scrollTo = (ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ----- Auth gates ----- */
  if (status === 'loading') {
    return (
      <div style={centerStyle}>
        <Genie size={56} think />
      </div>
    );
  }
  if (status === 'unauthenticated') {
    return null;
  }

  return (
    <div style={{ display: 'flex', minHeight: '100dvh', overflow: 'hidden' }}>
      <RiskRadarModal
        open={riskOpen}
        onClose={() => setRiskOpen(false)}
        projectId={repo}
        repoLabel={repo}
      />
      <ReversionsModal
        open={reversionsOpen}
        onClose={() => setReversionsOpen(false)}
        projectId={repo}
      />

      {/* ============ Sidebar ============ */}
      <aside style={{
        width: '260px', flex: 'none', borderRight: '1px solid var(--line)',
        background: 'var(--bg)', display: 'flex', flexDirection: 'column',
        height: '100dvh', position: 'sticky', top: 0,
      }}>
        {/* Brand */}
        <div style={{ padding: '22px 22px 18px' }}>
          <Brand markSize={26} textSize={15} />
        </div>

        {/* Repository */}
        <div style={{ padding: '6px 22px 14px', position: 'relative' }}>
          <div style={sectionLabel}>Repository</div>
          <button
            onClick={() => setRepoMenuOpen(o => !o)}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: '12px',
              border: '1px solid var(--line)', background: 'var(--card)',
              color: 'var(--ink)', fontSize: '12.5px', fontWeight: 700,
              cursor: 'pointer', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: '6px',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{repo}</span>
            <span style={{ color: 'var(--faint)', fontSize: '10px' }}>▾</span>
          </button>
          {repoMenuOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% - 4px)', left: '22px', right: '22px',
              maxHeight: '260px', overflowY: 'auto',
              background: 'var(--card)', border: '1px solid var(--line-strong)',
              borderRadius: '12px', boxShadow: 'var(--shadow)', zIndex: 20, padding: '4px',
            }}>
              <RepoOption
                value={DEFAULT_REPO}
                active={repo === DEFAULT_REPO}
                onSelect={() => { setRepo(DEFAULT_REPO); setRepoMenuOpen(false); }}
              />
              {projects.filter(p => p.path !== DEFAULT_REPO).map(p => (
                <RepoOption
                  key={p.id}
                  value={p.path}
                  active={p.path === repo}
                  onSelect={() => { setRepo(p.path); setRepoMenuOpen(false); }}
                />
              ))}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '10px', fontSize: '12px' }}>
            <span style={{
              width: '8px', height: '8px', borderRadius: '50%', flex: 'none',
              background: ingested ? 'var(--green)' : 'var(--faint)',
              boxShadow: ingested ? '0 0 8px rgba(61, 220, 132, .55)' : 'none',
            }} />
            {ingested ? (
              <span style={{ color: 'var(--ink)', fontWeight: 600 }}>Memory active</span>
            ) : (
              <a href="/chat" style={{ color: 'var(--muted)', fontWeight: 600, textDecoration: 'none' }}>
                Not ingested yet →
              </a>
            )}
          </div>
        </div>

        {/* Navigation */}
        <div style={{ padding: '10px 14px 6px' }}>
          <div style={{ ...sectionLabel, padding: '0 8px' }}>Navigation</div>
          <NavItem icon="⌂" label="Home" active onClick={() => { /* already here */ }} />
          <NavItem icon="◎" label="Score MR" onClick={() => setRiskOpen(true)} />
          <NavItem icon="↗" label="Recent activity" onClick={() => scrollTo(recentRef)} />
          <NavItem icon="◇" label="Risky areas" onClick={() => scrollTo(riskyRef)} />
          <NavItem icon="↺" label="Past mistakes" onClick={() => setReversionsOpen(true)} />
          <NavItem icon="◈" label="Knowledge graph" onClick={() => router.push(`/graph?project_id=${encodeURIComponent(repo)}`)} />
          <NavItem icon="◉" label="Open chat" onClick={() => router.push('/chat')} />
        </div>

        {/* Settings (stub) */}
        <div style={{ padding: '14px 14px 6px' }}>
          <div style={{ ...sectionLabel, padding: '0 8px' }}>Settings</div>
          <div title="Coming soon" style={{ pointerEvents: 'none', opacity: 0.5 }}>
            <NavItem icon="⚙" label="Settings" onClick={() => { /* stub */ }} />
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Profile pill */}
        <div style={{ padding: '12px 18px 18px', borderTop: '1px solid var(--line)', position: 'relative' }}>
          <button
            onClick={() => setProfileMenuOpen(o => !o)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
              padding: '8px 8px', borderRadius: '12px',
              border: '1px solid transparent', background: 'transparent',
              cursor: 'pointer', color: 'var(--ink)',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--card)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <div style={{
              width: '32px', height: '32px', borderRadius: '50%',
              background: 'rgba(61, 218, 232, .15)', color: 'var(--teal2)',
              border: '1px solid rgba(61, 218, 232, .35)',
              display: 'grid', placeItems: 'center',
              fontSize: '13px', fontWeight: 800, flex: 'none',
            }}>
              {firstName[0]?.toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {session?.user?.name || 'You'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 600 }}>
                Sign in
              </div>
            </div>
            <span style={{ color: 'var(--faint)', fontSize: '10px' }}>▾</span>
          </button>
          {profileMenuOpen && (
            <div style={{
              position: 'absolute', bottom: 'calc(100% - 4px)', left: '18px', right: '18px',
              background: 'var(--card)', border: '1px solid var(--line-strong)',
              borderRadius: '12px', boxShadow: 'var(--shadow)', zIndex: 20, padding: '4px',
            }}>
              <button
                onClick={() => signOut({ callbackUrl: '/' })}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '10px 12px', borderRadius: '10px',
                  border: 'none', background: 'transparent',
                  color: 'var(--ink)', fontSize: '13px', fontWeight: 600,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--card-soft)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* ============ Main ============ */}
      <main style={{
        flex: 1, minWidth: 0, overflowY: 'auto', height: '100dvh',
      }}>
        <div style={{ maxWidth: '1080px', margin: '0 auto', padding: '48px 56px 80px' }}>
          {/* Overline + H1 */}
          <div style={overlineStyle}>Repository Intelligence</div>
          <h1 style={{
            fontWeight: 800, fontSize: '38px', letterSpacing: '-0.03em',
            margin: '6px 0 10px', color: 'var(--ink)', lineHeight: 1.15,
          }}>
            {repo}
          </h1>
          <p style={{
            color: 'var(--muted)', fontSize: '14.5px', fontWeight: 500,
            margin: '0 0 30px', lineHeight: 1.55, maxWidth: '620px',
          }}>
            Search your repository&apos;s history, decisions, and context. Ask why something exists, what changed, and what to avoid.
          </p>

          {/* Stats row */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px',
            marginBottom: '28px',
          }}>
            <StatCard label="Commits" value={stats?.counts.commits} />
            <StatCard label="Merge requests" value={stats?.counts.merge_requests} />
            <StatCard label="Issues" value={stats?.counts.issues} />
            <StatCard label="Decisions" value={stats?.counts.decisions} />
            <StatCard label="Reverts" value={stats?.counts.reverts} accent />
          </div>

          {/* Composer */}
          <div style={{
            background: 'var(--card)', border: '1px solid var(--line)',
            borderRadius: '16px', padding: '14px 16px',
            display: 'flex', flexDirection: 'column', gap: '8px',
            marginBottom: '14px',
          }}>
            <textarea
              value={composer}
              onChange={e => setComposer(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendComposer();
                }
              }}
              rows={Math.min(5, Math.max(1, composer.split('\n').length))}
              placeholder="Ask about decisions, history, risky changes, or something specific…"
              style={{
                width: '100%', border: 'none', outline: 'none', resize: 'none',
                background: 'transparent', color: 'var(--ink)',
                fontSize: '14.5px', fontWeight: 500, lineHeight: 1.55,
                padding: '4px 4px',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ flex: 1 }} />
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '7px',
                padding: '5px 11px', borderRadius: '999px',
                background: 'rgba(61, 218, 232, .08)',
                border: '1px solid rgba(61, 218, 232, .25)',
                color: 'var(--teal2)', fontSize: '12px', fontWeight: 700,
              }}>
                <span style={{
                  width: '18px', height: '18px', borderRadius: '50%',
                  background: 'rgba(61, 218, 232, .25)',
                  display: 'grid', placeItems: 'center',
                  fontSize: '10px', fontWeight: 800, color: 'var(--teal2)',
                }}>
                  {firstName[0]?.toUpperCase()}
                </span>
                @{userHandle}
              </span>
              <span style={{
                fontSize: '11.5px', fontWeight: 600, color: 'var(--faint)',
                padding: '5px 11px', borderRadius: '999px',
                border: '1px solid var(--line)',
              }}>
                Enter ↵
              </span>
            </div>
          </div>

          {/* Quick actions */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '30px' }}>
            <QuickChip icon="◎" label="Score a MR" onClick={() => setRiskOpen(true)} />
            <QuickChip icon="↗" label="Recent activity" onClick={() => scrollTo(recentRef)} />
            <QuickChip icon="◇" label="Risky areas" onClick={() => scrollTo(riskyRef)} />
            <QuickChip icon="↺" label="Past mistakes" onClick={() => setReversionsOpen(true)} />
          </div>

          {/* Two-col grid */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px',
          }}>
            {/* Recent activity */}
            <div ref={recentRef} style={panelStyle}>
              <PanelHeader title="Recent activity" onViewAll={() => router.push('/chat?ask=' + encodeURIComponent('Summarize the most important changes in this repository over the last month.'))} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {activity === null && <PanelSkeleton rows={4} />}
                {activity && stream.length === 0 && (
                  <PanelEmpty>No activity yet. Ingest the repo to see commits, MRs, and issues here.</PanelEmpty>
                )}
                {stream.map((item, i) => (
                  <ActivityRow key={i} item={item} />
                ))}
              </div>
            </div>

            {/* Top risky areas */}
            <div ref={riskyRef} style={panelStyle}>
              <PanelHeader title="Top risky areas" onViewAll={() => router.push('/chat?ask=' + encodeURIComponent('Which parts of this codebase are the riskiest to touch, based on revert and bug history?'))} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {hotspots.length === 0 ? (
                  <PanelEmpty>No hotspots surfaced yet. Score an MR or ingest the repo to populate this.</PanelEmpty>
                ) : (
                  hotspots.slice(0, 4).map((h, i) => (
                    <HotspotRow key={i} hotspot={h} repoUrl={stats?.repo_url} />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ---------------- Sub-components ---------------- */

function StatCard({ label, value, accent }: { label: string; value?: number; accent?: boolean }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--line)',
      borderRadius: '16px', padding: '18px 18px 16px',
      display: 'flex', flexDirection: 'column', gap: '6px',
      minWidth: 0,
    }}>
      <div style={{
        fontSize: '34px', fontWeight: 800, letterSpacing: '-0.02em',
        lineHeight: 1, color: accent ? 'var(--red)' : 'var(--ink)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {typeof value === 'number' ? value.toLocaleString() : '—'}
      </div>
      <div style={{
        fontSize: '11.5px', fontWeight: 700, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: 'var(--muted)',
      }}>
        {label}
      </div>
    </div>
  );
}

function QuickChip({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        padding: '10px 16px', borderRadius: '999px',
        border: '1px solid var(--line)', background: 'var(--card)',
        color: 'var(--ink)', fontSize: '13px', fontWeight: 600,
        cursor: 'pointer', transition: 'background .12s ease, border-color .12s ease',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--card-soft)';
        e.currentTarget.style.borderColor = 'var(--line-strong)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'var(--card)';
        e.currentTarget.style.borderColor = 'var(--line)';
      }}
    >
      <span style={{ color: 'var(--teal2)', fontSize: '12px' }}>{icon}</span>
      {label}
    </button>
  );
}

function NavItem({ icon, label, active, onClick }: {
  icon: string;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: '12px',
        padding: '9px 12px', borderRadius: '10px',
        border: 'none', background: active ? 'var(--card)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--muted)',
        fontSize: '13px', fontWeight: active ? 700 : 600,
        cursor: 'pointer', textAlign: 'left',
        marginBottom: '2px',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--card)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{
        width: '18px', display: 'inline-grid', placeItems: 'center',
        color: active ? 'var(--teal2)' : 'var(--faint)', fontSize: '14px',
      }}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function RepoOption({ value, active, onSelect }: { value: string; active: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      style={{
        width: '100%', textAlign: 'left',
        padding: '9px 12px', borderRadius: '8px',
        border: 'none',
        background: active ? 'var(--card-soft)' : 'transparent',
        color: active ? 'var(--ink)' : 'var(--muted)',
        fontSize: '12.5px', fontWeight: active ? 700 : 600,
        cursor: 'pointer',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--card-soft)'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      {value}
    </button>
  );
}

function PanelHeader({ title, onViewAll }: { title: string; onViewAll?: () => void }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: '8px',
    }}>
      <div style={{
        fontSize: '13px', fontWeight: 800, color: 'var(--ink)',
        letterSpacing: '-0.01em',
      }}>
        {title}
      </div>
      {onViewAll && (
        <button
          onClick={onViewAll}
          style={{
            border: 'none', background: 'transparent',
            color: 'var(--muted)', fontSize: '12px', fontWeight: 600,
            cursor: 'pointer', padding: 0,
          }}
        >
          View all →
        </button>
      )}
    </div>
  );
}

function ActivityRow({ item }: { item: StreamItem }) {
  const kindLabel = item.kind === 'mr' ? 'MR' : item.kind === 'issue' ? 'Issue' : 'Commit';
  const content = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '10px 8px', borderRadius: '8px',
      transition: 'background .12s ease',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--card-soft)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{
        flex: 'none', fontSize: '10px', fontWeight: 800,
        textTransform: 'uppercase', letterSpacing: '0.06em',
        padding: '3px 8px', borderRadius: '999px',
        background: 'rgba(61, 218, 232, .10)',
        color: 'var(--teal2)',
        border: '1px solid rgba(61, 218, 232, .20)',
      }}>
        {kindLabel}
      </span>
      <span style={{
        flex: 1, fontSize: '13px', fontWeight: 600, color: 'var(--ink)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {item.title}
      </span>
      <span style={{
        flex: 'none', fontSize: '11.5px', color: 'var(--faint)', fontWeight: 600,
      }}>
        {relativeTime(item.ts)}
      </span>
    </div>
  );
  if (item.url) {
    return (
      <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
        {content}
      </a>
    );
  }
  return content;
}

function HotspotRow({ hotspot, repoUrl }: { hotspot: Hotspot; repoUrl?: string }) {
  const file = hotspot.file || '';
  const display = file.length > 40 ? '…' + file.slice(-39) : file;
  const url = repoUrl ? `${repoUrl}/-/blob/master/${file}` : undefined;
  // Backend (`agent/insights.py:hotspots`) returns `risk` as a NUMBER —
  // `reverts*20 + decisions*4 + churn`. Bucket it into a label here so the
  // UI matches the rest of the product (Risk Radar's HIGH/MEDIUM/LOW).
  // Thresholds tuned for typical hotspot scores: a file with ≥1 revert
  // weighs in at ≥20, ≥2 reverts at ≥40.
  const riskScore = typeof hotspot.risk === 'number' ? hotspot.risk : 0;
  const risk = riskScore >= 40 ? 'HIGH' : riskScore >= 15 ? 'MEDIUM' : 'LOW';
  const riskTheme =
    risk === 'HIGH' ? { color: 'var(--red)', bg: 'rgba(255, 93, 143, .12)', border: 'rgba(255, 93, 143, .30)' }
    : risk === 'MEDIUM' ? { color: 'var(--amber)', bg: 'rgba(246, 166, 9, .12)', border: 'rgba(246, 166, 9, .30)' }
    : { color: 'var(--muted)', bg: 'var(--card-soft)', border: 'var(--line)' };
  const content = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '10px 8px', borderRadius: '8px',
      transition: 'background .12s ease',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--card-soft)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '13px', fontWeight: 600, color: 'var(--ink)',
          fontFamily: 'var(--font-mono)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}
          title={file}
        >
          {display}
        </div>
        <div style={{
          fontSize: '11px', color: 'var(--faint)', fontWeight: 600,
          marginTop: '3px',
        }}>
          {hotspot.churn !== undefined && <>Churn {hotspot.churn}</>}
          {hotspot.churn !== undefined && hotspot.reverts !== undefined && ' · '}
          {hotspot.reverts !== undefined && <>Reverts {hotspot.reverts}</>}
        </div>
      </div>
      {risk && (
        <span style={{
          flex: 'none', fontSize: '10px', fontWeight: 800,
          textTransform: 'uppercase', letterSpacing: '0.06em',
          padding: '3px 8px', borderRadius: '999px',
          background: riskTheme.bg, color: riskTheme.color,
          border: `1px solid ${riskTheme.border}`,
        }}>
          {risk}
        </span>
      )}
    </div>
  );
  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
        {content}
      </a>
    );
  }
  return content;
}

function PanelSkeleton({ rows }: { rows: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{
          height: '38px', borderRadius: '8px',
          background: 'var(--card-soft)',
          margin: '4px 0', opacity: 0.6,
        }} />
      ))}
    </>
  );
}

function PanelEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '14px 10px', fontSize: '13px',
      color: 'var(--muted)', fontWeight: 500, lineHeight: 1.55,
    }}>
      {children}
    </div>
  );
}

/* ---------------- Reversions modal ---------------- */

function ReversionsModal({ open, onClose, projectId }: {
  open: boolean;
  onClose: () => void;
  projectId: string;
}) {
  const [data, setData] = useState<Reversion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setData(null);
    setError(null);
    fetch(`/api/reversions?project_id=${encodeURIComponent(projectId)}&limit=10`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load')))
      .then((j: ReversionsResponse) => setData(j.reversions || []))
      .catch(() => setError('Could not load reversions.'));
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(6px)',
        display: 'grid', placeItems: 'center', padding: '24px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '560px', maxHeight: '80vh',
          background: 'var(--card)', borderRadius: '20px',
          border: '1px solid var(--line-strong)', boxShadow: 'var(--shadow-lg)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '18px 22px 14px', borderBottom: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: '12px',
        }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '12px',
            background: 'rgba(255, 93, 143, .12)',
            border: '1px solid rgba(255, 93, 143, .30)',
            display: 'grid', placeItems: 'center', color: 'var(--red)',
            fontSize: '16px', flex: 'none',
          }}>↺</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '15px', fontWeight: 800, letterSpacing: '-0.01em' }}>
              Past mistakes
            </div>
            <div style={{ fontSize: '12px', color: 'var(--muted)', fontWeight: 600 }}>
              Decisions this team has reverted — don&apos;t repeat them.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              border: 'none', background: 'transparent', color: 'var(--muted)',
              fontSize: '20px', cursor: 'pointer', padding: '4px 8px', lineHeight: 1,
            }}
          >×</button>
        </div>
        <div style={{ padding: '12px 14px', overflowY: 'auto', flex: 1 }}>
          {error && <div style={{ color: 'var(--red)', fontSize: '13px', padding: '12px' }}>{error}</div>}
          {!error && data === null && <PanelSkeleton rows={5} />}
          {!error && data && data.length === 0 && (
            <PanelEmpty>No reverted decisions found for this project yet.</PanelEmpty>
          )}
          {!error && data && data.map((r, i) => {
            const content = (
              <div style={{
                padding: '12px 14px', borderRadius: '10px',
                border: '1px solid var(--line)', background: 'var(--card-soft)',
                marginBottom: '8px',
              }}>
                <div style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--ink)', lineHeight: 1.45 }}>
                  {r.title || '(untitled)'}
                </div>
                <div style={{
                  marginTop: '6px', fontSize: '11.5px', color: 'var(--faint)', fontWeight: 600,
                  display: 'flex', gap: '10px', flexWrap: 'wrap',
                }}>
                  {r.source_type && r.source_id !== undefined && (
                    <span>Source {r.source_type} #{String(r.source_id)}</span>
                  )}
                  {r.reverted_mr_id !== undefined && r.reverted_mr_id !== null && (
                    <span>Reverted by !{String(r.reverted_mr_id)}</span>
                  )}
                  {r.timestamp && <span>{relativeTime(r.timestamp)}</span>}
                </div>
              </div>
            );
            return r.web_url
              ? <a key={i} href={r.web_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>{content}</a>
              : <div key={i}>{content}</div>;
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Style helpers ---------------- */

const centerStyle: React.CSSProperties = {
  display: 'flex', height: '100vh',
  alignItems: 'center', justifyContent: 'center',
};

const sectionLabel: React.CSSProperties = {
  fontSize: '10.5px',
  fontWeight: 700,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  color: 'var(--faint)',
  marginBottom: '8px',
};

const overlineStyle: React.CSSProperties = {
  fontSize: '11.5px',
  fontWeight: 700,
  letterSpacing: '0.10em',
  textTransform: 'uppercase',
  color: 'var(--teal2)',
};

const panelStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--line)',
  borderRadius: '16px',
  padding: '16px 14px',
  minWidth: 0,
};

/* ---------------- Helpers ---------------- */

const RTF = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat
  ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  : null;

function relativeTime(iso: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diffSec = (t - Date.now()) / 1000;
  const abs = Math.abs(diffSec);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['week', 60 * 60 * 24 * 7],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1],
  ];
  for (const [unit, secs] of units) {
    if (abs >= secs || unit === 'second') {
      const value = Math.round(diffSec / secs);
      if (RTF) return RTF.format(value, unit);
      return `${Math.abs(value)}${unit[0]} ago`;
    }
  }
  return '';
}
