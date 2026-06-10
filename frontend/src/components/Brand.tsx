/* Magic-lamp mark + "DevGenie" wordmark */

export function LampMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" style={{ flex: 'none' }}>
      {/* genie wisp */}
      <path
        d="M17 4c4 1 6 4 5 7-.8 2.4-3.4 3.4-4.6 5.4"
        stroke="url(#wisp)" strokeWidth="2.4" strokeLinecap="round" fill="none"
      />
      <circle cx="17.5" cy="3.5" r="1.8" fill="#5ee6f5" />
      {/* lamp body */}
      <path
        d="M8 20c0-2.8 3.2-5 8-5s8 2.2 8 5c0 1.9-1.4 3.6-3.6 4.5l1.1 2.5H10.5l1.1-2.5C9.4 23.6 8 21.9 8 20Z"
        fill="url(#lamp)"
      />
      {/* spout */}
      <path d="M8.4 18.5C6 18 4.2 16.6 3.5 14.6c2.6-.4 4.7.4 6 2" fill="url(#lamp)" />
      {/* lid knob */}
      <circle cx="16" cy="14" r="1.6" fill="#ffa34d" />
      <defs>
        <linearGradient id="lamp" x1="4" y1="14" x2="26" y2="27">
          <stop stopColor="#f4742c" />
          <stop offset="1" stopColor="#ffa34d" />
        </linearGradient>
        <linearGradient id="wisp" x1="14" y1="18" x2="23" y2="4">
          <stop stopColor="#2fd4e8" />
          <stop offset="1" stopColor="#5ee6f5" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function Wordmark({ size = 17 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      Dev<em>Genie</em>
    </span>
  );
}

export default function Brand({ markSize = 30, textSize = 17 }: { markSize?: number; textSize?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <LampMark size={markSize} />
      <Wordmark size={textSize} />
    </span>
  );
}
