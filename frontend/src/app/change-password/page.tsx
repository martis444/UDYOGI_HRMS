"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import LiquidGlassScene from "@/components/auth/LiquidGlassScene";
import { apiChangePassword } from "@/lib/api";

type Status = "idle" | "loading" | "success";

function validate(pw: string): string[] {
  const errs: string[] = [];
  if (pw.length < 8) errs.push("At least 8 characters");
  if (!/\d/.test(pw)) errs.push("At least one digit");
  if (!/[A-Z]/.test(pw)) errs.push("At least one uppercase letter");
  return errs;
}

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-saira)",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "#54585E",
  display: "block",
  marginBottom: 9,
};

const inputBase: React.CSSProperties = {
  width: "100%",
  padding: "14px 66px 14px 16px",
  border: "1px solid rgba(255,255,255,0.85)",
  borderRadius: 14,
  fontFamily: "var(--font-plex)",
  fontSize: 15,
  color: "#15171B",
  background: "rgba(255,255,255,0.5)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  outline: "none",
  transition: "transform .18s ease, box-shadow .18s ease, border-color .18s ease",
  boxShadow:
    "inset 0 1px 2px rgba(255,255,255,0.7), inset 0 -1px 2px rgba(0,0,0,0.04), 0 2px 6px -2px rgba(0,0,0,0.06)",
};

const INPUT_REST_SHADOW = inputBase.boxShadow as string;

function applyFocus(el: HTMLInputElement) {
  el.style.borderColor = "rgba(234,35,42,0.7)";
  el.style.transform = "translateY(-1px)";
  el.style.boxShadow =
    "0 0 0 4px rgba(234,35,42,0.16), inset 0 1px 2px rgba(255,255,255,0.7), 0 8px 18px -8px rgba(234,35,42,0.4)";
}
function applyBlur(el: HTMLInputElement) {
  el.style.borderColor = "rgba(255,255,255,0.85)";
  el.style.transform = "translateY(0)";
  el.style.boxShadow = INPUT_REST_SHADOW;
}

const BTN_SHADOW =
  "0 14px 30px -8px rgba(234,35,42,0.6), inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -2px 5px rgba(0,0,0,0.18)";
const BTN_SHADOW_HOVER =
  "0 22px 44px -8px rgba(234,35,42,0.72), inset 0 1px 0 rgba(255,255,255,0.55)";

// Module-level so it isn't re-created each render (which would drop input focus).
function PasswordField({
  label,
  value,
  onChange,
  show,
  onToggle,
  autoComplete,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  autoComplete: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <div style={{ position: "relative" }}>
        <input
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder ?? "••••••••"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={inputBase}
          onFocus={(e) => applyFocus(e.currentTarget)}
          onBlur={(e) => applyBlur(e.currentTarget)}
        />
        <button
          type="button"
          onClick={onToggle}
          tabIndex={-1}
          style={{
            position: "absolute",
            right: 9,
            top: 24,
            transform: "translateY(-50%)",
            background: "rgba(255,255,255,0.6)",
            border: "1px solid rgba(255,255,255,0.8)",
            borderRadius: 9,
            cursor: "pointer",
            fontFamily: "var(--font-saira)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#C71D23",
            padding: "7px 10px",
          }}
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

export default function ChangePasswordPage() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  const validationErrors = validate(next);
  const mismatch = !!confirm && next !== confirm;

  async function submit() {
    if (status !== "idle") return;
    if (!current) {
      setError("Current password is required.");
      return;
    }
    if (validationErrors.length > 0) {
      setError(validationErrors[0]);
      return;
    }
    if (next !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      await apiChangePassword(current, next, confirm);
      const raw = localStorage.getItem("user");
      if (raw) {
        const user = JSON.parse(raw);
        user.is_first_login = false;
        localStorage.setItem("user", JSON.stringify(user));
      }
      setStatus("success");
      setTimeout(() => router.replace("/dashboard"), 700);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail || "Failed to change password.";
      setStatus("idle");
      setError(msg);
    }
  }

  return (
    <LiquidGlassScene onSubmit={submit}>
      {/* Logo */}
      <div style={{ animation: "lgReveal 0.7s cubic-bezier(.16,1,.3,1) both", animationDelay: "0.15s" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/udyogi-logo.png"
          alt="Udyogi"
          style={{
            height: 46,
            width: "auto",
            display: "block",
            margin: "0 0 30px",
            filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.12))",
          }}
        />
      </div>

      {/* Heading */}
      <div style={{ animation: "lgReveal 0.7s cubic-bezier(.16,1,.3,1) both", animationDelay: "0.24s" }}>
        <h2
          style={{
            fontFamily: "var(--font-saira)",
            fontWeight: 700,
            fontSize: 25,
            margin: "0 0 6px",
            letterSpacing: "-0.01em",
            color: "#15171B",
          }}
        >
          Set new password
        </h2>
        <p style={{ margin: "0 0 28px", color: "#54585E", fontSize: 14 }}>
          Your account requires a password update before you can continue.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ animation: "lgReveal 0.7s cubic-bezier(.16,1,.3,1) both", animationDelay: "0.33s" }}>
          <PasswordField
            label="Current password"
            value={current}
            onChange={setCurrent}
            show={showCurrent}
            onToggle={() => setShowCurrent((s) => !s)}
            autoComplete="current-password"
          />
        </div>

        <div style={{ animation: "lgReveal 0.7s cubic-bezier(.16,1,.3,1) both", animationDelay: "0.42s" }}>
          <PasswordField
            label="New password"
            value={next}
            onChange={setNext}
            show={showNext}
            onToggle={() => setShowNext((s) => !s)}
            autoComplete="new-password"
            placeholder="Min 8 chars, 1 uppercase, 1 digit"
          />
          {next && validationErrors.length > 0 && (
            <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
              {validationErrors.map((e) => (
                <li key={e} style={{ fontSize: 12, color: "#C71D23", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#C71D23", flexShrink: 0, display: "inline-block" }} />
                  {e}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ animation: "lgReveal 0.7s cubic-bezier(.16,1,.3,1) both", animationDelay: "0.5s" }}>
          <label style={labelStyle}>Confirm new password</label>
          <input
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            style={{
              ...inputBase,
              padding: "14px 16px",
              borderColor: mismatch ? "rgba(199,29,35,0.6)" : "rgba(255,255,255,0.85)",
            }}
            onFocus={(e) => applyFocus(e.currentTarget)}
            onBlur={(e) => {
              applyBlur(e.currentTarget);
              if (mismatch) e.currentTarget.style.borderColor = "rgba(199,29,35,0.6)";
            }}
          />
          {mismatch && (
            <p style={{ fontSize: 12, color: "#C71D23", margin: "6px 0 0" }}>Passwords do not match</p>
          )}
        </div>

        {error && (
          <p style={{ color: "#C71D23", fontSize: 13, margin: 0 }}>{error}</p>
        )}

        <div style={{ animation: "lgReveal 0.7s cubic-bezier(.16,1,.3,1) both", animationDelay: "0.58s", marginTop: 6 }}>
          <button
            data-lg-btn
            onClick={submit}
            style={{
              width: "100%",
              padding: 15,
              border: "none",
              borderRadius: 15,
              cursor: status === "loading" ? "default" : "pointer",
              fontFamily: "var(--font-saira)",
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#fff",
              background: "linear-gradient(180deg, #F2393F, #D41C22)",
              boxShadow: BTN_SHADOW,
              transition: "box-shadow .18s ease, transform .22s cubic-bezier(.2,.8,.2,1)",
              position: "relative",
              overflow: "hidden",
              minHeight: 51,
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.boxShadow = BTN_SHADOW_HOVER;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = BTN_SHADOW;
            }}
          >
            {status === "loading" ? (
              <span style={{ display: "flex", alignItems: "center", gap: 11, position: "relative", zIndex: 1 }}>
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    border: "2px solid rgba(255,255,255,0.4)",
                    borderTopColor: "#fff",
                    animation: "lgSpin .7s linear infinite",
                    display: "inline-block",
                  }}
                />
                Updating
              </span>
            ) : status === "success" ? (
              <span style={{ display: "flex", alignItems: "center", gap: 9, position: "relative", zIndex: 1 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                Updated
              </span>
            ) : (
              <span style={{ position: "relative", zIndex: 1 }}>Update Password</span>
            )}
          </button>
        </div>
      </div>
    </LiquidGlassScene>
  );
}
