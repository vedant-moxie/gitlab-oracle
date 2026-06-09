export default function Orb({ size = "big", think = false }: { size?: "big" | "mini", think?: boolean }) {
  return (
    <div className={`orb ${size} ${think ? "think" : ""}`}></div>
  );
}