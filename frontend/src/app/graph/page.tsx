'use client';
import { useSession } from "next-auth/react";
import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Brand from "@/components/Brand";
import Genie from "@/components/Genie";

/* ---------------- Types ---------------- */

type NodeKind = 'decision' | 'mr' | 'issue' | 'commit' | 'file';
type EdgeKind = 'reverted' | 'about' | 'links' | 'touches';

type GraphNode = {
  id: string;
  label: string;
  type: NodeKind;
  url: string | null;
  reverted: boolean;
};
type GraphEdge = {
  from: string;
  to: string;
  type: EdgeKind;
};
type GraphResponse = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  counts: { nodes: number; edges: number };
};
type Project = { id: number; path: string; name: string };

// Parse "decision:mr:123" → "123", "mr:456" → "456", "issue:789" → "789",
// "commit:abc123def" → "abc123def", "file:app/foo.rb" → "app/foo.rb". Returns
// null if the id doesn't have the expected `<type>:<rest>` shape.
function refFromId(id: string): string | null {
  const idx = id.indexOf(':');
  if (idx < 0) return null;
  const after = id.slice(idx + 1);
  // For decision ids of form "decision:mr:123", strip one more layer
  if (id.startsWith('decision:')) {
    const inner = after.indexOf(':');
    if (inner >= 0) return after.slice(inner + 1);
  }
  return after;
}

// Build the prompt that gets sent to /chat when the user clicks
// "Ask DevGenie about this →" in the node detail panel.
function promptForNode(node: GraphNode): string {
  const ref = refFromId(node.id);
  const label = node.label || 'this item';
  switch (node.type) {
    case 'mr':
      return ref
        ? `Tell me about MR !${ref}: "${label}". Use lookup_reference for the live state and search_decision_history for the surrounding decisions. Cite everything.`
        : `Tell me about this merge request: "${label}". Cite everything.`;
    case 'issue':
      return ref
        ? `Tell me about issue #${ref}: "${label}". Use lookup_reference and explain what changed in response.`
        : `Tell me about this issue: "${label}".`;
    case 'commit':
      return ref
        ? `Tell me about commit ${ref}: "${label}". Use lookup_reference and explain its rationale plus what the linked MR/issue was.`
        : `Tell me about this commit: "${label}".`;
    case 'file':
      return `Tell me about the file "${label}". Use explain_code_decision to walk through its history and surface the most important decisions that shaped it.`;
    case 'decision':
    default:
      return `Tell me the full story behind this decision: "${label}". Use the historical tools, cite the originating commit/MR/issue, and explain what was tried and why it succeeded or was reverted.`;
  }
}

const DEFAULT_REPO = 'gitlab-org/gitlab';
const TOP_BAR_HEIGHT = 60; // px

/* ---------------- Color / shape recipe ---------------- */

const NODE_COLORS: Record<NodeKind, string> = {
  decision: '#0891b2', // teal
  mr: '#f59e0b',       // amber
  issue: '#64748b',    // gray
  commit: '#94a3b8',   // slate
  file: '#7c3aed',     // muted purple
};

const NODE_SHAPES: Record<NodeKind, string> = {
  decision: 'square',
  mr: 'dot',
  issue: 'triangle',
  commit: 'dot',
  file: 'diamond',
};

const REVERTED_COLOR = '#dc2626';

/* ---------------- Page wrapper (Suspense for useSearchParams) ---------------- */

export default function GraphPage() {
  return (
    <Suspense fallback={<CenteredSpinner label="Loading…" />}>
      <GraphView />
    </Suspense>
  );
}

/* ---------------- Main view ---------------- */

function GraphView() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const repo = searchParams.get('project_id') || DEFAULT_REPO;

  const [projects, setProjects] = useState<Project[]>([]);
  const [data, setData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);

  /* ----- Project list ----- */
  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/projects')
      .then(r => r.ok ? r.json() : [])
      .then(p => { if (Array.isArray(p)) setProjects(p); })
      .catch(() => { /* swallow — picker keeps default option */ });
  }, [status]);

  /* ----- Fetch graph (cache-first, then background revalidate) ----- */
  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    setErrorMsg(null);
    setSelectedNode(null);

    // 1. Cache-first hydrate: if we have a fresh cache, render instantly
    //    and skip the loading spinner — the live fetch revalidates silently.
    const key = `devgenie:graph:${encodeURIComponent(repo)}`;
    let hadCache = false;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed?.cachedAt &&
          Date.now() - parsed.cachedAt < 5 * 60 * 1000 &&
          parsed?.data
        ) {
          setData(parsed.data as GraphResponse);
          hadCache = true;
        }
      }
    } catch { /* corrupted cache — fall through to cold fetch */ }

    if (!hadCache) {
      setData(null);
      setLoading(true);
    } else {
      // Cache hit — viewer renders immediately, no spinner.
      setLoading(false);
    }

    // 2. Background revalidate: always hit the live endpoint and replace
    //    data when fresh JSON arrives.
    fetch(`/api/graph?project_id=${encodeURIComponent(repo)}`)
      .then(async r => {
        if (!r.ok) throw new Error(`Backend responded ${r.status}`);
        return r.json() as Promise<GraphResponse>;
      })
      .then(d => {
        if (cancelled) return;
        setData(d);
        // 3. Cache write on fresh fetch.
        try {
          sessionStorage.setItem(key, JSON.stringify({ cachedAt: Date.now(), data: d }));
        } catch { /* sessionStorage may be unavailable — ignore */ }
      })
      .catch(err => {
        // Only surface an error when we had nothing to show; otherwise keep
        // the cached graph on screen and stay silent.
        if (!cancelled && !hadCache) {
          setErrorMsg(err?.message || 'Could not load graph.');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [repo, status]);

  /* ----- Vis-network — option (a): dynamic import inside useEffect ----- */
  useEffect(() => {
    if (!data || !containerRef.current || data.counts.nodes === 0) return;

    let net: any = null;
    let destroyed = false;
    const nodeById: Record<string, GraphNode> = Object.fromEntries(data.nodes.map(n => [n.id, n]));

    (async () => {
      const visMod = await import('vis-network/standalone');
      if (destroyed || !containerRef.current) return;

      const visNodes = data.nodes.map(n => {
        const color = n.reverted ? REVERTED_COLOR : NODE_COLORS[n.type] || '#94a3b8';
        return {
          id: n.id,
          label: n.label,
          shape: NODE_SHAPES[n.type] || 'dot',
          size: n.type === 'decision' ? 16 : 11,
          color: {
            background: color,
            border: n.reverted ? '#7f1d1d' : '#0b1620',
            highlight: { background: color, border: '#e9f3f7' },
          },
          font: { color: '#e9f3f7', size: 12, face: 'Plus Jakarta Sans', strokeWidth: 0 },
        };
      });

      const visEdges = data.edges.map(e => {
        const reverted = e.type === 'reverted';
        const touches = e.type === 'touches';
        return {
          from: e.from,
          to: e.to,
          color: {
            color: reverted ? REVERTED_COLOR : 'rgba(203,213,225,.55)',
            highlight: reverted ? REVERTED_COLOR : '#2fd4e8',
          },
          width: reverted ? 2.5 : 1,
          dashes: touches,
          arrows: reverted ? 'to' : undefined,
        };
      });

      // Mirror the legacy ui/index.html options block.
      const options = {
        physics: {
          stabilization: { iterations: 180 },
          barnesHut: { gravitationalConstant: -9000, springLength: 120, springConstant: 0.03 },
        },
        interaction: { hover: true, tooltipDelay: 120 },
        nodes: { borderWidth: 2 },
        edges: { smooth: { enabled: true, type: 'continuous', roundness: 0.5 } },
      };

      net = new visMod.Network(
        containerRef.current,
        {
          nodes: new visMod.DataSet(visNodes as any),
          edges: new visMod.DataSet(visEdges as any),
        },
        options as any,
      );

      // Light drag: turn off physics after first stabilization.
      net.once('stabilizationIterationsDone', () => {
        net?.setOptions({ physics: false });
      });

      net.on('click', (e: { nodes: string[] }) => {
        if (e.nodes.length) {
          setSelectedNode(nodeById[e.nodes[0]] || null);
        } else {
          setSelectedNode(null);
        }
      });
    })();

    return () => {
      destroyed = true;
      try { net?.destroy?.(); } catch { /* noop */ }
    };
  }, [data]);

  /* ----- Auth gate ----- */
  if (status === 'loading') {
    return <CenteredSpinner label="" />;
  }
  if (status === 'unauthenticated') {
    router.replace('/');
    return null;
  }

  const empty = !loading && data && data.counts.nodes === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
      {/* ============ Top bar ============ */}
      <header
        className="glass"
        style={{
          flex: 'none',
          height: TOP_BAR_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          padding: '0 20px',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <Brand markSize={28} textSize={16} />
        <div style={{
          width: '1px', height: '24px', background: 'var(--line)',
          margin: '0 4px',
        }} />
        <label style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--faint)' }}>
          Repo
        </label>
        <select
          value={repo}
          onChange={e => {
            const next = e.target.value;
            const params = new URLSearchParams(Array.from(searchParams.entries()));
            params.set('project_id', next);
            router.replace(`/graph?${params.toString()}`);
          }}
          style={{
            padding: '8px 12px',
            borderRadius: '10px',
            border: '1px solid var(--line)',
            background: 'var(--card)',
            color: 'var(--ink)',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: 'var(--shadow-sm)',
            outline: 'none',
            maxWidth: '320px',
          }}
        >
          <option value={DEFAULT_REPO}>{DEFAULT_REPO}</option>
          {projects.filter(p => p.path !== DEFAULT_REPO).map(p => (
            <option key={p.id} value={p.path}>{p.path}</option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <Link
          href="/chat"
          style={{
            fontSize: '12.5px',
            fontWeight: 600,
            color: 'var(--muted)',
            textDecoration: 'none',
            border: '1px solid var(--line)',
            borderRadius: '999px',
            padding: '7px 14px',
            background: 'var(--card)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          ← Back to chat
        </Link>
      </header>

      {/* ============ Viewport ============ */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: `calc(100vh - ${TOP_BAR_HEIGHT}px)`,
          overflow: 'hidden',
        }}
      >
        {/* Graph container */}
        <div
          id="graph"
          ref={containerRef}
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(800px 500px at 30% 20%, rgba(47,212,232,.06) 0%, transparent 60%), var(--bg)',
          }}
        />

        {/* Loading overlay */}
        {loading && (
          <div style={overlayStyle}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
              <Genie size={56} think />
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--muted)' }}>
                Building memory graph…
              </div>
              <div className="thinking-dots"><span /><span /><span /></div>
            </div>
          </div>
        )}

        {/* Error state */}
        {!loading && errorMsg && (
          <div style={overlayStyle}>
            <div style={{
              maxWidth: '420px',
              padding: '20px 24px',
              borderRadius: 'var(--radius)',
              background: 'var(--card)',
              border: '1px solid rgba(255,107,107,.3)',
              boxShadow: 'var(--shadow-sm)',
              textAlign: 'center',
              color: 'var(--ink)',
            }}>
              <div style={{ fontWeight: 800, marginBottom: '6px', color: 'var(--red)' }}>
                Couldn&apos;t load the graph
              </div>
              <div style={{ fontSize: '13px', color: 'var(--muted)' }}>{errorMsg}</div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {empty && (
          <div style={overlayStyle}>
            <div style={{
              maxWidth: '440px',
              padding: '22px 26px',
              borderRadius: 'var(--radius)',
              background: 'var(--card)',
              border: '1px solid var(--line-strong)',
              boxShadow: 'var(--shadow-sm)',
              textAlign: 'center',
              color: 'var(--ink)',
            }}>
              <div style={{ fontSize: '15px', fontWeight: 800, marginBottom: '8px' }}>
                No memory graph yet
              </div>
              <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: 1.6 }}>
                This repository hasn&apos;t been ingested yet — open the chat and click
                {' '}<em>Ingest this repository</em> to build its memory graph.
              </div>
              <Link
                href={`/chat`}
                style={{
                  display: 'inline-block',
                  marginTop: '14px',
                  padding: '9px 16px',
                  borderRadius: '999px',
                  background: 'var(--grad)',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 700,
                  textDecoration: 'none',
                  boxShadow: '0 10px 24px rgba(244,116,44,.3)',
                }}
              >
                Open chat →
              </Link>
            </div>
          </div>
        )}

        {/* Floating legend (top-right) */}
        {!loading && !errorMsg && !empty && (
          <div
            className="glass"
            style={{
              position: 'absolute',
              top: '14px',
              right: '320px',
              padding: '10px 14px',
              borderRadius: '12px',
              border: '1px solid var(--line)',
              fontSize: '11.5px',
              fontWeight: 600,
              color: 'var(--muted)',
              boxShadow: 'var(--shadow-sm)',
              zIndex: 5,
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              minWidth: '170px',
            }}
          >
            <LegendRow color={REVERTED_COLOR} label="Reverted (decision / edge)" />
            <LegendRow color={NODE_COLORS.decision} label="Decision (implemented)" />
            <LegendRow color={NODE_COLORS.mr} label="MR" />
            <LegendRow color={NODE_COLORS.issue} label="Issue" />
          </div>
        )}

        {/* Side panel */}
        <aside
          className="glass"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: '300px',
            borderLeft: '1px solid var(--line)',
            padding: '18px 18px 22px',
            overflowY: 'auto',
            zIndex: 4,
          }}
        >
          <div style={{
            fontSize: '11px',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--faint)',
            marginBottom: '12px',
          }}>
            Node detail
          </div>
          {selectedNode ? (
            <NodeDetail node={selectedNode} />
          ) : (
            <div style={{ fontSize: '13px', color: 'var(--muted)', lineHeight: 1.6 }}>
              Click a node to see details.
            </div>
          )}

          {data && data.counts.nodes > 0 && (
            <div style={{
              marginTop: '24px',
              paddingTop: '16px',
              borderTop: '1px solid var(--line)',
              fontSize: '12px',
              color: 'var(--faint)',
              fontWeight: 600,
              display: 'flex',
              gap: '14px',
            }}>
              <span><strong style={{ color: 'var(--ink)' }}>{data.counts.nodes.toLocaleString()}</strong> nodes</span>
              <span><strong style={{ color: 'var(--ink)' }}>{data.counts.edges.toLocaleString()}</strong> edges</span>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ---------------- Sub-components ---------------- */

function NodeDetail({ node }: { node: GraphNode }) {
  const router = useRouter();
  const typeLabel: Record<NodeKind, string> = {
    decision: 'Decision',
    mr: 'Merge Request',
    issue: 'Issue',
    commit: 'Commit',
    file: 'File',
  };
  const accent = node.reverted ? REVERTED_COLOR : (NODE_COLORS[node.type] || '#94a3b8');
  return (
    <div>
      <span
        style={{
          display: 'inline-block',
          padding: '3px 10px',
          borderRadius: '999px',
          fontSize: '10.5px',
          fontWeight: 800,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          background: `${accent}22`,
          color: accent,
          border: `1px solid ${accent}55`,
          marginBottom: '12px',
        }}
      >
        {node.reverted ? 'Reverted · ' : ''}{typeLabel[node.type] || node.type}
      </span>
      <h3 style={{
        margin: '0 0 14px',
        fontSize: '15px',
        fontWeight: 700,
        lineHeight: 1.4,
        color: 'var(--ink)',
        wordBreak: 'break-word',
      }}>
        {node.label}
      </h3>
      {node.url ? (
        <a
          href={node.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block',
            padding: '8px 14px',
            borderRadius: '10px',
            background: 'rgba(47,212,232,.08)',
            border: '1px solid rgba(47,212,232,.35)',
            color: 'var(--teal2)',
            fontSize: '12.5px',
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          Open on GitLab ↗
        </a>
      ) : (
        <div style={{ fontSize: '12px', color: 'var(--faint)', fontWeight: 500 }}>
          No direct GitLab link for this node.
        </div>
      )}
      <button
        onClick={() => router.push(`/chat?ask=${encodeURIComponent(promptForNode(node))}`)}
        style={{
          display: 'block',
          width: '100%',
          marginTop: '14px',
          padding: '12px 18px',
          borderRadius: '999px',
          border: 'none',
          background: 'var(--grad)',
          color: '#fff',
          fontSize: '13px',
          fontWeight: 800,
          cursor: 'pointer',
          boxShadow: '0 12px 30px rgba(244,116,44,.32)',
          textAlign: 'center',
        }}
      >
        💬 Ask DevGenie about this →
      </button>
    </div>
  );
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{
        width: '10px', height: '10px', borderRadius: '50%',
        background: color, flex: 'none',
        boxShadow: `0 0 6px ${color}88`,
      }} />
      <span>{label}</span>
    </div>
  );
}

function CenteredSpinner({ label }: { label: string }) {
  return (
    <div style={{
      display: 'flex', height: '100vh',
      alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: '14px',
    }}>
      <Genie size={56} think />
      {label && (
        <div style={{ fontSize: '13px', color: 'var(--muted)', fontWeight: 600 }}>{label}</div>
      )}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
  zIndex: 3,
};
