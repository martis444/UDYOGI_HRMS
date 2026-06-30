"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import GlassCard from "@/components/ui/GlassCard";
import { SkeletonRows } from "@/components/ui/Skeleton";
import SalaryHistoryTable from "@/components/salary/SalaryHistoryTable";
import IncrementModal from "@/components/salary/IncrementModal";
import { useAuth, isAdminRole } from "@/lib/auth";
import { ENTITIES } from "@/store/entity";
import { entityColor } from "@/lib/entities";
import {
  apiGetPayrollMonths, apiProcessMonth, apiLockPayroll, apiUnlockPayroll,
  apiGetEmployees, apiGetSalaryHistory,
  apiDownloadBulkPayslips, apiDownloadSalarySheet,
  apiEmailPayslipsPreview, apiEmailPayslipsSend,
  type PayrollMonthRow, type SalaryStructureRow, type EmailPayslipsPreview,
} from "@/lib/api";
import {
  Lock, Unlock, Play, Loader2, AlertCircle, CheckCircle2,
  TrendingUp, History, Search, Wallet, FileText, Sheet, Upload, Mail, Send,
} from "lucide-react";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const CURRENT_YEAR = new Date().getFullYear();
const START_YEAR = 2023;
const REAL_ENTITIES = ENTITIES.filter((e) => e.id !== "ALL");

const INPUT = "w-full bg-white border border-[#E2E2DF] rounded-xl px-3 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 placeholder:text-[#6B6B6B]";
const SELECT = `${INPUT} appearance-none cursor-pointer`;

function money(n: number) {
  return `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}
function monthLabel(m: number, y: number) {
  return `${MONTHS[m - 1]} ${y}`;
}
function fmtLockedAt(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  locked:    { bg: "rgba(229,32,46,0.10)",  fg: "#E5202E", label: "Locked" },
  processed: { bg: "rgba(22,163,74,0.10)",  fg: "#16A34A", label: "Processed" },
  draft:     { bg: "rgba(217,119,6,0.12)",  fg: "#D97706", label: "Draft" },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.draft;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{ background: s.bg, color: s.fg }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.fg }} />
      {s.label}
    </span>
  );
}

// ─── Page shell (Suspense for useSearchParams) ────────────────────────────────

export default function PayrollPage() {
  return (
    <Suspense fallback={null}>
      <PayrollConsole />
    </Suspense>
  );
}

function PayrollConsole() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const isAdmin = isAdminRole(user);
  const isSuperAdmin = user?.role === "super_admin";

  const [view, setView] = useState<"run" | "structures">(
    searchParams.get("emp") ? "structures" : "run"
  );

  // Toast
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const showToast = useCallback((kind: "ok" | "err", msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 4000);
  }, []);

  if (!user) return null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-white font-semibold text-xl">Payroll</h1>
        <p className="text-white/50 text-sm mt-0.5">Run monthly payroll and manage salary structures</p>
      </div>

      {/* Segmented control */}
      <div className="inline-flex p-1 rounded-xl bg-white/70 border border-white/55">
        {([["run", "Monthly Run"], ["structures", "Salary Structures"]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setView(k)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              view === k ? "bg-[#E5202E] text-white shadow-sm" : "text-[#5A5A5A] hover:text-[#1A1A1A]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "run"
        ? <MonthlyRun user={user} isSuperAdmin={isSuperAdmin} isAdmin={isAdmin} showToast={showToast} />
        : <SalaryStructures user={user} isAdmin={isAdmin} showToast={showToast} initialEmp={searchParams.get("emp") ?? ""} />}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 flex items-start gap-2 px-4 py-3 rounded-xl shadow-2xl text-sm max-w-sm ${
          toast.kind === "ok" ? "bg-[#16A34A] text-white" : "bg-[#DC2626] text-white"
        }`}>
          {toast.kind === "ok" ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" /> : <AlertCircle size={16} className="shrink-0 mt-0.5" />}
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}

// ─── SUB-VIEW 1: Monthly Run ──────────────────────────────────────────────────

type Importable = { user: NonNullable<ReturnType<typeof useAuth>["user"]>; showToast: (k: "ok" | "err", m: string) => void };

function MonthlyRun({ user, isSuperAdmin, isAdmin, showToast }: Importable & { isSuperAdmin: boolean; isAdmin: boolean }) {
  const [entityFilter, setEntityFilter] = useState<string>(isSuperAdmin ? "ALL" : user.entity_id);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [rows, setRows] = useState<PayrollMonthRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string>("");
  const [dlKey, setDlKey] = useState<string>("");

  // "Run a new month" controls
  const [newEntity, setNewEntity] = useState<string>(isSuperAdmin ? "UPPL" : user.entity_id);
  const [newMonth, setNewMonth] = useState<number>(new Date().getMonth() + 1);

  // Modals
  const [confirm, setConfirm] = useState<null | { kind: "process" | "lock"; row: { entity_id: string; year: number; month: number } }>(null);
  const [unlockRow, setUnlockRow] = useState<null | { entity_id: string; year: number; month: number }>(null);
  const [emailRow, setEmailRow] = useState<null | { entity_id: string; year: number; month: number; status: string }>(null);
  const [processErrors, setProcessErrors] = useState<{ emp_code: string; error: string }[] | null>(null);

  const yearOptions = useMemo(() => {
    const ys: number[] = [];
    for (let y = CURRENT_YEAR; y >= START_YEAR; y--) ys.push(y);
    return ys;
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const entity_id = isSuperAdmin ? (entityFilter !== "ALL" ? entityFilter : undefined) : undefined;
    apiGetPayrollMonths({ entity_id, year })
      .then((d) => setRows(d.months))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [isSuperAdmin, entityFilter, year]);

  useEffect(() => { load(); }, [load]);

  const rowKey = (r: { entity_id: string; year: number; month: number }) => `${r.entity_id}-${r.year}-${r.month}`;

  const doProcess = async (r: { entity_id: string; year: number; month: number }) => {
    setBusyKey(rowKey(r));
    setProcessErrors(null);
    try {
      const res = await apiProcessMonth({ entity_id: r.entity_id, year: r.year, month: r.month });
      showToast(res.errors.length ? "err" : "ok", `${res.processed} processed, ${res.errors.length} error${res.errors.length === 1 ? "" : "s"}`);
      if (res.errors.length) setProcessErrors(res.errors);
      load();
    } catch (e: unknown) {
      showToast("err", errMsg(e, "Process failed"));
    } finally {
      setBusyKey("");
    }
  };

  const doLock = async (r: { entity_id: string; year: number; month: number }) => {
    setBusyKey(rowKey(r));
    try {
      const res = await apiLockPayroll({ entity_id: r.entity_id, year: r.year, month: r.month });
      showToast("ok", `Locked — ${res.locked_count} payslip${res.locked_count === 1 ? "" : "s"}`);
      load();
    } catch (e: unknown) {
      showToast("err", errMsg(e, "Lock failed"));
    } finally {
      setBusyKey("");
    }
  };

  const doDownload = async (
    kind: "payslips" | "sheet",
    r: { entity_id: string; year: number; month: number },
  ) => {
    const key = `${rowKey(r)}-${kind}`;
    setDlKey(key);
    try {
      if (kind === "payslips") await apiDownloadBulkPayslips(r.entity_id, r.year, r.month);
      else await apiDownloadSalarySheet(r.entity_id, r.year, r.month);
    } catch (e: unknown) {
      showToast("err", errMsg(e, "Download failed"));
    } finally {
      setDlKey("");
    }
  };

  const showEntityCol = isSuperAdmin && entityFilter === "ALL";

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        {isSuperAdmin ? (
          <div className="flex gap-2 flex-wrap">
            {ENTITIES.map(({ id }) => {
              const sel = entityFilter === id;
              const fill = id === "ALL" ? "#1A1A1A" : entityColor(id);
              return (
                <button
                  key={id}
                  onClick={() => setEntityFilter(id)}
                  className="px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all"
                  style={
                    sel
                      ? { background: fill, color: "#fff" }
                      : { background: "rgba(255,255,255,0.6)", color: "#5A5A5A" }
                  }
                >
                  {id}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-white/80 text-[#1A1A1A]">{user.entity_id}</span>
        )}
        <select value={year} onChange={(e) => setYear(parseInt(e.target.value))} className={`${SELECT} max-w-[120px] py-2`}>
          {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Run a new month */}
      <GlassCard className="p-4">
        <p className="text-[#1A1A1A] font-semibold text-sm mb-3">Run a new month</p>
        <div className="flex items-end gap-3 flex-wrap">
          {isSuperAdmin && (
            <div>
              <label className="block text-xs font-semibold text-[#5A5A5A] mb-1.5">Entity</label>
              <select value={newEntity} onChange={(e) => setNewEntity(e.target.value)} className={`${SELECT} max-w-[140px] py-2`}>
                {REAL_ENTITIES.map((e) => <option key={e.id} value={e.id}>{e.id}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-[#5A5A5A] mb-1.5">Month</label>
            <select value={newMonth} onChange={(e) => setNewMonth(parseInt(e.target.value))} className={`${SELECT} max-w-[150px] py-2`}>
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <button
            onClick={() => setConfirm({ kind: "process", row: { entity_id: isSuperAdmin ? newEntity : user.entity_id, year, month: newMonth } })}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition font-semibold min-h-[42px]"
          >
            <Play size={14} /> Process {MONTHS[newMonth - 1]} {year}
          </button>
        </div>
      </GlassCard>

      {/* Status table */}
      <GlassCard className="overflow-hidden">
        {loading ? (
          <div className="p-5"><SkeletonRows rows={5} cols={6} /></div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-[#5A5A5A] text-sm">No payroll runs for this selection yet.</p>
            <button
              onClick={() => setConfirm({ kind: "process", row: { entity_id: isSuperAdmin ? newEntity : user.entity_id, year, month: new Date().getMonth() + 1 } })}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition font-semibold"
            >
              <Play size={14} /> Process this month
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/[0.07] text-[#6B6B6B] text-[11px] uppercase tracking-wide">
                  {showEntityCol && <th className="text-left px-4 py-3 pl-5">Entity</th>}
                  <th className="text-left px-4 py-3 first:pl-5">Month</th>
                  <th className="text-right px-4 py-3">Employees</th>
                  <th className="text-right px-4 py-3">Gross</th>
                  <th className="text-right px-4 py-3">Net</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3 pr-5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05]">
                {rows.map((r) => {
                  const k = rowKey(r);
                  const busy = busyKey === k;
                  const lockedSub = r.status === "locked" ? fmtLockedAt(r.locked_at) : null;
                  return (
                    <tr key={k} className="hover:bg-black/[0.02]">
                      {showEntityCol && <td className="px-4 py-3.5 pl-5 font-semibold text-[#1A1A1A]">{r.entity_id}</td>}
                      <td className="px-4 py-3.5 first:pl-5 text-[#1A1A1A] font-medium">{monthLabel(r.month, r.year)}</td>
                      <td className="px-4 py-3.5 text-right text-[#1A1A1A]">{r.employee_count}</td>
                      <td className="px-4 py-3.5 text-right text-[#1A1A1A]">{money(r.total_gross)}</td>
                      <td className="px-4 py-3.5 text-right text-[#1A1A1A] font-semibold">{money(r.total_net)}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col gap-0.5">
                          <StatusPill status={r.status} />
                          {lockedSub && <span className="text-[10px] text-[#6B6B6B]">locked {lockedSub}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 pr-5">
                        <div className="flex items-center justify-end gap-2">
                          {(r.status === "processed" || r.status === "locked") && (
                            <>
                              <button
                                onClick={() => doDownload("payslips", r)}
                                disabled={dlKey === `${rowKey(r)}-payslips`}
                                title="Download all payslips as one PDF"
                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-white border border-[#E2E2DF] text-[#1A1A1A] hover:bg-[#F4F4F2] rounded-lg transition font-medium disabled:opacity-60"
                              >
                                {dlKey === `${rowKey(r)}-payslips` ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} Payslips
                              </button>
                              <button
                                onClick={() => doDownload("sheet", r)}
                                disabled={dlKey === `${rowKey(r)}-sheet`}
                                title="Download salary sheet (Excel .xlsx)"
                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-white border border-[#E2E2DF] text-[#1A1A1A] hover:bg-[#F4F4F2] rounded-lg transition font-medium disabled:opacity-60"
                              >
                                {dlKey === `${rowKey(r)}-sheet` ? <Loader2 size={12} className="animate-spin" /> : <Sheet size={12} />} Salary sheet
                              </button>
                              {isAdmin && (
                                <button
                                  onClick={() => setEmailRow(r)}
                                  title="Email payslips to employees"
                                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-white border border-[#E2E2DF] text-[#1A1A1A] hover:bg-[#F4F4F2] rounded-lg transition font-medium"
                                >
                                  <Mail size={12} /> Email
                                </button>
                              )}
                            </>
                          )}
                          {r.status !== "locked" && (
                            <button
                              onClick={() => setConfirm({ kind: "process", row: r })}
                              disabled={busy}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-white border border-[#E2E2DF] text-[#1A1A1A] hover:bg-[#F4F4F2] rounded-lg transition font-medium disabled:opacity-60"
                            >
                              {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Process
                            </button>
                          )}
                          {r.status === "processed" && isAdmin && (
                            <button
                              onClick={() => setConfirm({ kind: "lock", row: r })}
                              disabled={busy}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-[#E5202E] text-white hover:bg-[#C81824] rounded-lg transition font-semibold disabled:opacity-60"
                            >
                              <Lock size={12} /> Lock
                            </button>
                          )}
                          {r.status === "locked" && user.role === "super_admin" && (
                            <button
                              onClick={() => setUnlockRow(r)}
                              disabled={busy}
                              className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-white border border-[#E5202E]/40 text-[#E5202E] hover:bg-[#E5202E]/6 rounded-lg transition font-medium disabled:opacity-60"
                            >
                              <Unlock size={12} /> Unlock
                            </button>
                          )}
                          {r.status === "locked" && user.role !== "super_admin" && (
                            <span className="text-[11px] text-[#6B6B6B]">Read-only</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* Process error list */}
      {processErrors && processErrors.length > 0 && (
        <GlassCard className="p-4">
          <p className="text-[#DC2626] font-semibold text-sm mb-2 flex items-center gap-1.5">
            <AlertCircle size={14} /> {processErrors.length} row{processErrors.length === 1 ? "" : "s"} skipped
          </p>
          <ul className="space-y-1 text-xs text-[#5A5A5A] max-h-48 overflow-y-auto">
            {processErrors.map((e, i) => (
              <li key={i}><span className="font-mono font-semibold text-[#1A1A1A]">{e.emp_code}</span> — {e.error}</li>
            ))}
          </ul>
        </GlassCard>
      )}

      {/* Confirm modal (process / lock) */}
      {confirm && (
        <ConfirmModal
          title={confirm.kind === "lock" ? "Lock payroll month?" : "Process payroll month?"}
          body={
            confirm.kind === "lock"
              ? "Locking finalizes this month — payslips can't be reprocessed without a super-admin unlock."
              : `This will compute payslips for ${monthLabel(confirm.row.month, confirm.row.year)} (${confirm.row.entity_id}) from current salary structures and attendance.`
          }
          confirmLabel={confirm.kind === "lock" ? "Lock month" : "Process"}
          danger={confirm.kind === "lock"}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            const { kind, row } = confirm;
            setConfirm(null);
            if (kind === "lock") doLock(row); else doProcess(row);
          }}
        />
      )}

      {/* Unlock modal */}
      {unlockRow && (
        <UnlockModal
          row={unlockRow}
          onClose={() => setUnlockRow(null)}
          onDone={(msg) => { setUnlockRow(null); showToast("ok", msg); load(); }}
          onError={(msg) => showToast("err", msg)}
        />
      )}

      {/* Email payslips modal */}
      {emailRow && (
        <EmailModal
          row={emailRow}
          onClose={() => setEmailRow(null)}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ─── Email payslips modal ─────────────────────────────────────────────────────

function EmailModal({ row, onClose, showToast }: {
  row: { entity_id: string; year: number; month: number; status: string };
  onClose: () => void;
  showToast: (k: "ok" | "err", m: string) => void;
}) {
  const [preview, setPreview] = useState<EmailPayslipsPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState<"test" | "send" | "">("");

  useEffect(() => {
    setLoading(true);
    apiEmailPayslipsPreview(row.entity_id, row.year, row.month)
      .then(setPreview)
      .catch((e) => setErr(errMsg(e, "Could not load recipients")))
      .finally(() => setLoading(false));
  }, [row.entity_id, row.year, row.month]);

  const isLocked = row.status === "locked";
  const smtpOff = preview ? !preview.smtp_configured : false;

  const sendTest = async () => {
    if (!testTo.includes("@")) { showToast("err", "Enter a valid email for the test send"); return; }
    setBusy("test");
    try {
      await apiEmailPayslipsSend(row.entity_id, row.year, row.month, testTo.trim());
      showToast("ok", `Test payslip sent to ${testTo.trim()}`);
    } catch (e) {
      showToast("err", errMsg(e, "Test send failed"));
    } finally { setBusy(""); }
  };

  const sendAll = async () => {
    setBusy("send");
    try {
      const res = await apiEmailPayslipsSend(row.entity_id, row.year, row.month);
      const skipped = res.skipped?.length ?? 0;
      const failed = res.failed?.length ?? 0;
      showToast(failed ? "err" : "ok",
        `${res.sent ?? 0} sent, ${skipped} skipped, ${failed} failed`);
      onClose();
    } catch (e) {
      showToast("err", errMsg(e, "Send failed"));
    } finally { setBusy(""); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-[#E2E2DF] p-5">
        <h3 className="text-[#1A1A1A] font-semibold text-base mb-1 flex items-center gap-2">
          <Mail size={16} className="text-[#E5202E]" /> Email payslips — {monthLabel(row.month, row.year)}
        </h3>
        <p className="text-[#5A5A5A] text-sm mb-4">{row.entity_id} · attaches each employee&apos;s payslip PDF.</p>

        {loading ? (
          <div className="py-6"><SkeletonRows rows={3} cols={2} /></div>
        ) : err ? (
          <p className="text-sm text-[#DC2626] flex items-center gap-1.5"><AlertCircle size={14} /> {err}</p>
        ) : preview && (
          <div className="space-y-4">
            {smtpOff && (
              <div className="flex items-start gap-2 text-xs rounded-xl px-3 py-2.5 bg-[#D97706]/10 border border-[#D97706]/30 text-[#92400E]">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                Email isn&apos;t configured on the server yet. Ask IT to set the SMTP details in the backend <code>.env</code>.
              </div>
            )}
            {!isLocked && (
              <div className="flex items-start gap-2 text-xs rounded-xl px-3 py-2.5 bg-[#D97706]/10 border border-[#D97706]/30 text-[#92400E]">
                <Lock size={14} className="shrink-0 mt-0.5" />
                This month isn&apos;t locked. You can send a test, but a real send is only allowed once the month is locked.
              </div>
            )}

            <div className="text-sm text-[#1A1A1A]">
              <span className="font-semibold">{preview.recipients.length}</span> employee
              {preview.recipients.length === 1 ? "" : "s"} will receive a payslip.
              {preview.skipped.length > 0 && (
                <div className="mt-2 text-xs text-[#5A5A5A]">
                  <span className="font-semibold text-[#D97706]">{preview.skipped.length} skipped</span> — no email on file:
                  <div className="mt-1 max-h-20 overflow-y-auto font-mono text-[11px] text-[#6B6B6B]">
                    {preview.skipped.map((s) => s.emp_code).join(", ")}
                  </div>
                </div>
              )}
            </div>

            {/* Test send */}
            <div className="rounded-xl border border-[#E2E2DF] p-3">
              <label className="block text-xs font-semibold text-[#5A5A5A] mb-1.5">Send a test to yourself first</label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder="you@udyogi.com"
                  className={`${INPUT} py-2`}
                />
                <button
                  onClick={sendTest}
                  disabled={busy !== "" || smtpOff}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-[#E2E2DF] text-[#1A1A1A] hover:bg-[#F4F4F2] rounded-xl transition font-medium disabled:opacity-60 shrink-0"
                >
                  {busy === "test" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Test
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2.5 text-sm bg-white border border-[#E2E2DF] text-[#5A5A5A] hover:bg-[#F4F4F2] rounded-xl transition font-medium">Cancel</button>
          <button
            onClick={sendAll}
            disabled={busy !== "" || loading || smtpOff || !isLocked || !preview || preview.recipients.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition font-semibold disabled:opacity-60"
            title={!isLocked ? "Lock the month to enable sending" : undefined}
          >
            {busy === "send" ? <><Loader2 size={13} className="animate-spin" /> Sending…</> : <><Mail size={14} /> Send to all</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ title, body, confirmLabel, danger, onClose, onConfirm }: {
  title: string; body: string; confirmLabel: string; danger?: boolean; onClose: () => void; onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-[#E2E2DF] p-5">
        <h3 className="text-[#1A1A1A] font-semibold text-base mb-2">{title}</h3>
        <p className="text-[#5A5A5A] text-sm mb-5">{body}</p>
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2.5 text-sm bg-white border border-[#E2E2DF] text-[#5A5A5A] hover:bg-[#F4F4F2] rounded-xl transition font-medium">Cancel</button>
          <button onClick={onConfirm} className={`px-5 py-2.5 text-sm text-white rounded-xl transition font-semibold ${danger ? "bg-[#E5202E] hover:bg-[#C81824]" : "bg-[#1A1A1A] hover:bg-black"}`}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function UnlockModal({ row, onClose, onDone, onError }: {
  row: { entity_id: string; year: number; month: number };
  onClose: () => void; onDone: (msg: string) => void; onError: (msg: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (reason.trim().length < 5) { setError("Please enter a reason (at least 5 characters)."); return; }
    setSaving(true); setError("");
    try {
      const res = await apiUnlockPayroll({ entity_id: row.entity_id, year: row.year, month: row.month, reason: reason.trim() });
      onDone(`Unlocked — ${res.unlocked_count} payslip${res.unlocked_count === 1 ? "" : "s"}`);
    } catch (e: unknown) {
      const m = errMsg(e, "Unlock failed");
      setError(m); onError(m);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-[#E2E2DF] p-5">
        <h3 className="text-[#1A1A1A] font-semibold text-base mb-1 flex items-center gap-2"><Unlock size={16} className="text-[#E5202E]" /> Unlock {monthLabel(row.month, row.year)}</h3>
        <p className="text-[#5A5A5A] text-sm mb-4">Unlocking re-opens this month for reprocessing. This action is audited with your reason.</p>
        <label className="block text-xs font-semibold text-[#5A5A5A] mb-1.5">Reason <span className="text-[#E5202E]">*</span></label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Why is this month being unlocked?"
          className={INPUT}
        />
        {error && <p className="text-xs text-[#DC2626] mt-2 flex items-center gap-1.5"><AlertCircle size={13} /> {error}</p>}
        <div className="flex items-center justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2.5 text-sm bg-white border border-[#E2E2DF] text-[#5A5A5A] hover:bg-[#F4F4F2] rounded-xl transition font-medium">Cancel</button>
          <button onClick={submit} disabled={saving || reason.trim().length < 5} className="flex items-center gap-2 px-5 py-2.5 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition font-semibold disabled:opacity-60">
            {saving ? <><Loader2 size={13} className="animate-spin" /> Unlocking…</> : "Unlock month"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SUB-VIEW 2: Salary Structures ────────────────────────────────────────────

interface EmpOption { emp_code: string; name: string; entity_id: string; }

function SalaryStructures({ user, isAdmin, showToast, initialEmp }: Importable & { isAdmin: boolean; initialEmp: string }) {
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<EmpOption[]>([]);
  const [dropOpen, setDropOpen] = useState(false);
  const [selected, setSelected] = useState<string>(initialEmp);
  const [history, setHistory] = useState<SalaryStructureRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [incOpen, setIncOpen] = useState(false);

  // Pre-load employee list
  useEffect(() => {
    apiGetEmployees({ per_page: "50", status: "active" }).then((d) => setOptions(d.items ?? [])).catch(() => {});
  }, []);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(async () => {
      if (search.trim().length < 1) return;
      try {
        const d = await apiGetEmployees({ search: search.trim(), per_page: "20" });
        setOptions(d.items ?? []);
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadHistory = useCallback((code: string) => {
    if (!code) return;
    setLoading(true);
    apiGetSalaryHistory(code)
      .then((d) => setHistory(d.structures))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (selected) loadHistory(selected); }, [selected, loadHistory]);

  const activeStructure = history.find((s) => s.status === "active") ?? null;
  const selectedObj = options.find((e) => e.emp_code === selected);

  return (
    <div className="space-y-5">
      {isAdmin && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[#5A5A5A] text-sm">Apply increments to one employee, or many at once via CSV.</p>
          <Link
            href="/dashboard/payroll/bulk-increment"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm bg-[#1A1A1A] text-white rounded-xl hover:bg-black transition font-semibold"
          >
            <Upload size={14} /> Bulk increment
          </Link>
        </div>
      )}

      {/* Employee picker */}
      <GlassCard className="p-4 relative z-10">
        <label className="block text-xs font-semibold text-[#5A5A5A] mb-1.5">Employee</label>
        <div className="relative max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B6B6B]" />
          <input
            value={dropOpen ? search : (selectedObj ? `${selectedObj.name} (${selectedObj.emp_code})` : search)}
            onChange={(e) => { setSearch(e.target.value); setDropOpen(true); }}
            onFocus={() => setDropOpen(true)}
            onBlur={() => setTimeout(() => setDropOpen(false), 150)}
            placeholder="Search name or code…"
            className={`${INPUT} pl-8`}
          />
          {dropOpen && options.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#E2E2DF] rounded-xl shadow-xl max-h-64 overflow-y-auto z-20">
              {options
                .filter((e) => !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.emp_code.toLowerCase().includes(search.toLowerCase()))
                .map((e) => (
                  <button
                    key={e.emp_code}
                    onMouseDown={() => { setSelected(e.emp_code); setSearch(""); setDropOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[#F4F4F2] transition text-sm"
                  >
                    <span className="font-mono text-xs bg-[#F4F4F2] px-1.5 py-0.5 rounded font-bold">{e.emp_code}</span>
                    <span className="text-[#1A1A1A]">{e.name}</span>
                    <span className="ml-auto text-[11px] text-[#6B6B6B]">{e.entity_id}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
      </GlassCard>

      {/* Salary history */}
      {selected && (
        <GlassCard>
          <div className="px-5 py-3.5 border-b border-[#E2E2DF] bg-[#F4F4F2]/60 flex items-center justify-between gap-3">
            <h2 className="text-[#1A1A1A] font-semibold text-sm flex items-center gap-2">
              <History size={15} className="text-[#5A5A5A]" /> Salary history — {selected}
            </h2>
            {isAdmin && (
              <button
                onClick={() => setIncOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#E5202E] text-white hover:bg-[#C81824] rounded-lg transition font-semibold"
              >
                <TrendingUp size={13} /> Apply increment
              </button>
            )}
          </div>
          <div className="p-5">
            <SalaryHistoryTable structures={history} loading={loading} />
          </div>
        </GlassCard>
      )}

      {!selected && (
        <GlassCard className="p-10 text-center">
          <Wallet size={28} className="text-[#C0C0C0] mx-auto mb-2" />
          <p className="text-[#5A5A5A] text-sm">Pick an employee to view their salary history and apply increments.</p>
        </GlassCard>
      )}

      {incOpen && isAdmin && selected && (
        <IncrementModal
          empCode={selected}
          active={activeStructure}
          onClose={() => setIncOpen(false)}
          onSuccess={() => { setIncOpen(false); loadHistory(selected); showToast("ok", "Increment applied"); }}
          onError={(m) => showToast("err", m)}
        />
      )}
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function errMsg(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return typeof m === "string" ? m : fallback;
}
