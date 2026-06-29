"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import GlassCard from "@/components/ui/GlassCard";
import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";
import { useAuth, isAdminRole } from "@/lib/auth";
import { apiGetPayslip, apiDownloadPayslipPdf, apiGetEmployees, apiLateOverride } from "@/lib/api";
import { APP_META } from "@/lib/appMeta";
import { FileText, Download, Printer, Search, Clock, Pencil, X, Loader2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PayslipData {
  payroll_id: number;
  emp_code: string;
  year: number;
  month: number;
  month_name: string;
  month_year: string;
  // full monthly rates
  basic: number;
  hra: number;
  spl: number;
  cca: number;
  leave_travel: number;
  other_allowance: number;
  other_earning: number;
  gross: number;
  // prorated rate/amount pairs
  basic_rate: number;
  basic_amount: number;
  hra_rate: number;
  hra_amount: number;
  spl_rate: number;
  spl_amount: number;
  cca_rate: number;
  cca_amount: number;
  lt_rate: number;
  lt_amount: number;
  gross_rate: number;
  total_earnings: number;
  // deductions
  pf_emp: number;
  pf_ern: number;
  esic_emp: number;
  esic_ern: number;
  pt: number;
  loan_emi: number;
  ld: number;
  other_deduction: number;
  total_deduction: number;
  net_pay: number;
  // attendance
  total_days: number | null;
  pay_days: number | null;
  days_p: number | null;
  days_a: number | null;
  days_wo: number | null;
  days_cl: number | null;
  days_pl: number | null;
  days_sl: number | null;
  days_h: number | null;
  days_lwp: number | null;
  late_days: number;
  absent_from_late: number;
  ot_hours: number;
  status: string;
  // employee / entity
  name: string;
  designation: string | null;
  department: string | null;
  entity_id: string;
  entity_name: string;
  entity_address: string | null;
  location_city: string;
  bank_acc_masked: string | null;
  pf_number: string | null;
  uan_no: string | null;
  esi_no: string | null;
  leave_balances: Record<string, number>;
  leave: {
    cl: LeaveBucket;
    sl: LeaveBucket;
    pl: LeaveBucket;
  };
  amount_in_words: string;
  generated_at: string | null;
  salary_effective_from?: string | null;
  salary_effective_from_display?: string | null;
}

interface LeaveBucket { tb: number; ulb: number; alb: number; }

interface EmpOption { emp_code: string; name: string; entity_id: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const NOW = new Date();
const CURRENT_YEAR = NOW.getFullYear();
const CURRENT_MONTH = NOW.getMonth() + 1;
const START_YEAR = 2023;

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-IN");
}

function fmtAmt(n: number) {
  return n === 0 ? "—" : n.toLocaleString("en-IN");
}

// ─── Glass card (chrome) ──────────────────────────────────────────────────────

// ─── Payslip document card (print-accurate white card) ────────────────────────

function PayslipDocument({ data }: { data: PayslipData }) {
  return (
    <div
      id="payslip-print-area"
      className="bg-white border border-[#d0d0d0] rounded-lg shadow-md"
      style={{ fontFamily: "Arial, sans-serif", fontSize: "9px", color: "#000", maxWidth: 780, margin: "0 auto" }}
    >
      <div style={{ padding: "16px 20px" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", borderBottom: "2px solid #000", paddingBottom: 9, marginBottom: 6 }}>
          <div style={{ marginRight: 12, minWidth: 44, flexShrink: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/udyogi-logo.png" alt="Udyogi" style={{ display: "block", width: 44, height: "auto" }} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: "bold", marginBottom: 1 }}>
              {data.entity_name.toUpperCase()}
            </div>
            {data.entity_address && (
              <div style={{ fontSize: 8, color: "#333" }}>{data.entity_address}</div>
            )}
          </div>
        </div>

        {/* ── Title ── */}
        <div style={{ textAlign: "center", fontSize: 10.5, fontWeight: "bold", border: "1px solid #000", padding: "3px 6px", marginBottom: 6, background: "#f0f0f0", letterSpacing: 0.5 }}>
          PAYSLIP FOR THE MONTH OF {data.month_year}
        </div>

        {/* ── Employee info 2-col ── */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 5, fontSize: 8.5 }}>
          <tbody>
            <tr>
              <td style={{ ...empCellStyle, width: "50%" }}>
                <div><span style={lblStyle}>Name:</span> {data.name} ({data.emp_code})</div>
                <div><span style={lblStyle}>Dept:</span> {data.department ?? "—"}</div>
                {(data.salary_effective_from_display ?? data.salary_effective_from) && (
                  <div><span style={lblStyle}>Salary w.e.f:</span> {data.salary_effective_from_display ?? data.salary_effective_from}</div>
                )}
              </td>
              <td style={{ ...empCellStyle, width: "50%" }}>
                <div><span style={lblStyle}>Desig:</span> {data.designation ?? "—"}</div>
                {data.pf_number && <div><span style={lblStyle}>PF No:</span> {data.pf_number}</div>}
                {data.esic_emp > 0 && data.esi_no && <div><span style={lblStyle}>ESI No:</span> {data.esi_no}</div>}
                <div><span style={lblStyle}>Series:</span> {data.location_city}</div>
                {data.uan_no && <div><span style={lblStyle}>UAN No:</span> {data.uan_no}</div>}
                <div><span style={lblStyle}>OT Hrs:</span> {data.ot_hours || "—"}</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── Main table ── */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 4, fontSize: 8.5 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: "13%" }}>Attendance</th>
              <th style={{ ...thStyle, width: "19%" }}>Earning Component</th>
              <th style={{ ...thStyle, ...amtStyle, width: "10%" }}>Rate (₹)</th>
              <th style={{ ...thStyle, ...amtStyle, width: "10%" }}>Amount (₹)</th>
              <th style={{ ...thStyle, width: "28%" }}>Deduction Component</th>
              <th style={{ ...thStyle, ...amtStyle, width: "10%" }}>Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {/* Row 1: PR | BASIC | PF */}
            <tr>
              <td style={tdStyle}>PR: {data.days_p ?? "—"}</td>
              <td style={tdStyle}>BASIC</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{fmt(data.basic_rate)}</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{fmt(data.basic_amount)}</td>
              <td style={tdStyle}>P.F. (12%)</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{fmt(data.pf_emp)}</td>
            </tr>

            {/* Row 2: WO | HRA | ESIC */}
            <tr>
              <td style={tdStyle}>WO: {data.days_wo ?? "—"}</td>
              <td style={tdStyle}>H.R.A.</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{fmt(data.hra_rate)}</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{fmt(data.hra_amount)}</td>
              <td style={tdStyle}>E.S.I.C. (0.75%)</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{fmt(data.esic_emp)}</td>
            </tr>

            {/* Row 3: HO | SPECIAL AL. | P. TAX */}
            <tr>
              <td style={tdStyle}>HO: {data.days_h ?? "—"}</td>
              <td style={tdStyle}>SPECIAL AL.</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{fmt(data.spl_rate)}</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{fmt(data.spl_amount)}</td>
              <td style={tdStyle}>P. TAX</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{fmt(data.pt)}</td>
            </tr>

            {/* Row 4: ABS | C.C.A. (always) | Loan EMI (conditional) */}
            <tr>
              <td style={tdStyle}>{data.days_a ? `ABS: ${data.days_a}` : ""}</td>
              <td style={tdStyle}>C.C.A.</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{fmt(data.cca_rate)}</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{fmt(data.cca_amount)}</td>
              {data.loan_emi > 0 ? (
                <>
                  <td style={tdStyle}>Loan EMI</td>
                  <td style={{ ...tdStyle, ...amtStyle }}>{fmt(data.loan_emi)}</td>
                </>
              ) : (
                <><td style={tdStyle}></td><td style={tdStyle}></td></>
              )}
            </tr>

            {/* Row 5: LEAVE TRAV (always) | LD (conditional) */}
            <tr>
              <td style={tdStyle}></td>
              <td style={tdStyle}>LEAVE TRAV</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{fmt(data.lt_rate)}</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{fmt(data.lt_amount)}</td>
              {data.ld > 0 ? (
                <>
                  <td style={tdStyle}>LD (Late Deduction)</td>
                  <td style={{ ...tdStyle, ...amtStyle }}>{fmt(data.ld)}</td>
                </>
              ) : (
                <><td style={tdStyle}></td><td style={tdStyle}></td></>
              )}
            </tr>

            {/* Row 6: OTHER EARNING (conditional) | OTHER DED (conditional) — Other Earning = fixed + per-month reward */}
            {(data.other_earning > 0 || data.other_deduction > 0) && (
              <tr>
                <td style={tdStyle}></td>
                {data.other_earning > 0 ? (
                  <>
                    <td style={tdStyle}>OTHER EARNING</td>
                    <td style={{ ...tdStyle, ...amtStyle }}></td>
                    <td style={{ ...tdStyle, ...amtStyle }}>{fmt(data.other_earning)}</td>
                  </>
                ) : (
                  <><td style={tdStyle}></td><td style={tdStyle}></td><td style={tdStyle}></td></>
                )}
                {data.other_deduction > 0 ? (
                  <>
                    <td style={tdStyle}>OTHER DED</td>
                    <td style={{ ...tdStyle, ...amtStyle }}>{fmt(data.other_deduction)}</td>
                  </>
                ) : (
                  <><td style={tdStyle}></td><td style={tdStyle}></td></>
                )}
              </tr>
            )}

            {/* Footer row 1: Paydays / Total Earnings / Total Deductions */}
            <tr style={{ background: "#ccc", fontWeight: "bold" }}>
              <td style={tdStyle}>Paydays: {data.pay_days ?? data.total_days ?? "—"}</td>
              <td style={tdStyle} colSpan={2}>TOTAL EARNINGS</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{fmt(data.total_earnings)}</td>
              <td style={tdStyle}>TOTAL DEDUCTIONS</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{fmt(data.total_deduction)}</td>
            </tr>

            {/* Footer row 2: GROSS (full monthly rate) */}
            <tr style={{ background: "#ccc", fontWeight: "bold" }}>
              <td style={tdStyle} colSpan={3}>GROSS (Rate)</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{fmt(data.gross_rate)}</td>
              <td style={tdStyle}></td><td style={tdStyle}></td>
            </tr>

            {/* Footer row 3: NET PAY (take-home) */}
            <tr style={{ background: "#b0b0b0", fontWeight: "bold", fontSize: 10 }}>
              <td style={tdStyle} colSpan={3}>NET PAY</td>
              <td style={{ ...tdStyle, ...amtStyle }}>₹{fmt(data.net_pay)}</td>
              <td style={tdStyle}></td><td style={tdStyle}></td>
            </tr>
          </tbody>
        </table>

        {/* ── Amount in words ── */}
        <div style={{ fontSize: 8.5, margin: "4px 0 5px" }}>
          <strong>INR in Words:</strong> {data.amount_in_words}
        </div>

        {/* ── Late note (why LD) ── */}
        {data.late_days > 0 && (
          <div style={{ fontSize: 7.5, color: "#555", marginBottom: 5 }}>
            Late days: {data.late_days} → {data.absent_from_late} absent-equivalent
            {data.absent_from_late === 1 ? "" : "s"} (every 3 late = 1 day; covered by leave first, remainder charged as LD).
          </div>
        )}

        {/* ── Leave balance (TB / ULB / ALB × CL | SL | PL) ── */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 5, fontSize: 8.5 }}>
          <tbody>
            <tr>
              <th style={{ ...thStyle, textAlign: "left", width: "25%" }}>Leave Balance</th>
              <th style={{ ...thStyle, ...amtStyle }}>CL</th>
              <th style={{ ...thStyle, ...amtStyle }}>SL</th>
              <th style={{ ...thStyle, ...amtStyle }}>PL</th>
            </tr>
            <tr>
              <td style={tdStyle}>TB (Total)</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{Math.floor(data.leave.cl.tb)}</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{Math.floor(data.leave.sl.tb)}</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{Math.floor(data.leave.pl.tb)}</td>
            </tr>
            <tr>
              <td style={tdStyle}>ULB (Used)</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{Math.floor(data.leave.cl.ulb)}</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{Math.floor(data.leave.sl.ulb)}</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{Math.floor(data.leave.pl.ulb)}</td>
            </tr>
            <tr>
              <td style={tdStyle}>ALB (Available)</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{Math.floor(data.leave.cl.alb)}</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{Math.floor(data.leave.sl.alb)}</td>
              <td style={{ ...tdStyle, ...amtStyle }}>{Math.floor(data.leave.pl.alb)}</td>
            </tr>
          </tbody>
        </table>

        {/* ── Bottom bar: Payment / Bank ── */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 4, fontSize: 8.5 }}>
          <tbody>
            <tr>
              <td style={{ ...btmCellStyle, width: "50%" }}>
                <strong>Payment By:</strong> BANK
              </td>
              <td style={{ ...btmCellStyle, width: "50%", textAlign: "right" }}>
                <strong>Bank A/c No:</strong> {data.bank_acc_masked ?? "—"}
              </td>
            </tr>
          </tbody>
        </table>

        {/* ── Disclaimer ── */}
        <div style={{ fontSize: 7.5, color: "#555", marginTop: 8, borderTop: "1px dashed #bbb", paddingTop: 4 }}>
          This is a computer-generated payslip and does not require a physical signature.
        </div>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = { border: "1px solid #aaa", padding: "3px 4px", background: "#e0e0e0", fontWeight: "bold", textAlign: "center", verticalAlign: "top" };
const tdStyle: React.CSSProperties = { border: "1px solid #ccc", padding: "2px 4px", verticalAlign: "top" };
const amtStyle: React.CSSProperties = { textAlign: "right" };
const empCellStyle: React.CSSProperties = { border: "1px solid #bbb", padding: "2px 5px", verticalAlign: "top" };
const btmCellStyle: React.CSSProperties = { border: "1px solid #bbb", padding: "3px 5px", verticalAlign: "top" };
const lblStyle: React.CSSProperties = { fontWeight: "bold" };

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PayslipPage() {
  const { user } = useAuth();

  // Selected period
  const [selYear, setSelYear] = useState(CURRENT_YEAR);
  const [selMonth, setSelMonth] = useState(CURRENT_MONTH);

  // Available years for dropdown
  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = CURRENT_YEAR; y >= START_YEAR; y--) years.push(y);
    return years;
  }, []);

  // Employee selection (admins only)
  const [empSearch, setEmpSearch] = useState("");
  const [empOptions, setEmpOptions] = useState<EmpOption[]>([]);
  const [selectedEmp, setSelectedEmp] = useState<string>("");
  const [empDropOpen, setEmpDropOpen] = useState(false);
  const [empLoading, setEmpLoading] = useState(false);

  // Payslip data
  const [payslip, setPayslip] = useState<PayslipData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Late / LD override (admin, unlocked months)
  const [ovOpen, setOvOpen] = useState(false);
  const [ovAbsent, setOvAbsent] = useState("");
  const [ovLd, setOvLd] = useState("");
  const [ovReason, setOvReason] = useState("");
  const [ovSaving, setOvSaving] = useState(false);
  const [ovError, setOvError] = useState("");

  const isAdmin = isAdminRole(user);

  // Determine which emp_code to load
  const targetEmp = isAdmin && selectedEmp ? selectedEmp : (user?.emp_code ?? "");

  // Load employee list for admins (debounced on search)
  useEffect(() => {
    if (!isAdmin) return;
    const t = setTimeout(async () => {
      if (empSearch.trim().length < 1) return;
      setEmpLoading(true);
      try {
        const data = await apiGetEmployees({ search: empSearch.trim(), per_page: "20" });
        setEmpOptions(data.items ?? []);
      } catch {
        setEmpOptions([]);
      } finally {
        setEmpLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [empSearch, isAdmin]);

  // Pre-load employee list on mount for admins
  useEffect(() => {
    if (!isAdmin) return;
    apiGetEmployees({ per_page: "50", status: "active" }).then((d) => setEmpOptions(d.items ?? [])).catch(() => {});
  }, [isAdmin]);

  const fetchPayslip = useCallback(async () => {
    if (!targetEmp) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGetPayslip(targetEmp, selYear, selMonth);
      setPayslip(data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Failed to load payslip");
      setPayslip(null);
    } finally {
      setLoading(false);
    }
  }, [targetEmp, selYear, selMonth]);

  useEffect(() => {
    fetchPayslip();
  }, [fetchPayslip]);

  const handleDownload = async () => {
    if (!targetEmp) return;
    setDownloading(true);
    try {
      await apiDownloadPayslipPdf(targetEmp, selYear, selMonth);
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const openOverride = () => {
    if (!payslip) return;
    setOvAbsent(String(payslip.absent_from_late ?? 0));
    setOvLd(String(payslip.ld ?? 0));
    setOvReason("");
    setOvError("");
    setOvOpen(true);
  };

  const submitOverride = async () => {
    if (!targetEmp) return;
    if (ovReason.trim().length < 4) { setOvError("A reason of at least 4 characters is required."); return; }
    setOvSaving(true);
    setOvError("");
    try {
      await apiLateOverride({
        emp_code: targetEmp, year: selYear, month: selMonth,
        absent_from_late: ovAbsent === "" ? undefined : Number(ovAbsent),
        ld: ovLd === "" ? undefined : Number(ovLd),
        reason: ovReason.trim(),
      });
      setOvOpen(false);
      await fetchPayslip();
    } catch (e: unknown) {
      setOvError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Override failed");
    } finally {
      setOvSaving(false);
    }
  };

  if (!user) return null;

  const selectedEmpObj = empOptions.find((e) => e.emp_code === selectedEmp);

  return (
    <>
      {/* Print-only styles */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #payslip-print-area, #payslip-print-area * { visibility: visible !important; }
          #payslip-print-area { position: fixed; top: 0; left: 0; width: 100%; }
        }
      `}</style>

      <div className="p-4 sm:p-6 space-y-5 max-w-4xl mx-auto">

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#E5202E]/10 flex items-center justify-center shrink-0">
              <FileText size={18} className="text-[#E5202E]" />
            </div>
            <div>
              <h1 className="text-white font-semibold text-xl leading-tight">Payslips</h1>
              <p className="text-[#5A5A5A] text-xs mt-0.5">
                {isAdmin ? "View any employee's payslip" : `${user.name} · ${user.emp_code}`}
              </p>
            </div>
          </div>

          {payslip && (
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-3.5 py-2 text-sm bg-white border border-[#E2E2DF] text-[#1A1A1A] hover:bg-[#F4F4F2] rounded-xl transition min-h-[44px] font-medium"
              >
                <Printer size={14} />
                Print
              </button>
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="flex items-center gap-1.5 px-3.5 py-2 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition shadow-sm min-h-[44px] font-semibold disabled:opacity-60"
              >
                <Download size={14} />
                {downloading ? "Downloading…" : "Download PDF"}
              </button>
            </div>
          )}
        </div>

        {/* Controls row */}
        <GlassCard className="p-4 flex flex-col sm:flex-row gap-4 relative z-10">

          {/* Admin: employee picker */}
          {isAdmin && (
            <div className="flex-1 relative">
              <label className="block text-[#5A5A5A] text-xs font-semibold mb-1.5">Employee</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B6B6B] pointer-events-none" />
                <input
                  value={selectedEmpObj ? `${selectedEmpObj.name} (${selectedEmpObj.emp_code})` : empSearch}
                  onChange={(e) => { setEmpSearch(e.target.value); setSelectedEmp(""); setEmpDropOpen(true); }}
                  onFocus={() => setEmpDropOpen(true)}
                  onBlur={() => setTimeout(() => setEmpDropOpen(false), 150)}
                  placeholder="Search employee…"
                  className="w-full bg-white border border-[#E2E2DF] rounded-xl pl-9 pr-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#6B6B6B] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 min-h-[44px]"
                />
                {empDropOpen && (empOptions.length > 0 || empLoading) && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-[#E2E2DF] rounded-xl shadow-lg max-h-52 overflow-y-auto">
                    {empLoading ? (
                      <div className="p-3 text-[#5A5A5A] text-sm flex items-center gap-2">
                        <div className="w-3 h-3 border-2 border-[#E5202E] border-t-transparent rounded-full animate-spin" />
                        Loading…
                      </div>
                    ) : (
                      empOptions
                        .filter((e) => !empSearch || e.name.toLowerCase().includes(empSearch.toLowerCase()) || e.emp_code.toLowerCase().includes(empSearch.toLowerCase()))
                        .map((e) => (
                          <button
                            key={e.emp_code}
                            onMouseDown={() => { setSelectedEmp(e.emp_code); setEmpSearch(""); setEmpDropOpen(false); }}
                            className="w-full text-left px-4 py-2.5 text-sm text-[#1A1A1A] hover:bg-[#F4F4F2] flex items-center gap-2"
                          >
                            <span className="font-mono text-xs bg-[#F4F4F2] px-1.5 py-0.5 rounded font-bold">{e.emp_code}</span>
                            <span>{e.name}</span>
                          </button>
                        ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Month / Year picker */}
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[#5A5A5A] text-xs font-semibold">Period</label>
              <select
                value={selYear}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  setSelYear(y);
                  if (y === CURRENT_YEAR && selMonth > CURRENT_MONTH) setSelMonth(CURRENT_MONTH);
                }}
                className="text-xs font-semibold text-[#1A1A1A] bg-white border border-[#E2E2DF] rounded-lg px-2 py-1 focus:outline-none focus:border-[#E5202E] cursor-pointer"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-6 gap-1">
              {MONTH_SHORT.map((name, i) => {
                const m = i + 1;
                const isFuture = selYear === CURRENT_YEAR && m > CURRENT_MONTH;
                const isSelected = selMonth === m;
                return (
                  <button
                    key={m}
                    disabled={isFuture}
                    onClick={() => setSelMonth(m)}
                    className={`py-1.5 rounded-lg text-xs font-semibold transition ${
                      isSelected
                        ? "bg-[#E5202E] text-white shadow-sm"
                        : isFuture
                        ? "bg-[#F4F4F2] text-[#C0C0C0] cursor-not-allowed"
                        : "bg-white border border-[#E2E2DF] text-[#5A5A5A] hover:border-[#E5202E]/40 hover:text-[#1A1A1A]"
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
        </GlassCard>

        {/* Loading state */}
        {loading && (
          <GlassCard className="p-6 space-y-5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-5 w-24" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <SkeletonRows rows={4} cols={1} />
              <SkeletonRows rows={4} cols={1} />
            </div>
            <SkeletonRows rows={6} cols={3} />
            <div className="flex justify-end"><Skeleton className="h-6 w-32" /></div>
          </GlassCard>
        )}

        {/* Error state */}
        {!loading && error && (
          <GlassCard className="p-6 text-center">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#DC2626]/10 flex items-center justify-center">
                <FileText size={18} className="text-[#DC2626]" />
              </div>
              <p className="text-[#1A1A1A] font-semibold text-sm">No payslip found</p>
              <p className="text-[#5A5A5A] text-xs max-w-xs">
                {MONTH_NAMES[selMonth - 1]} {selYear} payslip is not yet processed.
              </p>
            </div>
          </GlassCard>
        )}

        {/* Payslip document */}
        {!loading && payslip && (
          <div className="space-y-3">
            {/* Quick stats bar */}
            <div className="grid grid-cols-3 gap-3">
              <GlassCard className="p-3 text-center">
                <p className="text-[#5A5A5A] text-[10px] uppercase tracking-wide font-semibold mb-1">Earnings</p>
                <p className="text-[#1A1A1A] font-bold text-lg">₹{fmt(payslip.total_earnings)}</p>
              </GlassCard>
              <GlassCard className="p-3 text-center">
                <p className="text-[#5A5A5A] text-[10px] uppercase tracking-wide font-semibold mb-1">Deductions</p>
                <p className="text-[#DC2626] font-bold text-lg">−₹{fmt(payslip.total_deduction)}</p>
              </GlassCard>
              <GlassCard className="p-3 text-center">
                <p className="text-[#5A5A5A] text-[10px] uppercase tracking-wide font-semibold mb-1">Net pay</p>
                <p className="font-bold text-lg" style={{ color: "#E5202E" }}>₹{fmt(payslip.net_pay)}</p>
              </GlassCard>
            </div>

            {/* Admin: late / LD override (unlocked months only) */}
            {isAdmin && (
              <GlassCard className="p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#D97706]/10 flex items-center justify-center shrink-0">
                      <Clock size={14} className="text-[#D97706]" />
                    </div>
                    <div className="text-sm">
                      <p className="text-[#1A1A1A] font-semibold">Late &amp; LD</p>
                      <p className="text-[#5A5A5A] text-xs">
                        Late {payslip.late_days} · absent-equiv {payslip.absent_from_late} · LD ₹{fmt(payslip.ld)}
                      </p>
                    </div>
                  </div>
                  {payslip.status === "locked" ? (
                    <span className="text-[11px] text-[#5A5A5A]">Locked — frozen</span>
                  ) : (
                    <button
                      onClick={openOverride}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs bg-white border border-[#E2E2DF] text-[#1A1A1A] hover:bg-[#F4F4F2] rounded-lg transition font-medium press"
                    >
                      <Pencil size={13} /> Edit
                    </button>
                  )}
                </div>
              </GlassCard>
            )}

            {/* Payslip document */}
            <div className="overflow-x-auto">
              <PayslipDocument data={payslip} />
            </div>
          </div>
        )}

        {/* Copyright */}
        <p className="text-center text-white/40 text-xs pt-1">
          © {new Date().getFullYear()} {APP_META.copyrightHolder}
        </p>
      </div>

      {/* Late / LD override modal */}
      {ovOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-[#E2E2DF]">
            <div className="px-5 py-4 border-b border-[#E2E2DF] flex items-center justify-between">
              <h3 className="text-[#1A1A1A] font-semibold text-base flex items-center gap-2">
                <Clock size={16} className="text-[#D97706]" /> Override late / LD
              </h3>
              <button onClick={() => setOvOpen(false)} className="text-[#6B6B6B] hover:text-[#1A1A1A] transition"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-[#5A5A5A]">
                {MONTH_NAMES[selMonth - 1]} {selYear} · edits apply only before the month is locked.
                Changing absent-equivalent days reconciles leave coverage; leave the LD blank to auto-compute.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-semibold text-[#5A5A5A] mb-1.5 block">Absent-equivalent days</span>
                  <input type="number" min="0" step="0.5" value={ovAbsent} onChange={(e) => setOvAbsent(e.target.value)}
                    className="w-full bg-white border border-[#E2E2DF] rounded-xl px-3 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30" />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-[#5A5A5A] mb-1.5 block">LD amount (₹)</span>
                  <input type="number" min="0" step="0.01" value={ovLd} onChange={(e) => setOvLd(e.target.value)}
                    className="w-full bg-white border border-[#E2E2DF] rounded-xl px-3 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30" />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-semibold text-[#5A5A5A] mb-1.5 block">Reason <span className="text-[#E5202E]">*</span></span>
                <input value={ovReason} onChange={(e) => setOvReason(e.target.value)} placeholder="At least 4 characters"
                  className="w-full bg-white border border-[#E2E2DF] rounded-xl px-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#6B6B6B] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30" />
              </label>
              {ovError && <p className="text-xs text-[#DC2626]">{ovError}</p>}
            </div>
            <div className="px-5 py-4 border-t border-[#E2E2DF] flex items-center justify-end gap-2">
              <button onClick={() => setOvOpen(false)} className="px-4 py-2.5 text-sm bg-white border border-[#E2E2DF] text-[#5A5A5A] hover:bg-[#F4F4F2] rounded-xl transition font-medium">Cancel</button>
              <button onClick={submitOverride} disabled={ovSaving}
                className="flex items-center gap-2 px-6 py-2.5 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition font-semibold disabled:opacity-60">
                {ovSaving ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : "Save override"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
