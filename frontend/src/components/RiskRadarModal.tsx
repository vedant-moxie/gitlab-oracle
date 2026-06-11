'use client';
import { useState, useEffect, useRef } from 'react';
import { patHeaders } from '@/lib/settings';

type Reason = {
  kind: 'reverted_precedent' | 'risky_file' | 'bus_factor' | 'prior_art' | 'clear' | string;
  weight: number;
  text: string;
  url?: string;
};

type RiskResult = {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: Reason[];
};

const LEVEL_THEME: Record<string, { color: string; bg: string; emoji: string }> = {
  LOW: { color: '#16a34a', bg: 'rgba(22,163,74,.10)', emoji: '🟢' },
  MEDIUM: { color: '#d97706', bg: 'rgba(217,119,6,.10)', emoji: '🟡' },
  HIGH: { color: '#dc2626', bg: 'rgba(220,38,38,.10)', emoji: '🔴' },
};

const KIND_LABEL: Record<string, string> = {
  reverted_precedent: 'Reverted precedent',
  risky_file: 'Risky file',
  bus_factor: 'Bus factor',
  prior_art: 'Prior art',
  clear: 'No history match',
};

export default function RiskRadarModal({
  open, onClose, projectId, repoLabel, initialTitle, onSendToChat,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  repoLabel?: string;
  // When set, pre-populates the title field on open. Used by the `/score`
  // chat slash command so users don't retype what they just typed.
  initialTitle?: string;
  onSendToChat?: (formattedMarkdown: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [filesText, setFilesText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RiskResult | null>(null);
  const [error, setError] = useState<string>('');
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Reset on each open so the modal never shows stale results between sessions.
  // initialTitle in the deps so a new slash-command pre-fill replaces stale text.
  useEffect(() => {
    if (open) {
      setTitle(initialTitle?.trim() || '');
      setDescription('');
      setFilesText('');
      setResult(null);
      setError('');
      setTimeout(() => firstInputRef.current?.focus(), 50);
    }
  }, [open, initialTitle]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async () => {
    if (!title.trim()) return;
    setLoading(true);
    setResult(null);
    setError('');
    try {
      const files = filesText.split('\n').map(f => f.trim()).filter(Boolean);
      const res = await fetch('/api/risk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...patHeaders() },
        body: JSON.stringify({
          project_id: projectId,
          title: title.trim(),
          description: description.trim(),
          files,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Failed to score MR.');
      } else {
        setResult(data);
      }
    } catch {
      setError('Network error — could not reach DevGenie.');
    } finally {
      setLoading(false);
    }
  };

  const sendToChat = () => {
    if (!result || !onSendToChat) return;
    const theme = LEVEL_THEME[result.level] || LEVEL_THEME.LOW;
    const top = result.reasons[0];
    const lines = [
      `## 🎯 Risk Radar — ${title.trim()}`,
      '',
      `**${theme.emoji} Risk: ${result.level} (${result.score}/100)** — ${top?.text ?? ''}`,
      '',
      '**Reasons:**',
      ...result.reasons.map(r => {
        const k = KIND_LABEL[r.kind] || r.kind;
        const link = r.url ? ` [↗](${r.url})` : '';
        return `- _${k}_${r.weight ? ` (+${r.weight})` : ''}: ${r.text}${link}`;
      }),
    ];
    onSendToChat(lines.join('\n'));
    onClose();
  };

  const theme = result ? LEVEL_THEME[result.level] : null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(6px)',
        display: 'grid', placeItems: 'center', padding: '24px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '620px', maxHeight: '88vh',
          background: 'var(--card)', borderRadius: '24px',
          boxShadow: '0 30px 80px rgba(15,23,42,.35)',
          border: '1px solid var(--line)', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <div style={{
          padding: '20px 24px 14px',
          borderBottom: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: '12px',
        }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '14px',
            background: 'var(--grad)', display: 'grid', placeItems: 'center',
            fontSize: '20px', flex: 'none',
          }}>🎯</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '16px', fontWeight: 800, letterSpacing: '-0.01em' }}>
              Risk Radar
            </div>
            <div style={{ fontSize: '12.5px', color: 'var(--muted)', fontWeight: 600 }}>
              Score an MR against {repoLabel || 'this repository'}&apos;s memory
            </div>
          </div>
          <button onClick={onClose} title="Close" style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            color: 'var(--muted)', fontSize: '22px', lineHeight: 1, padding: '6px 10px',
          }}>×</button>
        </div>

        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <label style={fieldLabel}>
              MR title
              <input
                ref={firstInputRef}
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder='e.g. "Use Sidekiq for inline auth checks"'
                style={fieldInput}
              />
            </label>
            <label style={fieldLabel}>
              Description <span style={{ color: 'var(--faint)', fontWeight: 500 }}>(optional)</span>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Paste the MR description for higher-quality scoring…"
                rows={3}
                style={{ ...fieldInput, resize: 'vertical' }}
              />
            </label>
            <label style={fieldLabel}>
              Touched files <span style={{ color: 'var(--faint)', fontWeight: 500 }}>(optional, one per line)</span>
              <textarea
                value={filesText}
                onChange={e => setFilesText(e.target.value)}
                placeholder={'app/services/auth/login.rb\nlib/auth/sidekiq_worker.rb'}
                rows={3}
                style={{
                  ...fieldInput, resize: 'vertical', fontSize: '13px',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
              />
            </label>
            <button
              onClick={submit}
              disabled={loading || !title.trim()}
              style={{
                marginTop: '4px', padding: '12px 18px', borderRadius: '999px', border: 'none',
                background: 'var(--grad)', color: '#fff', fontSize: '14.5px', fontWeight: 800,
                cursor: (loading || !title.trim()) ? 'default' : 'pointer',
                opacity: (loading || !title.trim()) ? 0.5 : 1,
                boxShadow: '0 12px 30px rgba(244,116,44,.32)',
              }}
            >
              {loading ? 'Scoring…' : '🎯 Score this MR'}
            </button>
          </div>

          {error && (
            <div style={{
              marginTop: '18px', padding: '12px 16px', borderRadius: '14px',
              background: 'rgba(220,38,38,.08)', border: '1px solid rgba(220,38,38,.25)',
              color: '#dc2626', fontSize: '13.5px', fontWeight: 600,
            }}>
              {error}
            </div>
          )}

          {result && theme && (
            <div style={{ marginTop: '22px' }}>
              <div style={{
                padding: '20px 22px', borderRadius: '20px',
                background: theme.bg, border: `1px solid ${theme.color}33`,
                display: 'flex', alignItems: 'center', gap: '18px',
              }}>
                <div style={{
                  fontSize: '46px', fontWeight: 900, color: theme.color,
                  letterSpacing: '-0.04em', fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1,
                }}>
                  {result.score}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                    padding: '4px 12px', borderRadius: '999px',
                    background: theme.color, color: '#fff',
                    fontSize: '12px', fontWeight: 800, letterSpacing: '0.04em',
                  }}>
                    {theme.emoji} {result.level}
                  </div>
                  <div style={{
                    fontSize: '13px', color: 'var(--muted)', marginTop: '6px',
                    fontWeight: 600,
                  }}>
                    {result.reasons.length} signal{result.reasons.length === 1 ? '' : 's'} contributing
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {result.reasons.map((r, i) => (
                  <div key={i} style={{
                    padding: '12px 16px', borderRadius: '14px',
                    background: 'var(--card-soft)',
                    border: '1px solid var(--line)',
                    display: 'flex', flexDirection: 'column', gap: '6px',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      fontSize: '11px', fontWeight: 800, letterSpacing: '0.04em',
                      textTransform: 'uppercase', color: 'var(--muted)',
                    }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: '999px',
                        background: r.weight > 0 ? 'rgba(220,38,38,.12)' : 'rgba(100,116,139,.12)',
                        color: r.weight > 0 ? '#dc2626' : 'var(--muted)',
                      }}>
                        {KIND_LABEL[r.kind] || r.kind}
                      </span>
                      {r.weight > 0 && (
                        <span style={{ color: '#dc2626' }}>+{r.weight}</span>
                      )}
                    </div>
                    <div style={{ fontSize: '13.5px', color: 'var(--ink)', lineHeight: 1.5, fontWeight: 500 }}>
                      {r.text}
                    </div>
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" style={{
                        fontSize: '12px', fontWeight: 700, color: 'var(--teal2)',
                        textDecoration: 'none',
                      }}>
                        Open citation ↗
                      </a>
                    )}
                  </div>
                ))}
              </div>

              {onSendToChat && (
                <button onClick={sendToChat} style={{
                  marginTop: '18px', width: '100%', padding: '12px 18px',
                  borderRadius: '999px', border: '1px solid var(--line-strong)',
                  background: 'transparent', color: 'var(--ink)',
                  fontSize: '13.5px', fontWeight: 700, cursor: 'pointer',
                }}>
                  💬 Send this score to chat
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  display: 'block',
  fontSize: '11.5px',
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--muted)',
  marginBottom: 0,
};

const fieldInput: React.CSSProperties = {
  marginTop: '7px',
  display: 'block',
  width: '100%',
  padding: '11px 14px',
  borderRadius: '14px',
  border: '1px solid var(--line)',
  background: 'var(--card)',
  fontSize: '14px',
  fontWeight: 500,
  color: 'var(--ink)',
  outline: 'none',
};
