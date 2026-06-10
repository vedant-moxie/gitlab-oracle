/* The DevGenie mascot — used as hero figure, avatar and thinking indicator.
   Styling is inline (not in globals.css) so a stale cached stylesheet can
   never draw a box/plate behind the transparent cutout. */

export default function Genie({ size = 34, think = false, hero = false }: {
  size?: number;
  think?: boolean;
  hero?: boolean;
}) {
  const base: React.CSSProperties = {
    width: size,
    height: size,
    flex: 'none',
    display: 'block',
    border: 'none',
    borderRadius: 0,
    background: 'transparent',
    boxShadow: 'none',
  };

  const style: React.CSSProperties = hero
    ? {
        ...base,
        objectFit: 'contain',
        filter: 'drop-shadow(0 22px 44px rgba(47, 212, 232, .35))',
      }
    : {
        ...base,
        objectFit: 'cover',
        objectPosition: '50% 18%',
        borderRadius: '50%',
        background: 'radial-gradient(60% 60% at 50% 35%, rgba(47, 212, 232, .16), rgba(13, 30, 42, .9))',
        border: '1px solid rgba(47, 212, 232, .35)',
        boxShadow: '0 8px 22px rgba(47, 212, 232, .3)',
      };

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/genie-v2.png"
      alt="DevGenie"
      className={`genie-motion ${hero ? 'hero' : ''} ${think ? 'think' : ''}`}
      style={style}
    />
  );
}
