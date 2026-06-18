"use client";

import { useEffect, useRef } from "react";

/**
 * The approved "liquid glass" auth scene — a faithful port of the Canva design.
 * Renders the dark radial backdrop (drifting orbs + chevrons, grain, vignette),
 * rising spark particles, and the frosted glass card chrome. The page-specific
 * form is passed as `children` and rendered inside the card content layer.
 *
 * All the "alive" motion (pointer parallax, 3D tilt, cursor-trailing glow,
 * magnetic ripple button) lives in the effect below and targets the [data-lg-*]
 * nodes. The page only has to render its fields + a [data-lg-btn] submit button.
 */

interface LiquidGlassSceneProps {
  children: React.ReactNode;
  /** Called when Enter is pressed anywhere in the scene. */
  onSubmit?: () => void;
}

// left, size(px), bg, shadow, dur(s), delay(s)
const SPARKS: [string, number, string, string, number, number][] = [
  ["9%", 5, "rgba(255,120,110,0.9)", "0 0 8px rgba(234,35,42,0.8)", 13, 0],
  ["21%", 3, "rgba(255,200,190,0.9)", "0 0 6px rgba(255,150,140,0.7)", 17, 2.5],
  ["34%", 4, "rgba(255,140,130,0.9)", "0 0 8px rgba(234,35,42,0.7)", 15, 6],
  ["48%", 6, "rgba(255,110,100,0.85)", "0 0 10px rgba(234,35,42,0.8)", 19, 1.2],
  ["60%", 3, "rgba(255,210,200,0.9)", "0 0 6px rgba(255,160,150,0.7)", 14, 8],
  ["71%", 5, "rgba(255,130,120,0.9)", "0 0 9px rgba(234,35,42,0.75)", 16, 4],
  ["83%", 4, "rgba(255,170,160,0.9)", "0 0 7px rgba(255,140,130,0.7)", 18, 10.5],
  ["92%", 3, "rgba(255,120,110,0.9)", "0 0 6px rgba(234,35,42,0.7)", 12, 5.5],
];

const GRAIN_URI =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

const CHEVRON_CLIP = "polygon(0 0,60% 0,100% 50%,60% 100%,0 100%,40% 50%)";

const SHEEN_DEFAULT =
  "radial-gradient(440px circle at 50% 0%, rgba(255,255,255,0.45), transparent 60%)";

const parWrap: React.CSSProperties = {
  position: "absolute",
  transition: "transform 0.6s cubic-bezier(.2,.8,.2,1)",
};

export default function LiquidGlassScene({
  children,
  onSubmit,
}: LiquidGlassSceneProps) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef(onSubmit);

  useEffect(() => {
    submitRef.current = onSubmit;
  }, [onSubmit]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const touch  = window.matchMedia("(pointer: coarse)").matches;

    const glow = scene.querySelector<HTMLElement>("[data-lg-glow]");
    const card = scene.querySelector<HTMLElement>("[data-lg-card]");
    const sheen = scene.querySelector<HTMLElement>("[data-lg-sheen]");
    const layers = Array.from(
      scene.querySelectorAll<HTMLElement>("[data-lg-par]")
    );
    const btn = scene.querySelector<HTMLElement>("[data-lg-btn]");

    // A backgrounded tab can park the entrance animation at an invisible
    // frame — fast-forward all animations to their end state if so.
    if (document.visibilityState === "hidden") {
      requestAnimationFrame(() => {
        document.getAnimations?.().forEach((a) => {
          // finish() throws InvalidStateError on infinite (looping) animations —
          // only fast-forward ones with a finite end, and stay defensive anyway.
          const end = a.effect?.getComputedTiming().endTime;
          if (typeof end === "number" && Number.isFinite(end)) {
            try {
              a.finish();
            } catch {
              /* playbackRate 0 or other engine quirks — ignore */
            }
          }
        });
      });
    }

    const rect0 = scene.getBoundingClientRect();
    let tx = rect0.width / 2;
    let ty = rect0.height / 2;
    let gx = tx;
    let gy = ty;
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      const r = scene.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      tx = cx;
      ty = cy;
      if (reduce || touch) return;
      const px = cx / r.width - 0.5;
      const py = cy / r.height - 0.5;
      layers.forEach((l, i) => {
        l.style.transform = `translate(${px * (i + 1) * 14}px, ${py * (i + 1) * 14}px)`;
      });
      if (card) {
        card.style.transform = `perspective(1300px) rotateY(${px * 6}deg) rotateX(${-py * 6}deg)`;
      }
      if (sheen) {
        sheen.style.background = `radial-gradient(460px circle at ${(px + 0.5) * 100}% ${(py + 0.5) * 100}%, rgba(255,255,255,0.5), transparent 60%)`;
      }
    };

    const onLeave = () => {
      layers.forEach((l) => {
        l.style.transform = "translate(0,0)";
      });
      if (card) {
        card.style.transform =
          "perspective(1300px) rotateY(0deg) rotateX(0deg)";
      }
      if (sheen) sheen.style.background = SHEEN_DEFAULT;
    };

    scene.addEventListener("pointermove", onMove);
    scene.addEventListener("pointerleave", onLeave);

    // Eased cursor-trailing glow.
    if (!reduce && glow) {
      glow.style.transform = `translate(${gx - 360}px, ${gy - 360}px)`;
      const loop = () => {
        gx += (tx - gx) * 0.07;
        gy += (ty - gy) * 0.07;
        glow.style.transform = `translate(${gx - 360}px, ${gy - 360}px)`;
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    // Magnetic button + click ripple — desktop only (gated on touch so the
    // effects never interfere with taps on mobile).
    const onBtnMove = (e: PointerEvent) => {
      if (reduce || touch || !btn) return;
      const r = btn.getBoundingClientRect();
      const mx = e.clientX - (r.left + r.width / 2);
      const my = e.clientY - (r.top + r.height / 2);
      btn.style.transform = `translate(${mx * 0.12}px, ${my * 0.22}px)`;
    };
    const onBtnLeave = () => {
      if (btn) btn.style.transform = "translate(0,0)";
    };
    const onBtnDown = (e: PointerEvent) => {
      if (touch || !btn) return;
      const r = btn.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 1.1;
      const ripple = document.createElement("span");
      ripple.style.position = "absolute";
      ripple.style.left = `${e.clientX - r.left - size / 2}px`;
      ripple.style.top = `${e.clientY - r.top - size / 2}px`;
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      ripple.style.borderRadius = "50%";
      ripple.style.background = "rgba(255,255,255,0.4)";
      ripple.style.pointerEvents = "none";
      ripple.style.animation = "lgRipple .6s ease-out forwards";
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 650);
    };

    if (btn && !touch) {
      btn.addEventListener("pointermove", onBtnMove);
      btn.addEventListener("pointerleave", onBtnLeave);
      btn.addEventListener("pointerdown", onBtnDown);
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") submitRef.current?.();
    };
    scene.addEventListener("keydown", onKey);

    return () => {
      scene.removeEventListener("pointermove", onMove);
      scene.removeEventListener("pointerleave", onLeave);
      scene.removeEventListener("keydown", onKey);
      if (btn) {
        btn.removeEventListener("pointermove", onBtnMove);
        btn.removeEventListener("pointerleave", onBtnLeave);
        btn.removeEventListener("pointerdown", onBtnDown);
      }
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={sceneRef}
      data-lg-scene
      tabIndex={-1}
      style={{
        position: "relative",
        minHeight: "100vh",
        width: "100%",
        overflow: "hidden",
        background:
          "radial-gradient(120% 120% at 30% 20%, #1b1d22 0%, #121317 45%, #08090b 100%)",
        fontFamily: "var(--font-plex), 'IBM Plex Sans', sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
        outline: "none",
      }}
    >
      {/* Backdrop */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          animation: "lgHue 14s ease-in-out infinite",
        }}
      >
        {/* Cursor-trailing glow */}
        <div
          data-lg-glow
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 720,
            height: 720,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(234,35,42,0.30), rgba(234,35,42,0.10) 38%, transparent 62%)",
            filter: "blur(36px)",
            mixBlendMode: "screen",
            pointerEvents: "none",
            willChange: "transform",
          }}
        />

        {/* Orb 1 */}
        <div data-lg-par style={{ ...parWrap, top: "-10%", left: "8%" }}>
          <div
            style={{
              width: 520,
              height: 520,
              borderRadius: "50%",
              background:
                "radial-gradient(circle at 35% 35%, oklch(0.62 0.23 25), oklch(0.42 0.2 20) 60%, transparent 72%)",
              filter: "blur(70px)",
              opacity: 0.9,
              animation: "lgDrift1 16s ease-in-out infinite",
            }}
          />
        </div>
        {/* Orb 2 */}
        <div data-lg-par style={{ ...parWrap, bottom: "-18%", right: "2%" }}>
          <div
            style={{
              width: 600,
              height: 600,
              borderRadius: "50%",
              background:
                "radial-gradient(circle at 60% 40%, oklch(0.55 0.22 12), oklch(0.34 0.16 18) 58%, transparent 72%)",
              filter: "blur(80px)",
              opacity: 0.85,
              animation: "lgDrift2 20s ease-in-out infinite",
            }}
          />
        </div>
        {/* Orb 3 */}
        <div data-lg-par style={{ ...parWrap, top: "30%", right: "26%" }}>
          <div
            style={{
              width: 360,
              height: 360,
              borderRadius: "50%",
              background:
                "radial-gradient(circle at 50% 50%, oklch(0.30 0.04 260), transparent 70%)",
              filter: "blur(60px)",
              opacity: 0.9,
              animation: "lgDrift3 18s ease-in-out infinite",
            }}
          />
        </div>

        {/* Chevron 1 */}
        <div data-lg-par style={{ ...parWrap, top: "16%", left: "18%" }}>
          <div
            style={{
              width: 340,
              height: 340,
              background: "#EA232A",
              opacity: 0.14,
              filter: "blur(2px)",
              clipPath: CHEVRON_CLIP,
              animation: "lgChev 22s ease-in-out infinite",
            }}
          />
        </div>
        {/* Chevron 2 */}
        <div data-lg-par style={{ ...parWrap, bottom: "12%", left: "30%" }}>
          <div
            style={{
              width: 240,
              height: 240,
              background: "#ffffff",
              opacity: 0.05,
              clipPath: CHEVRON_CLIP,
              animation: "lgChev 26s ease-in-out infinite reverse",
            }}
          />
        </div>

        {/* Grain */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.5,
            mixBlendMode: "overlay",
            backgroundImage: GRAIN_URI,
          }}
        />
        {/* Vignette */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(120% 90% at 50% 50%, transparent 50%, rgba(4,5,7,0.6) 100%)",
          }}
        />
      </div>

      {/* Sparks */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          pointerEvents: "none",
          overflow: "hidden",
        }}
      >
        {SPARKS.map(([left, size, bg, shadow, dur, delay], i) => (
          <span
            key={i}
            style={{
              position: "absolute",
              bottom: -12,
              left,
              width: size,
              height: size,
              borderRadius: "50%",
              background: bg,
              boxShadow: shadow,
              animation: `lgSpark ${dur}s linear infinite`,
              animationDelay: `${delay}s`,
            }}
          />
        ))}
      </div>

      {/* Card */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          animation: "lgEnter 1s cubic-bezier(.16,1,.3,1) both",
        }}
      >
        <div
          data-lg-card
          style={{
            position: "relative",
            width: 430,
            maxWidth: "100%",
            borderRadius: 36,
            padding: "48px 44px 36px",
            overflow: "hidden",
            transition: "transform 0.18s ease-out",
            transformStyle: "flat",
            background:
              "linear-gradient(155deg, rgba(255,255,255,0.80), rgba(255,255,255,0.55))",
            // NOTE: backdrop-filter is NOT on this element. On iOS Safari, a
            // -webkit-backdrop-filter on the element that contains <button>/<a>
            // swallows their taps (inputs still work). The blur lives in a
            // separate behind-layer below (pointer-events:none) so taps reach
            // the buttons. Do not move backdrop-filter back onto data-lg-card.
            border: "1px solid rgba(255,255,255,0.7)",
            boxShadow:
              "0 50px 100px -34px rgba(0,0,0,0.7), 0 12px 30px -12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 0 rgba(0,0,0,0.06)",
          }}
        >
          {/* Frosted-glass blur — separate behind-layer so it does NOT cover
              the buttons. iOS swallows taps on children of a backdrop-filter
              element; keeping it here (pointer-events:none, below content)
              gives the same look while leaving buttons/links tappable. */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 0,
              pointerEvents: "none",
              backdropFilter: "blur(36px) saturate(180%)",
              WebkitBackdropFilter: "blur(36px) saturate(180%)",
            }}
          />
          {/* Cursor specular */}
          <div
            data-lg-sheen
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 0,
              pointerEvents: "none",
              background: SHEEN_DEFAULT,
              mixBlendMode: "screen",
            }}
          />
          {/* Sweep bar */}
          <div
            style={{
              position: "absolute",
              top: "-60%",
              left: 0,
              width: "40%",
              height: "220%",
              pointerEvents: "none",
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)",
              filter: "blur(10px)",
              animation: "lgSweep 7s ease-in-out infinite",
            }}
          />

          {/* Page-specific content — above the blur layer so taps land */}
          <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
        </div>
      </div>
    </div>
  );
}
