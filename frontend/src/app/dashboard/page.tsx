"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth, isAdminRole, isEmployee } from "@/lib/auth";
import { useEntityStore, ENTITIES } from "@/store/entity";
import {
  apiGetEmployees,
  apiGetLeaveBalance,
  apiApplyLeave,
  apiPendingLeaveCount,
  apiGetTodayAttendance,
  apiPunch,
  apiMyLeaveRequests,
} from "@/lib/api";
import type { LeaveBalanceResponse, TodayAttendance, LeaveRequest } from "@/lib/api";
import {
  Users,
  FileText,
  Clock,
  TrendingUp,
  AlertCircle,
  ChevronRight,
  CalendarDays,
  LogIn,
  LogOut,
  Timer,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import GlassCard from "@/components/ui/GlassCard";

// ─── Constants ────────────────────────────────────────────────────────────────

const ENTITY_META = [
  { id: "UPPL",  name: "UPPL",  color: "#E5202E" },
  { id: "USAPL", name: "USAPL", color: "#0D9488" },
  { id: "UAPL",  name: "UAPL",  color: "#16A34A" },
  { id: "UMPL",  name: "UMPL",  color: "#2563EB" },
];

const QUICK_ACTIONS = [
  { label: "My payslips", href: "/dashboard/payslips",   icon: FileText,    color: "#E5202E" },
  { label: "Attendance",  href: "/dashboard/attendance",  icon: Clock,       color: "#2563EB" },
  { label: "Approvals",   href: "/dashboard/approvals",   icon: AlertCircle, color: "#D97706" },
];

const ADMIN_ACTIONS = [
  { label: "Employees",   href: "/dashboard/employees",   icon: Users,       color: "#E5202E" },
  { label: "Payroll",     href: "/dashboard/payroll",     icon: TrendingUp,  color: "#16A34A" },
  { label: "Audit log",   href: "/dashboard/audit",       icon: AlertCircle, color: "#6B7280" },
];

// Plain employees: only their own payslips. (Leave apply is the inline card above.)
const EMPLOYEE_ACTIONS = [
  { label: "My payslips", href: "/dashboard/payslips",   icon: FileText,    color: "#E5202E" },
];

const LEAVE_TYPES = [
  { value: "CL", label: "Casual",  color: "#E5202E" },
  { value: "SL", label: "Sick",    color: "#D97706" },
  { value: "PL", label: "Earned",  color: "#2563EB" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function workingDays(from: string, to: string): number {
  if (!from || !to) return 0;
  const start = new Date(from);
  const end   = new Date(to);
  if (end < start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    if (cur.getDay() !== 0) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// ─── Punch card ───────────────────────────────────────────────────────────────

function fmt12(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

function elapsed(first_in: string): string {
  const diff = Math.floor((Date.now() - new Date(first_in).getTime()) / 1000);
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function PunchCard() {
  const [att, setAtt]           = useState<TodayAttendance | null>(null);
  const [loading, setLoading]   = useState(true);
  const [punching, setPunching] = useState(false);
  const [punchError, setPunchError] = useState("");
  const [tick, setTick]         = useState(0);

  const LOCK_MS = 5 * 60 * 1000; // 5 minutes

  useEffect(() => {
    apiGetTodayAttendance().then(setAtt).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // tick every 10s — drives elapsed time display and lock countdown
  useEffect(() => {
    if (!att?.punched_in || att?.punched_out) return;
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, [att?.punched_in, att?.punched_out]);

  async function handlePunch() {
    setPunching(true);
    setPunchError("");
    try {
      const res = await apiPunch();
      setAtt(res);
    } catch {
      setPunchError("Failed to record punch. Please try again.");
    } finally {
      setPunching(false);
    }
  }

  const isIn  = att?.punched_in ?? false;
  const isOut = att?.punched_out ?? false;

  // 5-minute cooldown after punch-in before punch-out is allowed
  const lockExpiry    = att?.first_in ? new Date(att.first_in).getTime() + LOCK_MS : 0;
  const lockRemainMs  = Math.max(0, lockExpiry - Date.now());
  const isLocked      = isIn && !isOut && lockRemainMs > 0;
  const lockMins      = Math.floor(lockRemainMs / 60_000);
  const lockSecs      = Math.floor((lockRemainMs % 60_000) / 1000);
  const lockLabel     = lockMins > 0 ? `${lockMins}m ${lockSecs}s` : `${lockSecs}s`;

  return (
    <GlassCard className="p-5">
      <h2 className="text-[#1A1A1A] font-semibold text-sm mb-4 flex items-center gap-2">
        <Clock size={15} color="#E5202E" /> Today&apos;s attendance
      </h2>

      {loading ? (
        <div className="flex items-center gap-2 text-[#6B6B6B] text-sm">
          <div className="w-3.5 h-3.5 rounded-full border-2 border-[#E5202E] border-t-transparent animate-spin" />
          Checking status…
        </div>
      ) : (
        <div className="space-y-4">
          {/* Status row */}
          <div className="flex items-center gap-4 flex-wrap">
            {/* Punch-in time */}
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: isIn ? "rgba(22,163,74,0.10)" : "rgba(0,0,0,0.05)" }}>
                <LogIn size={13} color={isIn ? "#16A34A" : "#B0B0B0"} />
              </div>
              <div>
                <p className="text-[#6B6B6B] text-[10px] uppercase tracking-wide">In</p>
                <p className={`text-sm font-semibold ${isIn ? "text-[#1A1A1A]" : "text-[#C0C0C0]"}`}>
                  {isIn ? fmt12(att!.first_in) : "—"}
                </p>
              </div>
            </div>

            {/* Divider */}
            <div className="h-8 w-px bg-black/10" />

            {/* Punch-out time */}
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: isOut ? "rgba(229,32,46,0.10)" : "rgba(0,0,0,0.05)" }}>
                <LogOut size={13} color={isOut ? "#E5202E" : "#B0B0B0"} />
              </div>
              <div>
                <p className="text-[#6B6B6B] text-[10px] uppercase tracking-wide">Out</p>
                <p className={`text-sm font-semibold ${isOut ? "text-[#1A1A1A]" : "text-[#C0C0C0]"}`}>
                  {isOut ? fmt12(att!.last_out) : "—"}
                </p>
              </div>
            </div>

            {/* Elapsed / hours */}
            {isIn && (
              <>
                <div className="h-8 w-px bg-black/10" />
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(37,99,235,0.10)" }}>
                    <Timer size={13} color="#2563EB" />
                  </div>
                  <div>
                    <p className="text-[#6B6B6B] text-[10px] uppercase tracking-wide">
                      {isOut ? "Hours" : "Working"}
                    </p>
                    <p className="text-[#1A1A1A] text-sm font-semibold">
                      {isOut
                        ? `${att!.hours_worked?.toFixed(1) ?? "—"}h`
                        : elapsed(att!.first_in!)}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Error */}
          {punchError && (
            <p className="text-xs text-[#DC2626] font-medium">{punchError}</p>
          )}

          {/* Action button */}
          {!isOut ? (
            <button
              onClick={handlePunch}
              disabled={punching || isLocked}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-150 disabled:opacity-60 active:scale-95"
              style={{ background: isLocked ? "#6B6B6B" : isIn ? "#E5202E" : "#16A34A" }}
            >
              {isIn ? <LogOut size={15} /> : <LogIn size={15} />}
              {punching
                ? "Recording…"
                : isLocked
                ? `Punch out in ${lockLabel}`
                : isIn
                ? "Punch out"
                : "Punch in"}
            </button>
          ) : (
            <p className="text-[#6B6B6B] text-xs">
              Attendance recorded for today.
            </p>
          )}
        </div>
      )}
    </GlassCard>
  );
}

// ─── Leave apply card (employee self-service) ─────────────────────────────────

function LeaveApplyCard({ empCode, onApplied }: { empCode: string; onApplied?: () => void }) {
  const [balances, setBalances]     = useState<LeaveBalanceResponse | null>(null);
  const [leaveType, setLeaveType]   = useState("CL");
  const [fromDate, setFromDate]     = useState("");
  const [toDate, setToDate]         = useState("");
  const [reason, setReason]         = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus]         = useState<{ ok: boolean; msg: string } | null>(null);

  const today = new Date().toISOString().split("T")[0];
  const days  = workingDays(fromDate, toDate);

  const load = useCallback(() => {
    apiGetLeaveBalance(empCode).then(setBalances).catch(() => {});
  }, [empCode]);

  useEffect(() => { load(); }, [load]);

  const meta        = balances?._meta;
  const isWorker    = meta?.category === "worker";
  const isOnProbation = meta?.is_on_probation ?? false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    if (days <= 0) { setStatus({ ok: false, msg: "End date must be on or after start date." }); return; }
    setSubmitting(true);
    try {
      await apiApplyLeave({ leave_type: leaveType, from_date: fromDate, to_date: toDate, reason });
      setStatus({ ok: true, msg: `Applied for ${days} working day${days > 1 ? "s" : ""}. Awaiting approval.` });
      setFromDate(""); setToDate(""); setReason("");
      load();
      onApplied?.();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to submit.";
      setStatus({ ok: false, msg });
    } finally {
      setSubmitting(false);
    }
  }

  if (isWorker || isOnProbation) {
    return (
      <GlassCard className="p-5">
        <h2 className="text-[#1A1A1A] font-semibold text-sm mb-3 flex items-center gap-2">
          <CalendarDays size={15} color="#E5202E" /> Apply leave
        </h2>
        <p className="text-[#6B6B6B] text-sm">
          {isWorker
            ? "Leave entitlements do not apply to worker-category employees."
            : "Leave accrual begins after your probation ends."}
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="p-5">
      <h2 className="text-[#1A1A1A] font-semibold text-sm mb-4 flex items-center gap-2">
        <CalendarDays size={15} color="#E5202E" /> Apply leave
      </h2>

      {/* Balance chips */}
      {balances && (
        <div className="flex gap-2 mb-4 flex-wrap">
          {LEAVE_TYPES.map(({ value, color }) => {
            const entry = balances[value as "CL" | "SL" | "PL"];
            const bal   = entry ? Math.floor(entry.balance) : 0;
            const isSelected = leaveType === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setLeaveType(value)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all duration-150"
                style={
                  isSelected
                    ? { background: color, color: "#fff", border: `1.5px solid ${color}` }
                    : { background: `${color}12`, color, border: `1.5px solid ${color}30` }
                }
              >
                {value}
                <span className={`font-bold ${isSelected ? "text-white" : "text-[#1A1A1A]"}`}>{bal}</span>
                <span className={`${isSelected ? "text-white/70" : "text-[#6B6B6B]"}`}>days</span>
              </button>
            );
          })}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Dates */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[#5A5A5A] text-[11px] font-medium mb-1">From</label>
            <input
              type="date"
              value={fromDate}
              min={today}
              onChange={(e) => { setFromDate(e.target.value); if (!toDate || e.target.value > toDate) setToDate(e.target.value); }}
              required
              className="w-full rounded-xl border border-black/10 bg-white/60 text-[#1A1A1A] text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#E5202E]/30"
            />
          </div>
          <div>
            <label className="block text-[#5A5A5A] text-[11px] font-medium mb-1">To</label>
            <input
              type="date"
              value={toDate}
              min={fromDate || today}
              onChange={(e) => setToDate(e.target.value)}
              required
              className="w-full rounded-xl border border-black/10 bg-white/60 text-[#1A1A1A] text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#E5202E]/30"
            />
          </div>
        </div>

        {/* Days preview */}
        {days > 0 && (
          <p className="text-xs text-[#5A5A5A]">
            <span className="font-semibold text-[#1A1A1A]">{days}</span> working day{days > 1 ? "s" : ""} (Mon–Sat)
          </p>
        )}

        {/* Reason */}
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          className="w-full rounded-xl border border-black/10 bg-white/60 text-[#1A1A1A] text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#E5202E]/30 placeholder:text-[#B0B0B0]"
        />

        {/* Feedback */}
        {status && (
          <p className="text-xs font-medium px-3 py-2 rounded-xl"
            style={{
              background: status.ok ? "rgba(22,163,74,0.08)" : "rgba(220,38,38,0.08)",
              color: status.ok ? "#16A34A" : "#DC2626",
              border: `1px solid ${status.ok ? "rgba(22,163,74,0.2)" : "rgba(220,38,38,0.2)"}`,
            }}
          >
            {status.msg}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || days <= 0}
          className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all duration-150 disabled:opacity-50"
          style={{ background: "#E5202E" }}
        >
          {submitting ? "Submitting…" : `Submit ${days > 0 ? `(${days}d)` : ""}`}
        </button>
      </form>
    </GlassCard>
  );
}

// ─── My leave requests (status tracker) ───────────────────────────────────────

const LEAVE_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: "Pending",   color: "#D97706", bg: "rgba(217,119,6,0.12)" },
  approved:  { label: "Approved",  color: "#16A34A", bg: "rgba(22,163,74,0.12)" },
  rejected:  { label: "Rejected",  color: "#DC2626", bg: "rgba(220,38,38,0.12)" },
  cancelled: { label: "Cancelled", color: "#6B7280", bg: "rgba(107,114,128,0.12)" },
};

const LEAVE_TYPE_COLOR: Record<string, string> = {
  CL: "#E5202E", SL: "#D97706", PL: "#2563EB",
};

function fmtLeaveDate(iso: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function MyLeaveRequestsCard({ refreshKey }: { refreshKey: number }) {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    let alive = true;
    const fetchReqs = () =>
      apiMyLeaveRequests()
        .then((d) => { if (alive) setRequests(d); })
        .catch(() => { if (alive) setRequests([]); })
        .finally(() => { if (alive) setLoading(false); });
    fetchReqs();
    const t = setInterval(fetchReqs, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [refreshKey]);

  return (
    <GlassCard className="p-5">
      <h2 className="text-[#1A1A1A] font-semibold text-sm mb-4 flex items-center gap-2">
        <CalendarDays size={15} color="#E5202E" /> My leave requests
      </h2>

      {loading ? (
        <div className="flex items-center gap-2 py-3">
          <div className="w-4 h-4 rounded-full border-2 border-[#E5202E] border-t-transparent animate-spin" />
          <span className="text-[#5A5A5A] text-sm">Loading…</span>
        </div>
      ) : requests.length === 0 ? (
        <p className="text-[#6B6B6B] text-sm py-2">No leave requests yet.</p>
      ) : (
        <div className="divide-y divide-black/[0.06]">
          {requests.map((r) => {
            const sm = LEAVE_STATUS_META[r.status] ?? LEAVE_STATUS_META.pending;
            const lc = LEAVE_TYPE_COLOR[r.leave_type] ?? "#6B7280";
            return (
              <div key={r.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${lc}14` }}>
                  <span className="text-xs font-bold" style={{ color: lc }}>{r.leave_type}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[#1A1A1A] text-sm font-semibold">
                    {fmtLeaveDate(r.from_date)} — {fmtLeaveDate(r.to_date)}
                  </p>
                  <p className="text-[#5A5A5A] text-xs mt-0.5">
                    {r.days} day{r.days !== 1 ? "s" : ""}{r.reason ? ` · ${r.reason}` : ""}
                  </p>
                </div>
                <span className="text-[11px] font-semibold px-2 py-1 rounded-full shrink-0" style={{ background: sm.bg, color: sm.color }}>
                  {sm.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuth();
  const { selected } = useEntityStore();
  const [counts, setCounts]               = useState<Record<string, number>>({});
  const [pendingLeaves, setPendingLeaves] = useState(0);
  const [leaveRefresh, setLeaveRefresh]   = useState(0);
  // Defer the chart one tick so ResponsiveContainer measures a laid-out parent
  // (avoids the recharts width(-1)/height(-1) first-render warning).
  const [chartReady, setChartReady]       = useState(false);
  useEffect(() => { setChartReady(true); }, []);

  const isAdmin    = isAdminRole(user);
  const employee   = isEmployee(user);
  const canApprove = isAdmin;

  useEffect(() => {
    if (!isAdmin) return;
    Promise.all(
      ENTITY_META.map((e) =>
        apiGetEmployees({ entity_id: e.id, per_page: "1" })
          .then((d) => ({ id: e.id, total: d.total ?? 0 }))
          .catch(() => ({ id: e.id, total: 0 }))
      )
    ).then((results) => {
      const map: Record<string, number> = {};
      results.forEach(({ id, total }) => { map[id] = total; });
      setCounts(map);
    });
  }, [isAdmin]);

  useEffect(() => {
    if (!canApprove) return;
    apiPendingLeaveCount().then((d) => setPendingLeaves(d.count)).catch(() => {});
    const t = setInterval(() => {
      apiPendingLeaveCount().then((d) => setPendingLeaves(d.count)).catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, [canApprove]);

  if (!user) return null;

  const entityLabel = selected === "ALL"
    ? "All entities"
    : ENTITIES.find((e) => e.id === selected)?.label ?? selected;

  const allChartData = ENTITY_META.map((e) => ({ ...e, count: counts[e.id] ?? 0 }));
  const chartData    = selected === "ALL" ? allChartData : allChartData.filter((e) => e.id === selected);
  const totalCount   = selected === "ALL"
    ? allChartData.reduce((s, e) => s + e.count, 0)
    : (counts[selected] ?? 0);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-6xl mx-auto">
      {/* Greeting */}
      <div>
        <h1 className="text-white font-semibold text-xl">
          Good day, {user.name.split(" ")[0]}
        </h1>
        <p className="text-white/50 text-sm mt-0.5">
          {entityLabel} · {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <GlassCard hover className="p-4 rise-in delay-1">
          <p className="text-[#5A5A5A] text-xs mb-2">Status</p>
          <span className="inline-flex items-center gap-1.5 bg-[#16A34A]/10 text-[#16A34A] text-xs font-semibold px-2 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
            Active
          </span>
          <p className="text-[#1A1A1A] font-semibold text-sm mt-2">{user.emp_code}</p>
        </GlassCard>

        {isAdmin ? (
          <>
            <GlassCard hover className="p-4 rise-in delay-3">
              <p className="text-[#5A5A5A] text-xs mb-2">
                {selected === "ALL" ? "Total employees" : `${entityLabel} employees`}
              </p>
              <p className="text-[#1A1A1A] font-bold text-2xl">{totalCount}</p>
              <p className="text-[#5A5A5A] text-xs mt-1">active headcount</p>
            </GlassCard>
            <a href="/dashboard/approvals">
              <GlassCard hover className="p-4 rise-in delay-4">
                <p className="text-[#5A5A5A] text-xs mb-2">Pending approvals</p>
                <p className="text-[#1A1A1A] font-bold text-2xl">{pendingLeaves}</p>
                <p className="text-[#5A5A5A] text-xs mt-1">
                  {pendingLeaves === 0 ? "all clear" : "awaiting action"}
                </p>
              </GlassCard>
            </a>
          </>
        ) : employee ? null : (
          <>
            <GlassCard hover className="p-4 rise-in delay-3">
              <p className="text-[#5A5A5A] text-xs mb-2">Pending</p>
              <p className="text-[#1A1A1A] font-bold text-2xl">0</p>
              <p className="text-[#5A5A5A] text-xs mt-1">approvals</p>
            </GlassCard>
            <GlassCard hover className="p-4 rise-in delay-4">
              <p className="text-[#5A5A5A] text-xs mb-2">Attendance</p>
              <p className="text-[#1A1A1A] font-bold text-lg">—</p>
              <p className="text-[#5A5A5A] text-xs mt-1">this month</p>
            </GlassCard>
          </>
        )}
      </div>

      {/* Admin: headcount chart */}
      {isAdmin && (
        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[#1A1A1A] font-semibold text-sm">
              {selected === "ALL" ? "Entity headcount" : `${entityLabel} headcount`}
            </h2>
            <span className="text-[#5A5A5A] text-xs">Total: {totalCount} employees</span>
          </div>
          <div className="h-44">
            {chartReady && (
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <BarChart data={chartData} barSize={32} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#5A5A5A" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#5A5A5A" }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: "rgba(0,0,0,0.04)" }}
                  contentStyle={{ borderRadius: 8, border: "1px solid #E2E2DF", fontSize: 12 }}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry) => (
                    <Cell key={entry.id} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
        </GlassCard>
      )}

      {/* Leave apply + status */}
      <LeaveApplyCard empCode={user.emp_code} onApplied={() => setLeaveRefresh((k) => k + 1)} />
      <MyLeaveRequestsCard refreshKey={leaveRefresh} />

      {/* Quick actions */}
      <div>
        <h2 className="text-white font-semibold text-sm mb-3">Quick actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {(isAdmin ? ADMIN_ACTIONS : employee ? EMPLOYEE_ACTIONS : QUICK_ACTIONS).map((action, i) => {
            const Icon = action.icon;
            return (
              <a key={action.href} href={action.href} className="group">
                <GlassCard hover className={`p-4 rise-in delay-${(i % 5) + 1}`}>
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center mb-3 transition-transform duration-200 group-hover:scale-110"
                    style={{ backgroundColor: `${action.color}15` }}
                  >
                    <Icon size={18} style={{ color: action.color }} />
                  </div>
                  <p className="text-[#1A1A1A] text-sm font-medium leading-tight">{action.label}</p>
                  <ChevronRight size={14} className="text-[#5A5A5A] mt-1 group-hover:translate-x-1 transition-transform duration-200" />
                </GlassCard>
              </a>
            );
          })}
        </div>
      </div>

      {/* Notices */}
      <GlassCard className="p-5">
        <h2 className="text-[#1A1A1A] font-semibold text-sm mb-3">Latest notices</h2>
        <div className="space-y-3">
          {[
            { title: "Payroll for May 2026 processed", date: "Jun 1, 2026", tag: "Payroll" },
            { title: "Office closed — National Holiday", date: "May 26, 2026", tag: "Holiday" },
          ].map((notice) => (
            <div key={notice.title} className="flex items-start gap-3 py-2 border-b border-[#E2E2DF] last:border-0">
              <span className="text-[10px] font-semibold bg-[#E5202E]/10 text-[#E5202E] px-2 py-0.5 rounded-full shrink-0 mt-0.5">
                {notice.tag}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[#1A1A1A] text-sm">{notice.title}</p>
                <p className="text-[#5A5A5A] text-xs mt-0.5">{notice.date}</p>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
