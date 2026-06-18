"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth, isAdminRole } from "@/lib/auth";
import {
  apiPendingLeaveRequests,
  apiApproveLeave,
  apiRejectLeave,
  apiMyLeaveRequests,
} from "@/lib/api";
import type { LeaveRequest } from "@/lib/api";
import {
  CheckCircle,
  XCircle,
  Clock,
  Ban,
  AlertCircle,
  Users,
  CheckSquare,
} from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";

const STATUS_META: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  pending:   { label: "Pending",   color: "#D97706", bg: "rgba(217,119,6,0.12)",   icon: Clock },
  approved:  { label: "Approved",  color: "#16A34A", bg: "rgba(22,163,74,0.12)",   icon: CheckCircle },
  rejected:  { label: "Rejected",  color: "#DC2626", bg: "rgba(220,38,38,0.12)",   icon: XCircle },
  cancelled: { label: "Cancelled", color: "#6B7280", bg: "rgba(107,114,128,0.12)", icon: Ban },
};

const LEAVE_COLOR: Record<string, string> = {
  CL: "#E5202E", SL: "#D97706", PL: "#2563EB",
};

function fmtDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function fmtTime(iso: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// ─── Approval queue (HR / Admin / Manager) ───────────────────────────────────

function ApprovalQueue() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState<"pending" | "all">("pending");
  const [allReqs, setAllReqs]   = useState<LeaveRequest[]>([]);
  const [acting, setActing]     = useState<number | null>(null);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [flash, setFlash]       = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const pending = await apiPendingLeaveRequests().catch(() => []);
    setRequests(pending);
    setLoading(false);
  }, []);

  const loadAll = useCallback(async () => {
    const all = await apiMyLeaveRequests().catch(() => []);
    setAllReqs(all);
  }, []);

  useEffect(() => {
    load();
    loadAll();
    const t = setInterval(() => { load(); loadAll(); }, 30000);
    return () => clearInterval(t);
  }, [load, loadAll]);

  async function approve(id: number) {
    setActing(id);
    try {
      await apiApproveLeave(id);
      setFlash("Approved successfully.");
      await load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to approve.";
      setFlash(`Error: ${msg}`);
    } finally {
      setActing(null);
      setTimeout(() => setFlash(""), 3000);
    }
  }

  async function confirmReject() {
    if (!rejectId) return;
    setActing(rejectId);
    try {
      await apiRejectLeave(rejectId, rejectReason);
      setFlash("Request rejected.");
      setRejectId(null);
      setRejectReason("");
      await load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to reject.";
      setFlash(`Error: ${msg}`);
    } finally {
      setActing(null);
      setTimeout(() => setFlash(""), 3000);
    }
  }

  const displayed = tab === "pending" ? requests : allReqs;

  return (
    <div className="space-y-4">
      {/* Flash */}
      {flash && (
        <div
          className="flex items-center gap-2 rounded-xl px-4 py-2.5"
          style={{
            background: flash.startsWith("Error") ? "rgba(220,38,38,0.08)" : "rgba(22,163,74,0.08)",
            border: `1px solid ${flash.startsWith("Error") ? "rgba(220,38,38,0.2)" : "rgba(22,163,74,0.2)"}`,
          }}
        >
          {flash.startsWith("Error")
            ? <AlertCircle size={14} color="#DC2626" />
            : <CheckCircle size={14} color="#16A34A" />}
          <p className="text-sm font-medium" style={{ color: flash.startsWith("Error") ? "#DC2626" : "#16A34A" }}>{flash}</p>
        </div>
      )}

      {/* Tabs + count */}
      <div className="flex items-center gap-3">
        {(["pending", "all"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="relative px-4 py-1.5 rounded-full text-sm font-semibold transition-all duration-150"
            style={
              tab === t
                ? { background: "#E5202E", color: "#fff" }
                : { background: "rgba(255,255,255,0.7)", color: "#5A5A5A", border: "1px solid rgba(0,0,0,0.08)" }
            }
          >
            {t === "pending" ? "Pending" : "All requests"}
            {t === "pending" && requests.length > 0 && (
              <span className="ml-1.5 bg-white text-[#E5202E] text-[10px] font-bold rounded-full px-1.5 py-0.5">
                {requests.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <GlassCard className="overflow-hidden">
        {loading ? (
          <div className="flex items-center gap-2 p-5">
            <div className="w-4 h-4 rounded-full border-2 border-[#E5202E] border-t-transparent animate-spin" />
            <span className="text-[#5A5A5A] text-sm">Loading…</span>
          </div>
        ) : displayed.length === 0 ? (
          <div className="p-8 text-center">
            <CheckSquare size={32} className="mx-auto mb-2 text-[#D0D0D0]" />
            <p className="text-[#6B6B6B] text-sm">
              {tab === "pending" ? "No pending leave requests." : "No requests found."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-black/[0.06]">
            {displayed.map((req) => {
              const sm = STATUS_META[req.status] ?? STATUS_META.pending;
              const Icon = sm.icon;
              const lc = LEAVE_COLOR[req.leave_type] ?? "#6B7280";
              return (
                <div key={req.id} className="flex items-start gap-3 p-4">
                  {/* Leave type badge */}
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: `${lc}14` }}
                  >
                    <span className="text-xs font-bold" style={{ color: lc }}>{req.leave_type}</span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[#1A1A1A] text-sm font-semibold">
                        {req.employee_name ?? req.emp_code}
                      </span>
                      <span className="text-[#6B6B6B] text-xs">{req.emp_code}</span>
                    </div>
                    <p className="text-[#5A5A5A] text-xs mt-0.5">
                      {fmtDate(req.from_date)} — {fmtDate(req.to_date)} · <span className="font-semibold text-[#1A1A1A]">{req.days} day{req.days !== 1 ? "s" : ""}</span>
                    </p>
                    {req.reason && (
                      <p className="text-[#6B6B6B] text-[11px] mt-1 leading-relaxed">{req.reason}</p>
                    )}
                    <p className="text-[#B0B0B0] text-[10px] mt-1">Applied {fmtTime(req.created_at ?? "")}</p>
                  </div>

                  {/* Status / Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {req.status === "pending" ? (
                      <>
                        <button
                          disabled={acting === req.id}
                          onClick={() => approve(req.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all duration-150 disabled:opacity-50"
                          style={{ background: "#16A34A" }}
                        >
                          <CheckCircle size={12} />
                          Approve
                        </button>
                        <button
                          disabled={acting === req.id}
                          onClick={() => { setRejectId(req.id); setRejectReason(""); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 disabled:opacity-50"
                          style={{ background: "rgba(220,38,38,0.10)", color: "#DC2626", border: "1px solid rgba(220,38,38,0.20)" }}
                        >
                          <XCircle size={12} />
                          Reject
                        </button>
                      </>
                    ) : (
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ background: sm.bg }}>
                        <Icon size={11} color={sm.color} />
                        <span className="text-[11px] font-semibold" style={{ color: sm.color }}>{sm.label}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* Reject modal */}
      {rejectId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)" }}>
          <GlassCard className="w-full max-w-sm p-5">
            <h3 className="text-[#1A1A1A] font-semibold text-base mb-1">Reject leave request</h3>
            <p className="text-[#5A5A5A] text-sm mb-4">Optionally provide a reason to the employee.</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="Reason for rejection…"
              className="w-full rounded-xl border border-black/10 bg-white/60 text-[#1A1A1A] text-sm px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-red-400/40 placeholder:text-[#B0B0B0]"
            />
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setRejectId(null)}
                className="flex-1 py-2 rounded-xl text-sm font-semibold text-[#5A5A5A] transition"
                style={{ background: "rgba(0,0,0,0.06)" }}
              >
                Cancel
              </button>
              <button
                onClick={confirmReject}
                disabled={acting !== null}
                className="flex-1 py-2 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50"
                style={{ background: "#DC2626" }}
              >
                {acting !== null ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </GlassCard>
        </div>
      )}
    </div>
  );
}

// ─── Employee view — their own requests ──────────────────────────────────────

function MyRequestsView() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    const fetch = () =>
      apiMyLeaveRequests()
        .then(setRequests)
        .catch(() => setRequests([]))
        .finally(() => setLoading(false));
    fetch();
    const t = setInterval(fetch, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <GlassCard className="overflow-hidden">
      <div className="p-4 border-b border-black/[0.06]">
        <p className="text-[#1A1A1A] font-semibold text-sm">My leave requests</p>
        <p className="text-[#5A5A5A] text-xs mt-0.5">Track the status of your leave applications</p>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 p-5">
          <div className="w-4 h-4 rounded-full border-2 border-[#E5202E] border-t-transparent animate-spin" />
          <span className="text-[#5A5A5A] text-sm">Loading…</span>
        </div>
      ) : requests.length === 0 ? (
        <p className="text-[#6B6B6B] text-sm p-8 text-center">No leave requests yet.</p>
      ) : (
        <div className="divide-y divide-black/[0.06]">
          {requests.map((req) => {
            const sm = STATUS_META[req.status] ?? STATUS_META.pending;
            const Icon = sm.icon;
            const lc = LEAVE_COLOR[req.leave_type] ?? "#6B7280";
            return (
              <div key={req.id} className="flex items-center gap-3 p-4">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${lc}14` }}>
                  <span className="text-xs font-bold" style={{ color: lc }}>{req.leave_type}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[#1A1A1A] text-sm font-semibold">
                    {fmtDate(req.from_date)} — {fmtDate(req.to_date)}
                  </p>
                  <p className="text-[#5A5A5A] text-xs mt-0.5">{req.days} day{req.days !== 1 ? "s" : ""}{req.reason ? ` · ${req.reason}` : ""}</p>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full shrink-0" style={{ background: sm.bg }}>
                  <Icon size={11} color={sm.color} />
                  <span className="text-[11px] font-semibold" style={{ color: sm.color }}>{sm.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  const { user } = useAuth();
  if (!user) return null;

  const isAdmin = isAdminRole(user);
  const canApprove = isAdmin;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-white font-semibold text-xl">Approvals</h1>
          <p className="text-white/50 text-sm mt-0.5">
            {canApprove
              ? "Review and action leave requests from your team"
              : "Track your leave request status"}
          </p>
        </div>
        {canApprove && (
          <div className="flex items-center gap-2 rounded-xl px-3 py-1.5" style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.15)" }}>
            <Users size={13} color="rgba(255,255,255,0.7)" />
            <span className="text-white/70 text-xs font-medium capitalize">{user.role.replace("_", " ")}</span>
          </div>
        )}
      </div>

      {canApprove ? <ApprovalQueue /> : <MyRequestsView />}
    </div>
  );
}
