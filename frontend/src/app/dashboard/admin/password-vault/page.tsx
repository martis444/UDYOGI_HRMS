"use client";

import { useEffect, useState } from "react";
import GlassCard from "@/components/ui/GlassCard";
import { useAuth, hasRole } from "@/lib/auth";
import { apiGetEmployees, apiResetPassword } from "@/lib/api";
import { KeyRound, AlertTriangle, Search, Copy, Check, X } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmpOption {
  emp_code: string;
  name: string;
  entity_id: string;
  designation?: string;
  status?: string;
}

// ─── Glass card ───────────────────────────────────────────────────────────────


// ─── Temp password modal ──────────────────────────────────────────────────────

function TempPasswordModal({
  empCode,
  empName,
  tempPassword,
  onClose,
}: {
  empCode: string;
  empName: string;
  tempPassword: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(tempPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" style={{ backdropFilter: "blur(4px)" }} onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 border border-[#E2E2DF]">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#F4F4F2] text-[#5A5A5A] transition"
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-[#16A34A]/10 flex items-center justify-center shrink-0">
            <KeyRound size={20} className="text-[#16A34A]" />
          </div>
          <div>
            <h2 className="text-[#1A1A1A] font-semibold text-base leading-tight">Password reset</h2>
            <p className="text-[#5A5A5A] text-xs mt-0.5">{empName} · {empCode}</p>
          </div>
        </div>

        <div className="bg-[#F4F4F2] rounded-xl p-4 mb-4">
          <p className="text-[#5A5A5A] text-[10px] font-semibold uppercase tracking-widest mb-2">
            Temporary password
          </p>
          <div className="flex items-center gap-2">
            <span className="flex-1 font-mono text-xl font-bold text-[#1A1A1A] tracking-wider break-all">
              {tempPassword}
            </span>
            <button
              onClick={copy}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition min-h-[40px] shrink-0 ${
                copied
                  ? "bg-[#16A34A] text-white"
                  : "bg-[#E5202E] text-white hover:bg-[#C81824]"
              }`}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div
          className="rounded-xl px-4 py-3 mb-5"
          style={{ background: "rgba(217,119,6,0.07)", border: "1px solid rgba(217,119,6,0.22)" }}
        >
          <p className="text-xs leading-relaxed" style={{ color: "#92400E" }}>
            Share this password with the employee through a secure channel. They will be forced to change it on first login. This password will not be shown again.
          </p>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl border border-[#E2E2DF] text-[#1A1A1A] text-sm font-medium hover:bg-[#F4F4F2] transition"
        >
          Done
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PasswordVaultPage() {
  const { user } = useAuth();

  const [search, setSearch] = useState("");
  const [empOptions, setEmpOptions] = useState<EmpOption[]>([]);
  const [dropOpen, setDropOpen] = useState(false);
  const [empLoading, setEmpLoading] = useState(false);
  const [selected, setSelected] = useState<EmpOption | null>(null);

  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ empCode: string; empName: string; tempPassword: string } | null>(null);

  // Debounced employee search
  useEffect(() => {
    if (search.trim().length < 1) {
      setEmpOptions([]);
      return;
    }
    const t = setTimeout(async () => {
      setEmpLoading(true);
      try {
        const data = await apiGetEmployees({ search: search.trim(), per_page: "20", status: "active" });
        setEmpOptions(data.items ?? []);
      } catch {
        setEmpOptions([]);
      } finally {
        setEmpLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const handleReset = async () => {
    if (!selected) return;
    setResetting(true);
    setResetError(null);
    try {
      const data = await apiResetPassword(selected.emp_code);
      setModal({ empCode: selected.emp_code, empName: selected.name, tempPassword: data.temp_password });
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setResetError(msg ?? "Failed to reset password. Please try again.");
    } finally {
      setResetting(false);
    }
  };

  const clearSelection = () => {
    setSelected(null);
    setSearch("");
    setResetError(null);
  };

  if (!user) return null;

  if (!hasRole(user, "super_admin", "entity_admin")) {
    return (
      <div className="p-6 text-center text-[#5A5A5A] text-sm">
        Access restricted to super admin and entity admin.
      </div>
    );
  }

  const displayValue = selected
    ? `${selected.name} (${selected.emp_code})`
    : search;

  return (
    <>
      {modal && (
        <TempPasswordModal
          empCode={modal.empCode}
          empName={modal.empName}
          tempPassword={modal.tempPassword}
          onClose={() => { setModal(null); clearSelection(); }}
        />
      )}

      <div className="p-4 sm:p-6 space-y-5 max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#E5202E]/10 flex items-center justify-center shrink-0">
            <KeyRound size={18} className="text-[#E5202E]" />
          </div>
          <div>
            <h1 className="text-white font-semibold text-xl leading-tight">Password vault</h1>
            <p className="text-white/50 text-xs mt-0.5">Reset employee login passwords</p>
          </div>
        </div>

        {/* Warning banner */}
        <div
          className="flex items-start gap-3 rounded-2xl px-4 py-3"
          style={{ background: "rgba(217,119,6,0.07)", border: "1px solid rgba(217,119,6,0.22)" }}
        >
          <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: "#D97706" }} />
          <p className="text-sm leading-snug" style={{ color: "#92400E" }}>
            Password resets are logged in the audit trail. The employee must change their password on next login.
            Only share temporary passwords through a secure channel — they are not stored after this screen.
          </p>
        </div>

        {/* Reset card */}
        <GlassCard className="p-5 space-y-4">
          <h2 className="text-[#1A1A1A] font-semibold text-sm">Find employee</h2>

          {/* Employee search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B6B6B] pointer-events-none" />
            <input
              value={displayValue}
              onChange={(e) => { setSearch(e.target.value); setSelected(null); setDropOpen(true); setResetError(null); }}
              onFocus={() => setDropOpen(true)}
              onBlur={() => setTimeout(() => setDropOpen(false), 150)}
              placeholder="Search by name or employee code…"
              className="w-full bg-white border border-[#E2E2DF] rounded-xl pl-9 pr-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#6B6B6B] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 min-h-[44px]"
            />
            {dropOpen && (empOptions.length > 0 || empLoading) && (
              <div className="absolute z-20 mt-1 w-full bg-white border border-[#E2E2DF] rounded-xl shadow-lg max-h-52 overflow-y-auto">
                {empLoading ? (
                  <div className="p-3 text-[#5A5A5A] text-sm flex items-center gap-2">
                    <div className="w-3 h-3 border-2 border-[#E5202E] border-t-transparent rounded-full animate-spin" />
                    Loading…
                  </div>
                ) : (
                  empOptions.map((e) => (
                    <button
                      key={e.emp_code}
                      onMouseDown={() => { setSelected(e); setSearch(""); setDropOpen(false); setResetError(null); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-[#1A1A1A] hover:bg-[#F4F4F2] flex items-center gap-2 min-h-[44px]"
                    >
                      <span className="font-mono text-xs bg-[#F4F4F2] px-1.5 py-0.5 rounded font-bold shrink-0">
                        {e.emp_code}
                      </span>
                      <span className="flex-1">{e.name}</span>
                      <span className="text-[10px] text-[#6B6B6B] shrink-0">{e.entity_id}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Selected employee card */}
          {selected && (
            <div className="flex items-center gap-3 bg-[#F4F4F2] rounded-xl px-4 py-3">
              <div className="w-9 h-9 rounded-full bg-[#E5202E]/10 border border-[#E5202E]/20 flex items-center justify-center text-[#E5202E] font-bold text-sm shrink-0">
                {selected.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[#1A1A1A] font-semibold text-sm truncate">{selected.name}</p>
                <p className="text-[#5A5A5A] text-xs">{selected.emp_code} · {selected.entity_id}</p>
              </div>
              <button
                onClick={clearSelection}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white text-[#5A5A5A] transition shrink-0"
              >
                <X size={13} />
              </button>
            </div>
          )}

          {/* Error */}
          {resetError && (
            <div
              className="rounded-xl px-4 py-3"
              style={{ background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.20)" }}
            >
              <p className="text-sm text-[#DC2626]">{resetError}</p>
            </div>
          )}

          {/* Action */}
          <button
            onClick={handleReset}
            disabled={!selected || resetting}
            className="w-full py-3 rounded-xl bg-[#E5202E] text-white font-semibold text-sm hover:bg-[#C81824] transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
          >
            {resetting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Resetting…
              </span>
            ) : "Reset password"}
          </button>
        </GlassCard>

        {/* Info card */}
        <GlassCard className="p-5">
          <h3 className="text-[#1A1A1A] font-semibold text-sm mb-3">How this works</h3>
          <ol className="space-y-2">
            {[
              "Search for and select the employee whose password needs resetting.",
              "Click Reset password — a temporary password is generated and logged to the audit trail.",
              "Copy the temporary password and share it securely with the employee.",
              "The employee must change their password on their next login.",
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3 text-xs text-[#5A5A5A] leading-snug">
                <span className="w-5 h-5 rounded-full bg-[#E5202E]/10 text-[#E5202E] font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </GlassCard>
      </div>
    </>
  );
}
