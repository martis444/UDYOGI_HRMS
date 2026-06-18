"use client";

interface Props {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}

export default function GlassCard({ children, className = "", hover = false }: Props) {
  return (
    <div
      className={`rounded-2xl border border-white/55 ${hover ? "glass-card-hover" : ""} ${className}`}
      style={{
        // Near-opaque: keep the frosted-glass brand edge but let data read cleanly
        background: "rgba(255,255,255,0.96)",
        backdropFilter: "blur(28px) saturate(180%)",
        WebkitBackdropFilter: "blur(28px) saturate(180%)",
        boxShadow: "0 8px 40px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.95)",
      }}
    >
      {children}
    </div>
  );
}
