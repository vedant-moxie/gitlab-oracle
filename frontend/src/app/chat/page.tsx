'use client';
import { useSession } from "next-auth/react";
import { useState, useRef, useEffect } from "react";
import Orb from "@/components/Orb";

export default function Chat() {
  const { data: session, status } = useSession();
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant', content: string }[]>([
    { role: 'assistant', content: 'Hi! I am your GitLab Oracle. What repository would you like to explore today?' }
  ]);
  const [input, setInput] = useState('');
  const [projectId, setProjectId] = useState('gitlab-org/gitlab'); // Default for demo
  const [loading, setLoading] = useState(false);
  const endOfMessagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (status === "loading") return <div style={centerStyle}>Loading...</div>;
  if (status === "unauthenticated") return <div style={centerStyle}>Please login first.</div>;

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      // Proxy through Next.js API route to attach token securely
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg, project_id: projectId }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer || data.error }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ Network error communicating with Oracle.' }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', maxHeight: '100dvh', overflow: 'hidden', background: 'var(--card)' }}>
      {/* Header */}
      <header style={{ flexShrink: 0, padding: '16px 24px', display: 'flex', alignItems: 'center', gap: '16px', borderBottom: '1px solid var(--line)', background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(12px)' }}>
        <Orb size="mini" />
        <div>
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Oracle Assistant</h1>
          <div style={{ fontSize: '12px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>Targeting:</span>
            <input 
              value={projectId} 
              onChange={e => setProjectId(e.target.value)} 
              style={{ border: '1px solid var(--line)', borderRadius: '4px', padding: '2px 6px', fontSize: '12px', background: '#f6f5fc' }}
            />
          </div>
        </div>
      </header>

      {/* Chat Area */}
      <main style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '80%',
                padding: '16px 20px',
                borderRadius: '20px',
                borderBottomRightRadius: m.role === 'user' ? '4px' : '20px',
                borderBottomLeftRadius: m.role === 'assistant' ? '4px' : '20px',
                background: m.role === 'user' ? 'var(--grad)' : '#f6f5fc',
                color: m.role === 'user' ? '#fff' : 'var(--ink)',
                boxShadow: m.role === 'user' ? '0 8px 24px rgba(109,94,252,0.25)' : 'none',
                lineHeight: 1.6,
                fontSize: '15px'
              }}>
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
               <div style={{ background: '#f6f5fc', padding: '16px', borderRadius: '20px', borderBottomLeftRadius: '4px' }}>
                 <Orb size="mini" think={true} />
               </div>
            </div>
          )}
          <div ref={endOfMessagesRef} />
        </div>
      </main>

      {/* Input Area */}
      <footer style={{ flexShrink: 0, padding: '24px', background: 'linear-gradient(0deg, #fff 50%, rgba(255,255,255,0))' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', gap: '12px', background: '#fff', border: '1px solid var(--line)', padding: '8px 8px 8px 20px', borderRadius: '32px', boxShadow: 'var(--shadow)' }}>
          <input 
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
            placeholder="Ask about prior decisions, bugs, or architecture..."
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: '15px' }}
          />
          <button 
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            style={{ width: '40px', height: '40px', borderRadius: '50%', border: 'none', background: 'var(--grad)', color: '#fff', cursor: 'pointer', display: 'grid', placeItems: 'center', opacity: (loading || !input.trim()) ? 0.5 : 1 }}
          >
            ↑
          </button>
        </div>
      </footer>
    </div>
  );
}

const centerStyle = { display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 600, color: 'var(--muted)' };