"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import GlassCard from "@/components/ui/GlassCard";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useAuth, isAdminRole } from "@/lib/auth";
import { ENTITIES } from "@/store/entity";
import { entityColor } from "@/lib/entities";
import {
  apiGetLoans, apiGetLoan, apiCreateLoan, apiUpdateLoan, apiOverrideLoanEmi, apiCloseLoan,
  apiGetEmployees, type LoanRow, type LoanScheduleRow,
} from "@/lib/api";
import {
  HandCoins, Plus, Search, Pencil, CalendarRange, X, Loader2, AlertCircle,
  CheckCircle2, Lock, Archive, Info,
} from "lucide-react";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MON3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const CURRENT_YEAR = new Date().getFullYear();
const INPUT = "w-full bg-white border border-[#E2E2DF] rounded-xl px-3 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 placeholder:text-[#6B6B6B]";
const SELECT = `${INPUT} appearance-none cursor-pointer`;
const money = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const ymLabel = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${MON3[d.getMonth()]} ${d.getFullYear()}`;
};
function errMsg(e: unknown, fb: string) {
  const m = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return typeof m === "string" ? m : fb;
}

const STATUS: Record<string, { bg: string; fg: string; label: string }> = {
  active:      { bg: "rgba(22,163,74,0.10)", fg: "#16A34A", label: "Active" },
  paused:      { bg: "rgba(217,119,6,0.12)", fg: "#D97706", label: "Paused" },
  closed:      { bg: "#F4F4F2",              fg: "#6B6B6B", label: "Closed" },
  written_off: { bg: "rgba(220,38,38,0.10)", fg: "#DC2626", label: "Written off" },
};
function StatusPill({ s }: { s: string }) {
  const st = STATUS[s] ?? STATUS.closed;
  return <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: st.bg, color: st.fg }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: st.fg }} />{st.label}</span>;
}

export default function LoansPage() {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";

  const [rows, setRows] = useState<LoanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editLoan, setEditLoan] = useState<LoanRow | null>(null);
  const [manageLoan, setManageLoan] = useState<LoanRow | null>(null);
  const [closeLoan, setCloseLoan] = useState<LoanRow | null>(null);

  const showToast = useCallback((kind: "ok" | "err", msg: string) => { setToast({ kind, msg }); setTimeout(() => setToast(null), 4000); }, []);

  const load = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (isSuperAdmin && entityFilter !== "ALL") params.entity_id = entityFilter;
    apiGetLoans(params).then((d) => setRows(d.loans)).catch(() => setRows([])).finally(() => setLoading(false));
  }, [isSuperAdmin, entityFilter]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!r.emp_code.toLowerCase().includes(q) && !(r.name ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  }), [rows, search, statusFilter]);

  if (!user) return null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-white font-semibold text-xl flex items-center gap-2"><HandCoins size={20} /> Loans / advances</h1>
          <p className="text-white/50 text-sm mt-0.5">EMIs auto-deduct on payroll · override a month to skip or change it</p>
        </div>
        <button onClick={() => setAddOpen(true)} className="flex items-center gap-1.5 px-4 py-2.5 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition font-semibold press"><Plus size={15} /> Add Loan</button>
      </div>

      {/* Banner */}
      <div className="flex items-start gap-2 p-3 rounded-xl bg-[#2563EB]/15 border border-[#2563EB]/30 text-white/85 text-sm">
        <Info size={15} className="text-[#93C5FD] shrink-0 mt-0.5" />
        <span>EMIs auto-deduct on payroll. Use <strong className="font-semibold text-white">Manage months</strong> to skip (set 0) or change a month — overrides are recorded and reflected on that month&apos;s payslip.</span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {isSuperAdmin && (
          <div className="flex gap-2 flex-wrap">
            {ENTITIES.map(({ id }) => {
              const sel = entityFilter === id;
              const fill = id === "ALL" ? "#1A1A1A" : entityColor(id);
              return <button key={id} onClick={() => setEntityFilter(id)} className="px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all" style={sel ? { background: fill, color: "#fff" } : { background: "rgba(255,255,255,0.6)", color: "#5A5A5A" }}>{id}</button>;
            })}
          </div>
        )}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B6B6B]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search emp code / name…" className={`${INPUT} pl-8 py-2`} />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${SELECT} max-w-[160px] py-2`}>
          <option value="ALL">All status</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="closed">Closed</option>
          <option value="written_off">Written off</option>
        </select>
        <span className="text-white/60 text-xs ml-auto">{filtered.length} shown</span>
      </div>

      <GlassCard className="overflow-hidden">
        {loading ? <div className="p-5"><SkeletonRows rows={6} cols={6} /></div>
        : filtered.length === 0 ? <div className="p-10 text-center text-[#6B6B6B] text-sm">No loans match.</div>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/[0.07] text-[#6B6B6B] text-[11px] uppercase tracking-wide">
                  {["Emp ID", "Name", "Type", "Principal", "EMI", "Outstanding", "Tenure", "Start", "End", "Status", ""].map((h, i) => (
                    <th key={i} className={`px-3 py-3 ${[3,4,5,6].includes(i) ? "text-right" : i === 10 ? "text-right pr-5" : "text-left"} ${i === 0 ? "pl-5" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05]">
                {filtered.map((l) => (
                  <tr key={l.id} className="hover:bg-black/[0.025] transition-colors">
                    <td className="px-3 py-3 pl-5 font-mono text-xs text-[#1A1A1A]">{l.emp_code}</td>
                    <td className="px-3 py-3 text-[#1A1A1A]">{l.name ?? "—"}</td>
                    <td className="px-3 py-3 text-[#6B6B6B] capitalize">{l.loan_type}</td>
                    <td className="px-3 py-3 text-right font-mono text-[#1A1A1A]">{money(l.principal)}</td>
                    <td className="px-3 py-3 text-right font-mono text-[#1A1A1A]">{money(l.emi)}</td>
                    <td className="px-3 py-3 text-right font-mono font-semibold text-[#1A1A1A]">{money(l.outstanding)}</td>
                    <td className="px-3 py-3 text-right text-[#6B6B6B]">{l.tenure_months}m</td>
                    <td className="px-3 py-3 text-[#6B6B6B]">{ymLabel(l.start_date)}</td>
                    <td className="px-3 py-3 text-[#6B6B6B]">{ymLabel(l.end_date)}</td>
                    <td className="px-3 py-3"><StatusPill s={l.status} /></td>
                    <td className="px-3 py-3 pr-5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => setManageLoan(l)} title="Manage months" aria-label={`Manage months for ${l.emp_code}`} className="press p-1.5 rounded-lg text-[#2563EB] hover:bg-[#2563EB]/10 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"><CalendarRange size={14} /></button>
                        <button onClick={() => setEditLoan(l)} title="Edit" aria-label={`Edit loan for ${l.emp_code}`} className="press p-1.5 rounded-lg text-[#6B6B6B] hover:bg-black/[0.06] hover:text-[#1A1A1A] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E5202E]/30"><Pencil size={14} /></button>
                        {l.status !== "closed" && <button onClick={() => setCloseLoan(l)} title="Close" aria-label={`Close loan for ${l.emp_code}`} className="press p-1.5 rounded-lg text-[#6B6B6B] hover:bg-[#D97706]/10 hover:text-[#D97706] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D97706]/40"><Archive size={14} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {addOpen && <AddLoanModal onClose={() => setAddOpen(false)} onSaved={(m) => { setAddOpen(false); showToast("ok", m); load(); }} onError={(m) => showToast("err", m)} />}
      {editLoan && <EditLoanModal loan={editLoan} onClose={() => setEditLoan(null)} onSaved={(m) => { setEditLoan(null); showToast("ok", m); load(); }} onError={(m) => showToast("err", m)} />}
      {manageLoan && <ManageMonths loan={manageLoan} onClose={() => setManageLoan(null)} onChanged={() => load()} onToast={showToast} />}
      {closeLoan && (
        <ConfirmModal title={`Close loan for ${closeLoan.name ?? closeLoan.emp_code}?`} body="No further EMIs will be deducted. Outstanding stays on record." confirmLabel="Close loan"
          onClose={() => setCloseLoan(null)}
          onConfirm={async () => { try { await apiCloseLoan(closeLoan.id); showToast("ok", "Loan closed"); } catch (e) { showToast("err", errMsg(e, "Close failed")); } finally { setCloseLoan(null); load(); } }} />
      )}

      {toast && <div role="status" aria-live="polite" className={`fixed bottom-5 right-5 z-50 flex items-start gap-2 px-4 py-3 rounded-xl shadow-2xl text-sm max-w-sm text-white ${toast.kind === "ok" ? "bg-[#16A34A]" : "bg-[#DC2626]"}`}>{toast.kind === "ok" ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" /> : <AlertCircle size={16} className="shrink-0 mt-0.5" />}<span>{toast.msg}</span></div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-semibold text-[#5A5A5A] mb-1.5">{label}</label>{children}</div>;
}

// Shared dialog behavior: Escape to close, focus trap, focus return on unmount.
function useDialog<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    // Move focus into the dialog (first focusable, else the panel itself).
    const focusables = panel?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    (focusables?.[0] ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !panel) return;
      const f = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); opener?.focus?.(); };
  }, [onClose]);
  return ref;
}

function ModalShell({ title, children, footer, onClose, wide }: { title: string; children: React.ReactNode; footer: React.ReactNode; onClose: () => void; wide?: boolean }) {
  const panelRef = useDialog<HTMLDivElement>(onClose);
  const titleId = useId();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className={`w-full ${wide ? "max-w-2xl" : "max-w-lg"} bg-white rounded-2xl shadow-2xl border border-[#E2E2DF] max-h-[90vh] overflow-y-auto focus:outline-none`}
      >
        <div className="px-5 py-4 border-b border-[#E2E2DF] flex items-center justify-between sticky top-0 bg-white rounded-t-2xl">
          <h3 id={titleId} className="text-[#1A1A1A] font-semibold text-base">{title}</h3>
          <button onClick={onClose} aria-label="Close dialog" className="text-[#6B6B6B] hover:text-[#1A1A1A] rounded-lg transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E5202E]/40"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
        <div className="px-5 py-4 border-t border-[#E2E2DF] flex items-center justify-end gap-2 sticky bottom-0 bg-white rounded-b-2xl">{footer}</div>
      </div>
    </div>
  );
}

function AddLoanModal({ onClose, onSaved, onError }: { onClose: () => void; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const [empSearch, setEmpSearch] = useState("");
  const [empOptions, setEmpOptions] = useState<{ emp_code: string; name: string }[]>([]);
  const [empCode, setEmpCode] = useState("");
  const [dropOpen, setDropOpen] = useState(false);
  const empInputRef = useRef<HTMLInputElement>(null);
  const [dropPos, setDropPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const [loanType, setLoanType] = useState("loan");
  const [principal, setPrincipal] = useState("");
  const [emi, setEmi] = useState("");
  const [tenure, setTenure] = useState("");
  const [startMonth, setStartMonth] = useState(new Date().getMonth() + 1);
  const [startYear, setStartYear] = useState(CURRENT_YEAR);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { apiGetEmployees({ per_page: "50", status: "active" }).then((d) => setEmpOptions(d.items ?? [])).catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => { if (empSearch.trim()) apiGetEmployees({ search: empSearch.trim(), per_page: "20" }).then((d) => setEmpOptions(d.items ?? [])).catch(() => {}); }, 300);
    return () => clearTimeout(t);
  }, [empSearch]);

  // Anchor the portal dropdown to the input; track scroll/resize so it follows the field.
  useEffect(() => {
    if (!dropOpen) { setDropPos(null); return; }
    const update = () => {
      const r = empInputRef.current?.getBoundingClientRect();
      if (r) setDropPos({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [dropOpen]);

  const n = (v: string) => { const x = parseFloat(v); return isNaN(x) ? 0 : x; };
  const tNum = parseInt(tenure) || 0;
  const endOrd = (startYear * 12 + (startMonth - 1)) + Math.max(0, tNum - 1);
  const endLabel = tNum > 0 ? `${MON3[endOrd % 12]} ${Math.floor(endOrd / 12)}` : "—";
  const totalEmi = n(emi) * tNum;
  const mismatch = n(principal) > 0 && tNum > 0 && n(emi) > 0 && Math.abs(totalEmi - n(principal)) > 1;
  const selectedName = empOptions.find((e) => e.emp_code === empCode)?.name;

  const submit = async () => {
    setError("");
    if (!empCode) { setError("Pick an employee."); return; }
    if (n(principal) <= 0 || n(emi) <= 0 || tNum <= 0) { setError("Principal, EMI and tenure must be greater than 0."); return; }
    setSaving(true);
    try {
      await apiCreateLoan({ emp_code: empCode, loan_type: loanType, principal: n(principal), emi: n(emi), tenure_months: tNum, start_date: `${startYear}-${String(startMonth).padStart(2, "0")}-01` });
      onSaved("Loan created");
    } catch (e) { const m = errMsg(e, "Create failed"); setError(m); onError(m); } finally { setSaving(false); }
  };

  return (
    <ModalShell title="Add loan / advance" onClose={onClose} footer={
      <>
        <button onClick={onClose} className="px-4 py-2.5 text-sm bg-white border border-[#E2E2DF] text-[#5A5A5A] hover:bg-[#F4F4F2] rounded-xl transition font-medium">Cancel</button>
        <button onClick={submit} disabled={saving} className="flex items-center gap-2 px-6 py-2.5 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition font-semibold disabled:opacity-60">{saving ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : "Create"}</button>
      </>
    }>
      <Field label="Employee *">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B6B6B]" />
          <input ref={empInputRef} value={dropOpen ? empSearch : (selectedName ? `${selectedName} (${empCode})` : empSearch)} onChange={(e) => { setEmpSearch(e.target.value); setDropOpen(true); }} onFocus={() => setDropOpen(true)} onBlur={() => setTimeout(() => setDropOpen(false), 150)} placeholder="Search name or code…" className={`${INPUT} pl-8`} />
          {dropOpen && empOptions.length > 0 && dropPos && typeof document !== "undefined" && createPortal(
            <div style={{ position: "fixed", left: dropPos.left, top: dropPos.top, width: dropPos.width }} className="z-[60] bg-white border border-[#E2E2DF] rounded-xl shadow-xl max-h-56 overflow-y-auto">
              {empOptions.map((e) => <button key={e.emp_code} onMouseDown={() => { setEmpCode(e.emp_code); setEmpSearch(""); setDropOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[#F4F4F2] text-sm"><span className="font-mono text-xs bg-[#F4F4F2] px-1.5 py-0.5 rounded font-bold">{e.emp_code}</span>{e.name}</button>)}
            </div>,
            document.body
          )}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type"><select value={loanType} onChange={(e) => setLoanType(e.target.value)} className={SELECT}><option value="loan">Loan</option><option value="advance">Advance</option><option value="other">Other</option></select></Field>
        <Field label="Principal *"><input type="number" min="0" value={principal} onChange={(e) => setPrincipal(e.target.value)} className={INPUT} /></Field>
        <Field label="EMI *"><input type="number" min="0" value={emi} onChange={(e) => setEmi(e.target.value)} className={INPUT} /></Field>
        <Field label="Tenure (months) *"><input type="number" min="1" value={tenure} onChange={(e) => setTenure(e.target.value)} className={INPUT} /></Field>
        <Field label="Start month"><select value={startMonth} onChange={(e) => setStartMonth(parseInt(e.target.value))} className={SELECT}>{MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select></Field>
        <Field label="Start year"><select value={startYear} onChange={(e) => setStartYear(parseInt(e.target.value))} className={SELECT}>{[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select></Field>
      </div>
      <div className="flex items-center gap-2 p-3 rounded-xl bg-[#F4F4F2] text-sm text-[#1A1A1A]">
        <span>Ends <strong>{endLabel}</strong></span>
        <span className="ml-auto">EMI×tenure = <strong>{money(totalEmi)}</strong></span>
      </div>
      {mismatch && <div className="flex items-start gap-2 p-3 rounded-xl bg-[#D97706]/10 border border-[#D97706]/20 text-[#92590a] text-xs"><AlertCircle size={14} className="shrink-0 mt-0.5" /> EMI × tenure ({money(totalEmi)}) ≠ principal ({money(n(principal))}). The last EMI auto-caps to the remaining balance.</div>}
      {error && <div className="flex items-start gap-2 p-3 rounded-xl bg-[#DC2626]/8 border border-[#DC2626]/20 text-[#DC2626] text-sm"><AlertCircle size={15} className="shrink-0 mt-0.5" /> {error}</div>}
    </ModalShell>
  );
}

function EditLoanModal({ loan, onClose, onSaved, onError }: { loan: LoanRow; onClose: () => void; onSaved: (m: string) => void; onError: (m: string) => void }) {
  const [emi, setEmi] = useState(String(loan.emi));
  const [tenure, setTenure] = useState(String(loan.tenure_months));
  const [status, setStatus] = useState(loan.status);
  const [remarks, setRemarks] = useState(loan.remarks ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setSaving(true); setError("");
    try { await apiUpdateLoan(loan.id, { emi: parseFloat(emi), tenure_months: parseInt(tenure), status, remarks }); onSaved("Loan updated"); }
    catch (e) { const m = errMsg(e, "Update failed"); setError(m); onError(m); } finally { setSaving(false); }
  };
  return (
    <ModalShell title={`Edit loan — ${loan.emp_code}`} onClose={onClose} footer={
      <>
        <button onClick={onClose} className="px-4 py-2.5 text-sm bg-white border border-[#E2E2DF] text-[#5A5A5A] hover:bg-[#F4F4F2] rounded-xl transition font-medium">Cancel</button>
        <button onClick={submit} disabled={saving} className="flex items-center gap-2 px-6 py-2.5 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition font-semibold disabled:opacity-60">{saving ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : "Save"}</button>
      </>
    }>
      <p className="text-xs text-[#6B6B6B]">Principal {money(loan.principal)} · outstanding {money(loan.outstanding)} (principal locked once EMIs applied).</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="EMI"><input type="number" min="0" value={emi} onChange={(e) => setEmi(e.target.value)} className={INPUT} /></Field>
        <Field label="Tenure (months)"><input type="number" min="1" value={tenure} onChange={(e) => setTenure(e.target.value)} className={INPUT} /></Field>
        <Field label="Status"><select value={status} onChange={(e) => setStatus(e.target.value as LoanRow["status"])} className={SELECT}><option value="active">Active</option><option value="paused">Paused</option><option value="closed">Closed</option><option value="written_off">Written off</option></select></Field>
      </div>
      <Field label="Remarks"><input value={remarks} onChange={(e) => setRemarks(e.target.value)} className={INPUT} /></Field>
      {error && <div className="flex items-start gap-2 p-3 rounded-xl bg-[#DC2626]/8 border border-[#DC2626]/20 text-[#DC2626] text-sm"><AlertCircle size={15} className="shrink-0 mt-0.5" /> {error}</div>}
    </ModalShell>
  );
}

function ManageMonths({ loan, onClose, onChanged, onToast }: { loan: LoanRow; onClose: () => void; onChanged: () => void; onToast: (k: "ok" | "err", m: string) => void }) {
  const [sched, setSched] = useState<LoanScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editRow, setEditRow] = useState<{ year: number; month: number } | null>(null);
  const [emi, setEmi] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    apiGetLoan(loan.id).then((d) => setSched(d.schedule)).catch(() => setSched([])).finally(() => setLoading(false));
  }, [loan.id]);
  useEffect(() => { reload(); }, [reload]);

  const saveOverride = async () => {
    if (!editRow) return;
    if (reason.trim().length < 4) { onToast("err", "Reason needs at least 4 characters"); return; }
    setBusy(true);
    try {
      await apiOverrideLoanEmi(loan.id, { year: editRow.year, month: editRow.month, emi: parseFloat(emi || "0"), reason: reason.trim() });
      onToast("ok", "Month override saved"); setEditRow(null); setReason(""); setEmi(""); reload(); onChanged();
    } catch (e) { onToast("err", errMsg(e, "Override failed")); } finally { setBusy(false); }
  };

  return (
    <ModalShell title={`Manage months — ${loan.emp_code} (${loan.loan_type})`} wide onClose={onClose} footer={
      <button onClick={onClose} className="px-4 py-2.5 text-sm bg-white border border-[#E2E2DF] text-[#5A5A5A] hover:bg-[#F4F4F2] rounded-xl transition font-medium">Done</button>
    }>
      <p className="text-xs text-[#6B6B6B]">Outstanding <strong className="text-[#1A1A1A]">{money(loan.outstanding)}</strong> of {money(loan.principal)}. Set a month&apos;s EMI to 0 to skip it. Locked payroll months can&apos;t be changed.</p>
      {loading ? <SkeletonRows rows={4} cols={4} />
      : sched.length === 0 ? <p className="text-sm text-[#6B6B6B]">No schedule rows yet — they&apos;re created as each month is processed.</p>
      : (
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-xs">
            <thead><tr className="text-[10px] uppercase tracking-wide text-[#6B6B6B] text-left"><th className="py-2 px-2">Month</th><th className="py-2 px-2 text-right">Scheduled</th><th className="py-2 px-2 text-right">Actual</th><th className="py-2 px-2">Flags</th><th className="py-2 px-2 text-right">Edit</th></tr></thead>
            <tbody>
              {sched.map((s) => (
                <tr key={`${s.year}-${s.month}`} className="border-b border-[#F0F0EE]">
                  <td className="py-2 px-2 text-[#1A1A1A]">{MON3[s.month - 1]} {s.year}</td>
                  <td className="py-2 px-2 text-right font-mono text-[#6B6B6B]">{money(s.scheduled_emi)}</td>
                  <td className="py-2 px-2 text-right font-mono font-semibold text-[#1A1A1A]">{money(s.actual_emi)}</td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-1.5">
                      {s.applied && <span className="inline-flex items-center gap-1 text-[10px] text-[#16A34A]"><CheckCircle2 size={11} /> applied</span>}
                      {s.is_overridden && <span className="text-[10px] bg-[#D97706]/15 text-[#92590a] px-1.5 py-0.5 rounded-full">override</span>}
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right">
                    <button onClick={() => { setEditRow({ year: s.year, month: s.month }); setEmi(String(s.actual_emi)); setReason(""); }} aria-label={`Override ${MON3[s.month - 1]} ${s.year}`} className="p-1 rounded text-[#2563EB] hover:bg-[#2563EB]/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40"><Pencil size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editRow && (
        <div className="rounded-xl border border-[#E2E2DF] bg-[#F4F4F2]/60 p-4 space-y-3">
          <p className="text-sm font-semibold text-[#1A1A1A]">Override {MON3[editRow.month - 1]} {editRow.year}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="EMI for this month (0 to skip)"><input type="number" min="0" value={emi} onChange={(e) => setEmi(e.target.value)} className={INPUT} /></Field>
            <Field label="Reason *"><input value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT} placeholder="why?" /></Field>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setEditRow(null)} className="px-3 py-2 text-xs bg-white border border-[#E2E2DF] text-[#5A5A5A] rounded-lg">Cancel</button>
            <button onClick={saveOverride} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 text-xs bg-[#E5202E] text-white hover:bg-[#C81824] rounded-lg font-semibold disabled:opacity-60">{busy ? <Loader2 size={12} className="animate-spin" /> : <Lock size={12} />} Save override</button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

function ConfirmModal({ title, body, confirmLabel, onClose, onConfirm }: { title: string; body: string; confirmLabel: string; onClose: () => void; onConfirm: () => void }) {
  const panelRef = useDialog<HTMLDivElement>(onClose);
  const titleId = useId();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-[#E2E2DF] p-5 focus:outline-none"
      >
        <h3 id={titleId} className="text-[#1A1A1A] font-semibold text-base mb-2">{title}</h3>
        <p className="text-[#5A5A5A] text-sm mb-5">{body}</p>
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2.5 text-sm bg-white border border-[#E2E2DF] text-[#5A5A5A] hover:bg-[#F4F4F2] rounded-xl transition font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E5202E]/30">Cancel</button>
          <button onClick={onConfirm} className="px-5 py-2.5 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E5202E]/40">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
