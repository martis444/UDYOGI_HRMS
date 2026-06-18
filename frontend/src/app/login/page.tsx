"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import LiquidGlassScene from "@/components/auth/LiquidGlassScene";
import { apiLogin, storeTokens } from "@/lib/api";
import { APP_META } from "@/lib/appMeta";

type Status = "idle" | "loading" | "success" | "error";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
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
  padding: "14px 16px",
  border: "1px solid rgba(255,255,255,0.85)",
  borderRadius: 14,
  fontFamily: "var(--font-plex)",
  fontSize: 15,
  color: "#15171B",
  background: "rgba(255,255,255,0.72)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  outline: "none",
  marginBottom: 18,
  transition: "transform .18s ease, box-shadow .18s ease, border-color .18s ease",
  boxShadow:
    "inset 0 1px 2px rgba(255,255,255,0.7), inset 0 -1px 2px rgba(0,0,0,0.04), 0 2px 6px -2px rgba(0,0,0,0.06)",
};

const INPUT_REST_SHADOW = inputBase.boxShadow as string;

function applyFocus(el: HTMLInputElement) {
  el.style.borderColor = "rgba(229,32,46,0.7)";
  el.style.transform = "translateY(-1px)";
  el.style.boxShadow =
    "0 0 0 4px rgba(229,32,46,0.16), inset 0 1px 2px rgba(255,255,255,0.7), 0 8px 18px -8px rgba(229,32,46,0.4)";
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

export default function LoginPage() {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [empId, setEmpId] = useState("");
  const [pwd, setPwd] = useState("");
  const [caps, setCaps] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function submit() {
    if (status !== "idle") return;
    if (!empId.trim() || !pwd) {
      setError("Employee code and password are required.");
      return;
    }
    setStatus("loading");
    setError("");
    try {
      const data = await apiLogin(empId.trim().toUpperCase(), pwd);
      storeTokens(data);
      if (data.is_first_login || data.force_reset) {
        setStatus("idle");
        router.push("/change-password");
      } else {
        setStatus("success");
        setTimeout(() => router.push("/dashboard"), 700);
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail || "Invalid credentials. Please try again.";
      setStatus("idle");
      setError(msg);
    }
  }

  return (
    <LiquidGlassScene onSubmit={submit}>
      {/* Logo (only /udyogi-logo.png exists — see PROGRESS.md note) */}
      <div style={{ animation: "lgReveal 0.7s cubic-bezier(.16,1,.3,1) both", animationDelay: "0.15s" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/udyogi-logo.png"
          alt="Udyogi"
          style={{
            height: 120,
            width: "auto",
            display: "block",
            margin: "0 0 28px",
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
          Employee Sign In
        </h2>
        <p style={{ margin: "0 0 28px", color: "#54585E", fontSize: 16 }}>
          {greeting()} — sign in to your Udyogi HRMS account.
        </p>
      </div>

      {/* Employee ID */}
      <div style={{ animation: "lgReveal 0.7s cubic-bezier(.16,1,.3,1) both", animationDelay: "0.33s" }}>
        <label htmlFor="login-emp-id" style={labelStyle}>Employee ID</label>
        <input
          id="login-emp-id"
          type="text"
          autoComplete="username"
          autoFocus
          placeholder="e.g. UP000001"
          value={empId}
          onChange={(e) => setEmpId(e.target.value)}
          style={inputBase}
          onFocus={(e) => applyFocus(e.currentTarget)}
          onBlur={(e) => applyBlur(e.currentTarget)}
        />
      </div>

      {/* Password */}
      <div style={{ animation: "lgReveal 0.7s cubic-bezier(.16,1,.3,1) both", animationDelay: "0.42s" }}>
        <label htmlFor="login-password" style={labelStyle}>Password</label>
        <div style={{ position: "relative", marginBottom: 6 }}>
          <input
            id="login-password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Enter password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))}
            onKeyDown={(e) => setCaps(e.getModifierState("CapsLock"))}
            style={{ ...inputBase, padding: "14px 66px 14px 16px", marginBottom: 0 }}
            onFocus={(e) => applyFocus(e.currentTarget)}
            onBlur={(e) => applyBlur(e.currentTarget)}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            tabIndex={-1}
            aria-label={show ? "Hide password" : "Show password"}
            aria-pressed={show}
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
        {/* Caps lock row */}
        <div style={{ minHeight: 20, marginBottom: 12 }}>
          {caps && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "#C71D23",
                animation: "lgCaps 0.2s ease both",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#C71D23",
                  display: "inline-block",
                }}
              />
              Caps Lock is on
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <p role="alert" style={{ color: "#C71D23", fontSize: 13, margin: "0 0 14px", animation: "lgCaps 0.2s ease both" }}>{error}</p>
      )}

      {/* Submit */}
      <div style={{ marginTop: 14, animation: "lgReveal 0.7s cubic-bezier(.16,1,.3,1) both", animationDelay: "0.5s" }}>
        <button
          data-lg-btn
          onClick={submit}
          style={{
            width: "100%",
            padding: 15,
            border: "none",
            borderRadius: 15,
            cursor: status === "loading" ? "default" : "pointer",
            pointerEvents: status === "idle" ? undefined : "none",
            fontFamily: "var(--font-saira)",
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "#fff",
            background: "linear-gradient(180deg, #F2393F, #D41C22)",
            boxShadow: BTN_SHADOW,
            transition:
              "box-shadow .18s ease, transform .22s cubic-bezier(.2,.8,.2,1)",
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
          onFocus={(e) => {
            e.currentTarget.style.boxShadow = BTN_SHADOW_HOVER;
          }}
          onBlur={(e) => {
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
              Verifying
            </span>
          ) : status === "success" ? (
            <span style={{ display: "flex", alignItems: "center", gap: 9, position: "relative", zIndex: 1 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              Welcome back
            </span>
          ) : (
            <span style={{ position: "relative", zIndex: 1 }}>Sign In</span>
          )}
        </button>
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: 28,
          paddingTop: 20,
          borderTop: "1px solid rgba(21,23,27,0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          animation: "lgReveal 0.7s cubic-bezier(.16,1,.3,1) both",
          animationDelay: "0.66s",
        }}
      >
        <span style={{ width: 18, height: 2, background: "#E5202E" }} />
        <span
          style={{
            fontFamily: "var(--font-saira)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "#15171B",
          }}
        >
          Life Is Precious
        </span>
        <span style={{ width: 18, height: 2, background: "#E5202E" }} />
      </div>

      {/* Development credit + copyright */}
      <div
        style={{
          marginTop: 16,
          textAlign: "center",
          animation: "lgReveal 0.7s cubic-bezier(.16,1,.3,1) both",
          animationDelay: "0.72s",
        }}
      >
        <p style={{ margin: 0, fontFamily: "var(--font-plex)", fontSize: 11.5, color: "#3E4248" }}>
          Developed by {APP_META.developer}
        </p>
        <p style={{ margin: "3px 0 0", fontFamily: "var(--font-plex)", fontSize: 11.5, color: "#4A4E54" }}>
          © {new Date().getFullYear()} {APP_META.copyrightHolder}
        </p>
      </div>
    </LiquidGlassScene>
  );
}
