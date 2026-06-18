"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import {
  apiGetLeaveBalance,
  apiApplyLeave,
  apiMyLeaveRequests,
  apiCancelLeave,
} from "@/lib/api";
import type { LeaveBalanceResponse, LeaveRequest } from "@/lib/api";
import { CalendarDays, CheckCircle, XCircle, Clock, Ban, AlertCircle } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";

const LEAVE_TYPES = [
  { value: "CL", label: "Casual Leave",  color: "#E5202E" },
  { value: "SL", label: "Sick Leave",    color: "#D97706" },
  { value: "PL", label: "Earned Leave",  color: "#2563EB" },
];

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  pending:   { label: "Pending",   color: "#D97706", bg: "rgba(217,119,6,0.12)",   icon: Clock },
  approved:  { label: "Approved",  color: "#16A34A", bg: "rgba(22,163,74,0.12)",   icon: CheckCircle },
  rejected:  { label: "Rejected",  color: "#DC2626", bg: "rgba(220,38,38,0.12)",   icon: XCircle },
  cancelled: { label: "Cancelled", color: "#6B7280", bg: "rgba(107,114,128,0.12)", icon: Ban },
};

function workingDays(from: string, to: string): number {
  if (!from || !to) return 0;
  const start = new Date(from);
  const end   = new Date(to);
  if (end < start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    if (cur.getDay() !== 0) count++; // exclude Sunday
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function fmtDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function LeavePage() {
  const { user } = useAuth();

  const [balances, setBalances]     = useState<LeaveBalanceResponse | null>(null);
  const [requests, setRequests]     = useState<LeaveRequest[]>([]);
  const [loading, setLoading]       = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState("");
  const [success, setSuccess]       = useState("");

  const [leaveType, setLeaveType] = useState("CL");
  const [fromDate, setFromDate]   = useState("");
  const [toDate, setToDate]       = useState("");
  const [reason, setReason]       = useState("");

  const days = workingDays(fromDate, toDate);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [bal, reqs] = await Promise.all([
      apiGetLeaveBalance(user.emp_code).catch(() => null),
      apiMyLeaveRequests().catch(() => []),
    ]);
    setBalances(bal);
    setRequests(reqs);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  async function handleApply(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!fromDate || !toDate) { setError("Please select both dates."); return; }
    if (days <= 0) { setError("End date must be on or after start date."); return; }
    setSubmitting(true);
    try {
      await apiApplyLeave({ leave_type: leaveType, from_date: fromDate, to_date: toDate, reason });
      setSuccess(`Leave application submitted for ${days} working day${days > 1 ? "s" : ""}.`);
      setFromDate(""); setToDate(""); setReason("");
      await load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to submit leave request.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(id: number) {
    try {
      await apiCancelLeave(id);
      await load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Could not cancel request.";
      setError(msg);
    }
  }

  const today = new Date().toISOString().split("T")[0];
  const meta = balances?._meta;
  const isWorker = meta?.category === "worker";
  const isOnProbation = meta?.is_on_probation ?? false;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-white font-semibold text-xl">Leave</h1>
        <p className="text-white/50 text-sm mt-0.5">Apply for leave and track your requests</p>
      </div>

      {(isWorker || isOnProbation) && (
        <GlassCard className="p-4 flex items-center gap-3">
          <AlertCircle size={18} color="#D97706" />
          <p className="text-[#1A1A1A] text-sm">
            {isWorker
              ? "Leave entitlements do not apply to worker-category employees."
              : "Leave accrual has not started yet — you are still on probation."}
          </p>
        </GlassCard>
      )}

      {!isWorker && !isOnProbation && (
        <>
          {/* Balance chips */}
          {balances && (
            <div className="flex gap-3 flex-wrap">
              {LEAVE_TYPES.map(({ value, label, color }) => {
                const entry = balances[value as "CL" | "SL" | "PL"];
                const bal = entry ? Math.floor(entry.balance) : "—";
                return (
                  <div
                    key={value}
                    className="flex items-center gap-2 rounded-xl px-3 py-1.5"
                    style={{ background: `${color}14`, border: `1px solid ${color}30` }}
                  >
                    <span className="text-xs font-bold" style={{ color }}>{value}</span>
                    <span className="text-[#1A1A1A] text-sm font-semibold">{bal}</span>
                    <span className="text-[#5A5A5A] text-xs">days</span>
                    <span className="text-[#6B6B6B] text-[10px] hidden sm:inline">{label}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Apply form */}
          <GlassCard className="p-5">
            <h2 className="text-[#1A1A1A] font-semibold text-sm mb-4 flex items-center gap-2">
              <CalendarDays size={16} color="#E5202E" /> Apply for leave
            </h2>

            <form onSubmit={handleApply} className="space-y-4">
              {/* Leave type */}
              <div>
                <label className="block text-[#5A5A5A] text-xs font-medium mb-1.5">Leave type</label>
                <div className="flex gap-2 flex-wrap">
                  {LEAVE_TYPES.map(({ value, label, color }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setLeaveType(value)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150"
                      style={
                        leaveType === value
                          ? { background: color, color: "#fff", border: `1.5px solid ${color}` }
                          : { background: "rgba(0,0,0,0.04)", color: "#5A5A5A", border: "1.5px solid rgba(0,0,0,0.10)" }
                      }
                    >
                      {value} — {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#5A5A5A] text-xs font-medium mb-1.5">From</label>
                  <input
                    type="date"
                    value={fromDate}
                    min={today}
                    onChange={(e) => { setFromDate(e.target.value); if (!toDate || e.target.value > toDate) setToDate(e.target.value); }}
                    className="w-full rounded-xl border border-black/10 bg-white/60 text-[#1A1A1A] text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#E5202E]/40"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[#5A5A5A] text-xs font-medium mb-1.5">To</label>
                  <input
                    type="date"
                    value={toDate}
                    min={fromDate || today}
                    onChange={(e) => setToDate(e.target.value)}
                    className="w-full rounded-xl border border-black/10 bg-white/60 text-[#1A1A1A] text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#E5202E]/40"
                    required
                  />
                </div>
              </div>

              {/* Days preview */}
              {fromDate && toDate && days > 0 && (
                <div
                  className="flex items-center gap-2 rounded-xl px-3 py-2"
                  style={{ background: "rgba(37,99,235,0.07)", border: "1px solid rgba(37,99,235,0.15)" }}
                >
                  <CalendarDays size={13} color="#2563EB" />
                  <span className="text-xs text-[#5A5A5A]">
                    <span className="font-semibold text-[#1A1A1A]">{days}</span> working day{days > 1 ? "s" : ""} (Mon–Sat)
                  </span>
                </div>
              )}

              {/* Reason */}
              <div>
                <label className="block text-[#5A5A5A] text-xs font-medium mb-1.5">Reason <span className="text-[#6B6B6B]">(optional)</span></label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  placeholder="Brief reason for leave…"
                  className="w-full rounded-xl border border-black/10 bg-white/60 text-[#1A1A1A] text-sm px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-[#E5202E]/40 placeholder:text-[#B0B0B0]"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.20)" }}>
                  <AlertCircle size={13} color="#DC2626" />
                  <p className="text-xs text-[#DC2626]">{error}</p>
                </div>
              )}

              {success && (
                <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "rgba(22,163,74,0.08)", border: "1px solid rgba(22,163,74,0.20)" }}>
                  <CheckCircle size={13} color="#16A34A" />
                  <p className="text-xs text-[#16A34A]">{success}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || days <= 0}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-150 disabled:opacity-50"
                style={{ background: submitting ? "#6B6B6B" : "#E5202E" }}
              >
                {submitting ? "Submitting…" : `Apply for ${days > 0 ? days : "—"} day${days !== 1 ? "s" : ""}`}
              </button>
            </form>
          </GlassCard>
        </>
      )}

      {/* My request history */}
      <GlassCard className="p-5">
        <h2 className="text-[#1A1A1A] font-semibold text-sm mb-4">My leave requests</h2>

        {loading ? (
          <div className="flex items-center gap-2 py-4">
            <div className="w-4 h-4 rounded-full border-2 border-[#E5202E] border-t-transparent animate-spin" />
            <span className="text-[#5A5A5A] text-sm">Loading…</span>
          </div>
        ) : requests.length === 0 ? (
          <p className="text-[#6B6B6B] text-sm py-4 text-center">No leave requests yet.</p>
        ) : (
          <div className="space-y-2">
            {requests.map((req) => {
              const sm = STATUS_META[req.status] ?? STATUS_META.pending;
              const Icon = sm.icon;
              return (
                <div
                  key={req.id}
                  className="flex items-center gap-3 p-3 rounded-xl"
                  style={{ background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.06)" }}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: sm.bg }}
                  >
                    <Icon size={14} color={sm.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[#1A1A1A] text-sm font-semibold">{req.leave_type}</span>
                      <span className="text-[#5A5A5A] text-xs">·</span>
                      <span className="text-[#5A5A5A] text-xs">{req.days} day{req.days !== 1 ? "s" : ""}</span>
                    </div>
                    <p className="text-[#5A5A5A] text-xs mt-0.5">
                      {fmtDate(req.from_date)} — {fmtDate(req.to_date)}
                    </p>
                    {req.reason && <p className="text-[#6B6B6B] text-[11px] mt-0.5 truncate">{req.reason}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: sm.bg, color: sm.color }}
                    >
                      {sm.label}
                    </span>
                    {req.status === "pending" && (
                      <button
                        onClick={() => handleCancel(req.id)}
                        className="text-[11px] text-[#6B6B6B] hover:text-[#DC2626] transition-colors px-2 py-0.5 rounded-lg hover:bg-red-50"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
