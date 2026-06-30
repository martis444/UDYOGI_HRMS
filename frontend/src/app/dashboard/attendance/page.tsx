"use client";

import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from "react";
import GlassCard from "@/components/ui/GlassCard";
import { useAuth, isAdminRole } from "@/lib/auth";
import {
  apiGetAttendanceSummary,
  apiGetAttendanceDaily,
  apiDownloadAttendanceTemplate,
  apiAttendanceImportValidate,
  apiAttendanceImportCommit,
} from "@/lib/api";
import {
  Clock, Download, Upload, ChevronDown, ChevronRight,
  Search, CheckCircle, AlertTriangle, XCircle,
  FileText, Calendar, RefreshCw,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const ENTITIES = [
  { id: "UPPL",  label: "UPPL" },
  { id: "USAPL", label: "USAPL" },
  { id: "UAPL",  label: "UAPL" },
  { id: "UMPL",  label: "UMPL" },
];

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const NOW = new Date();
const CURRENT_YEAR  = NOW.getFullYear();
const CURRENT_MONTH = NOW.getMonth() + 1;
const START_YEAR    = 2023;
const PER_PAGE      = 50;

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return String(n);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AttendanceRow {
  emp_code:   string;
  sap_code:   string | null;
  name:       string;
  entity_id:  string;
  total_days: number | null;
  pay_days:   number | null;
  days_p:     number | null;
  days_a:     number | null;
  days_lwp:   number | null;
  days_wo:    number | null;
  days_cl:    number | null;
  days_pl:    number | null;
  days_sl:    number | null;
  days_h:     number | null;
  late_days:  number | null;
  ot_hours:   number;
  salary_flag: string | null;
  status:     string;
}

interface DailyRow {
  att_date:     string;
  first_in:     string | null;
  last_out:     string | null;
  hours_worked: number;
  ot_hours:     number;
  att_status:   string | null;
  source:       string | null;
  remarks:      string | null;
}

interface ValidateResult {
  total:           number;
  valid_count:     number;
  unmatched_count: number;
  warning_count:   number;
  valid:           unknown[];
  unmatched:       { row: number; uid: string; name: string; reason: string }[];
  warnings:        { row: number; emp_code: string; issues: string[] }[];
}

interface CommitResult {
  imported: number;
  skipped:  { emp_code: string; reason: string }[];
  codes:    string[];
  warnings?: { emp_code: string; message: string }[];
}

// ─── GlassCard ────────────────────────────────────────────────────────────────


// ─── DailyBreakdown (inline expand) ──────────────────────────────────────────

function DailyBreakdown({
  empCode, data, loading,
}: { empCode: string; data: DailyRow[] | undefined; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2">
        <div className="w-4 h-4 border-2 border-[#E5202E] border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-[#5A5A5A]">Loading daily data…</span>
      </div>
    );
  }
  if (!data || data.length === 0) {
    return (
      <p className="text-xs text-[#6B6B6B] py-2">
        No daily biometric data for {empCode} this month.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse min-w-[520px]">
        <thead>
          <tr className="text-[#5A5A5A] font-semibold uppercase tracking-wide text-[9px]">
            <th className="pr-4 py-1 text-left">Date</th>
            <th className="pr-4 py-1 text-left">First In</th>
            <th className="pr-4 py-1 text-left">Last Out</th>
            <th className="pr-4 py-1 text-right">Hours</th>
            <th className="pr-4 py-1 text-right">OT</th>
            <th className="pr-4 py-1 text-left">Status</th>
            <th className="py-1 text-left">Source</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.att_date} className="border-t border-[#E2E2DF]/40">
              <td className="pr-4 py-1 font-mono text-[#1A1A1A]">{d.att_date}</td>
              <td className="pr-4 py-1 text-[#5A5A5A]">{d.first_in ? d.first_in.slice(11, 16) : "—"}</td>
              <td className="pr-4 py-1 text-[#5A5A5A]">{d.last_out ? d.last_out.slice(11, 16) : "—"}</td>
              <td className="pr-4 py-1 text-right text-[#1A1A1A]">{d.hours_worked > 0 ? d.hours_worked.toFixed(1) : "—"}</td>
              <td className="pr-4 py-1 text-right text-[#5A5A5A]">{d.ot_hours > 0 ? d.ot_hours.toFixed(1) : "—"}</td>
              <td className="pr-4 py-1">
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                  d.att_status === "P" ? "bg-green-100 text-green-700"
                  : d.att_status === "A" ? "bg-red-100 text-red-700"
                  : "bg-[#F4F4F2] text-[#5A5A5A]"
                }`}>{d.att_status ?? "—"}</span>
              </td>
              <td className="py-1 text-[#6B6B6B]">{d.source ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AttendancePage() {
  const { user } = useAuth();
  const isAdmin  = isAdminRole(user);
  const canImport = user?.role === "super_admin" || user?.role === "entity_admin";

  // ── Period ──────────────────────────────────────────────────────────────────
  const [selYear,  setSelYear]  = useState(CURRENT_YEAR);
  const [selMonth, setSelMonth] = useState(CURRENT_MONTH);

  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = CURRENT_YEAR; y >= START_YEAR; y--) years.push(y);
    return years;
  }, []);

  // ── Entity filter ────────────────────────────────────────────────────────────
  const [selEntity, setSelEntity] = useState<string>("ALL");

  // ── Summary data ─────────────────────────────────────────────────────────────
  const [summaryRows,    setSummaryRows]    = useState<AttendanceRow[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError,   setSummaryError]   = useState<string | null>(null);

  // ── Search + pagination ──────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [page,   setPage]   = useState(1);

  // ── Daily breakdown (per row expand) ────────────────────────────────────────
  const [expandedCode, setExpandedCode] = useState<string | null>(null);
  const [dailyData,    setDailyData]    = useState<Record<string, DailyRow[]>>({});
  const [dailyLoading, setDailyLoading] = useState<string | null>(null);

  // ── Import wizard ────────────────────────────────────────────────────────────
  const [importOpen,     setImportOpen]     = useState(false);
  const [importStep,     setImportStep]     = useState(1);
  const [importEntity,   setImportEntity]   = useState<string>(
    () => (user?.role !== "super_admin" ? (user?.entity_id ?? "") : "")
  );
  const [importFile,     setImportFile]     = useState<File | null>(null);
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null);
  const [validating,     setValidating]     = useState(false);
  const [committing,     setCommitting]     = useState(false);
  const [commitResult,   setCommitResult]   = useState<CommitResult | null>(null);
  const [templateDl,     setTemplateDl]     = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Sync importEntity when entity tab changes
  useEffect(() => {
    if (selEntity !== "ALL") {
      setImportEntity(selEntity);
    } else if (user?.role !== "super_admin") {
      setImportEntity(user?.entity_id ?? "");
    }
  }, [selEntity, user]);

  // Remember the selected period/entity across navigation. Without this the tab
  // resets to the current month on every remount, which makes a different month's
  // data look like the import "disappeared".
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("att.period") || "{}");
      if (s.year)  setSelYear(s.year);
      if (s.month) setSelMonth(s.month);
      if (s.entity) setSelEntity(s.entity);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("att.period", JSON.stringify({ year: selYear, month: selMonth, entity: selEntity }));
    } catch { /* ignore */ }
  }, [selYear, selMonth, selEntity]);

  // ── Fetch summary ────────────────────────────────────────────────────────────
  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const entitiesToFetch =
        selEntity === "ALL"
          ? user?.role === "super_admin"
            ? ENTITIES.map((e) => e.id)
            : [user?.entity_id ?? ""]
          : [selEntity];

      const results = await Promise.all(
        entitiesToFetch.map(async (eid) => {
          const rows = await apiGetAttendanceSummary(selMonth, selYear, eid);
          return (rows as AttendanceRow[]).map((r) => ({ ...r, entity_id: eid }));
        })
      );
      setSummaryRows(results.flat());
      setPage(1);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setSummaryError(msg ?? "Failed to load attendance data");
      setSummaryRows([]);
    } finally {
      setSummaryLoading(false);
    }
  }, [selEntity, selMonth, selYear, user]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  // Clear daily cache when period changes
  useEffect(() => {
    setExpandedCode(null);
    setDailyData({});
  }, [selYear, selMonth]);

  // ── Filtered + paginated ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return summaryRows;
    return summaryRows.filter(
      (r) => r.emp_code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
    );
  }, [summaryRows, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const pageRows   = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  // ── Row expand → daily breakdown ─────────────────────────────────────────────
  const handleExpand = async (code: string) => {
    if (expandedCode === code) { setExpandedCode(null); return; }
    setExpandedCode(code);
    if (dailyData[code]) return;
    setDailyLoading(code);
    try {
      const from_date = toDateStr(selYear, selMonth, 1);
      const to_date   = toDateStr(selYear, selMonth, daysInMonth(selYear, selMonth));
      const rows = await apiGetAttendanceDaily(code, from_date, to_date);
      setDailyData((prev) => ({ ...prev, [code]: rows as DailyRow[] }));
    } catch {
      setDailyData((prev) => ({ ...prev, [code]: [] }));
    } finally {
      setDailyLoading(null);
    }
  };

  // ── Export CSV (client-side) ─────────────────────────────────────────────────
  const handleExportCsv = () => {
    const header = "SAP Code,Name,Entity,Total Days,Pay Days,P,A,LWP,WO,CL,PL,SL,H,LT,OT Hrs,Status\n";
    const body = filtered.map((r) =>
      [r.sap_code || r.emp_code, r.name, r.entity_id, r.total_days ?? "", r.pay_days ?? "",
       r.days_p ?? "", r.days_a ?? "", r.days_lwp ?? "", r.days_wo ?? "",
       r.days_cl ?? "", r.days_pl ?? "", r.days_sl ?? "", r.days_h ?? "", r.late_days ?? "",
       r.ot_hours, r.status].join(",")
    ).join("\n");
    const blob = new Blob([header + body], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `attendance_${selYear}_${String(selMonth).padStart(2, "0")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Import handlers ──────────────────────────────────────────────────────────
  const handleTemplateDownload = async () => {
    if (!importEntity) return;
    setTemplateDl(true);
    try {
      await apiDownloadAttendanceTemplate(selMonth, selYear, importEntity);
      setImportStep(2);
    } catch { /* browser shows download error */ }
    finally { setTemplateDl(false); }
  };

  const handleFile = (file: File) => {
    setImportFile(file);
    setValidateResult(null);
    setCommitResult(null);
    setImportStep((s) => Math.max(s, 2));  // downloading the template is optional
  };

  const handleValidate = async () => {
    if (!importFile || !importEntity) return;
    setValidating(true);
    try {
      const result = await apiAttendanceImportValidate(importFile, selYear, selMonth, importEntity);
      setValidateResult(result as ValidateResult);
      setImportStep(3);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(msg ?? "Validation failed. Check the file format and try again.");
    } finally {
      setValidating(false);
    }
  };

  const handleCommit = async () => {
    if (!validateResult || !importEntity) return;
    setCommitting(true);
    try {
      const result = await apiAttendanceImportCommit(selYear, selMonth, importEntity, validateResult.valid);
      setCommitResult(result as CommitResult);
      fetchSummary();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      alert(msg ?? "Commit failed.");
    } finally {
      setCommitting(false);
    }
  };

  const resetImport = () => {
    setImportStep(1);
    setImportFile(null);
    setValidateResult(null);
    setCommitResult(null);
  };

  if (!user) return null;

  const monthLabel   = `${MONTH_NAMES[selMonth - 1]} ${selYear}`;
  const showEntityCol = selEntity === "ALL" && isAdmin;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1400px] mx-auto">

      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#E5202E]/10 flex items-center justify-center shrink-0">
            <Clock size={18} className="text-[#E5202E]" />
          </div>
          <div>
            <h1 className="text-white font-semibold text-xl leading-tight">Attendance</h1>
            <p className="text-white/50 text-xs mt-0.5">{monthLabel}</p>
          </div>
        </div>
        <button
          onClick={fetchSummary}
          className="flex items-center gap-1.5 px-3.5 py-2 text-sm bg-white border border-[#E2E2DF] text-[#1A1A1A] hover:bg-[#F4F4F2] rounded-xl transition min-h-[44px] font-medium"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* ── SECTION 1: Controls ──────────────────────────────────────────────── */}
      <GlassCard className="p-4 space-y-4">
        {/* Month / year picker */}
        <div>
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
              {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-6 gap-1">
            {MONTH_SHORT.map((name, i) => {
              const m        = i + 1;
              const isFuture = selYear === CURRENT_YEAR && m > CURRENT_MONTH;
              const isSel    = selMonth === m;
              return (
                <button
                  key={m}
                  disabled={isFuture}
                  onClick={() => setSelMonth(m)}
                  className={`py-1.5 rounded-lg text-xs font-semibold transition ${
                    isSel    ? "bg-[#E5202E] text-white shadow-sm"
                    : isFuture ? "bg-[#F4F4F2] text-[#C0C0C0] cursor-not-allowed"
                    : "bg-white border border-[#E2E2DF] text-[#5A5A5A] hover:border-[#E5202E]/40 hover:text-[#1A1A1A]"
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Entity tabs (admin only) */}
        {isAdmin && (
          <div className="flex items-center gap-1 flex-wrap">
            {["ALL", ...ENTITIES.map((e) => e.id)].map((eid) => (
              <button
                key={eid}
                onClick={() => setSelEntity(eid)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition min-h-[36px] ${
                  selEntity === eid
                    ? "bg-[#E5202E] text-white shadow-sm"
                    : "bg-white border border-[#E2E2DF] text-[#5A5A5A] hover:border-[#E5202E]/40 hover:text-[#1A1A1A]"
                }`}
              >
                {eid}
              </button>
            ))}
          </div>
        )}
      </GlassCard>

      {/* ── SECTION 2: Summary table ─────────────────────────────────────────── */}
      <GlassCard>
        {/* Table toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 border-b border-[#E2E2DF]">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B6B6B] pointer-events-none" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by name or code…"
              className="w-full bg-white border border-[#E2E2DF] rounded-xl pl-9 pr-3 py-2 text-sm text-[#1A1A1A] placeholder:text-[#6B6B6B] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 min-h-[40px]"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[#5A5A5A] text-xs">{filtered.length} records</span>
            <button
              onClick={handleExportCsv}
              disabled={filtered.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-white border border-[#E2E2DF] text-[#1A1A1A] hover:bg-[#F4F4F2] rounded-xl transition min-h-[40px] disabled:opacity-40"
            >
              <Download size={13} />
              Export CSV
            </button>
          </div>
        </div>

        {/* Loading */}
        {summaryLoading && (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <div className="w-7 h-7 border-2 border-[#E5202E] border-t-transparent rounded-full animate-spin" />
              <p className="text-[#5A5A5A] text-sm">Loading attendance data…</p>
            </div>
          </div>
        )}

        {/* Error */}
        {!summaryLoading && summaryError && (
          <div className="p-10 text-center">
            <XCircle size={32} className="text-[#DC2626] mx-auto mb-2" />
            <p className="text-[#DC2626] text-sm font-semibold">{summaryError}</p>
            <p className="text-[#5A5A5A] text-xs mt-1">Only HR, entity admins, and managers can view attendance data.</p>
          </div>
        )}

        {/* Empty state */}
        {!summaryLoading && !summaryError && summaryRows.length === 0 && (
          <div className="p-12 text-center">
            <Calendar size={36} className="text-[#6B6B6B] mx-auto mb-3" />
            <p className="text-[#1A1A1A] font-semibold text-sm">No attendance data</p>
            <p className="text-[#5A5A5A] text-xs mt-1">
              No records found for {monthLabel}. Import attendance CSV below.
            </p>
          </div>
        )}

        {/* Table */}
        {!summaryLoading && !summaryError && summaryRows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-[#E2E2DF] bg-[#F9F9F7]">
                  <th className="text-left px-4 py-2.5 text-[9px] uppercase tracking-wide font-semibold text-[#5A5A5A] whitespace-nowrap">Emp Code</th>
                  <th className="text-left px-3 py-2.5 text-[9px] uppercase tracking-wide font-semibold text-[#5A5A5A]">Name</th>
                  {showEntityCol && (
                    <th className="text-left px-3 py-2.5 text-[9px] uppercase tracking-wide font-semibold text-[#5A5A5A]">Entity</th>
                  )}
                  <th className="text-center px-3 py-2.5 text-[9px] uppercase tracking-wide font-semibold text-[#5A5A5A] whitespace-nowrap">Days</th>
                  <th className="text-center px-3 py-2.5 text-[9px] uppercase tracking-wide font-semibold text-[#5A5A5A] whitespace-nowrap">Pay</th>
                  <th className="text-center px-2 py-2.5 text-[9px] font-bold text-green-700 bg-green-50/60">P</th>
                  <th className="text-center px-2 py-2.5 text-[9px] font-bold text-red-700 bg-red-50/60">A</th>
                  <th className="text-center px-2 py-2.5 text-[9px] font-bold text-orange-700 bg-orange-50/60">L</th>
                  <th className="text-center px-2 py-2.5 text-[9px] font-bold text-[#5A5A5A]">R</th>
                  <th className="text-center px-2 py-2.5 text-[9px] font-bold text-blue-700 bg-blue-50/60">C</th>
                  <th className="text-center px-2 py-2.5 text-[9px] font-bold text-blue-700 bg-blue-50/60">PL</th>
                  <th className="text-center px-2 py-2.5 text-[9px] font-bold text-blue-700 bg-blue-50/60">S</th>
                  <th className="text-center px-2 py-2.5 text-[9px] font-bold text-[#5A5A5A]">H</th>
                  <th className="text-center px-2 py-2.5 text-[9px] font-bold text-[#D97706] bg-amber-50/60">LT</th>
                  <th className="text-center px-2 py-2.5 text-[9px] uppercase tracking-wide font-semibold text-[#5A5A5A] whitespace-nowrap">OT Hrs</th>
                  <th className="text-left px-3 py-2.5 text-[9px] uppercase tracking-wide font-semibold text-[#5A5A5A]">Status</th>
                  <th className="px-3 py-2.5 w-8" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => {
                  const isExpanded = expandedCode === row.emp_code;
                  const colSpan = showEntityCol ? 17 : 16;
                  return (
                    <Fragment key={row.emp_code}>
                      <tr
                        className={`border-b border-[#E2E2DF]/50 hover:bg-[#F9F9F7] cursor-pointer transition ${isExpanded ? "bg-[#FFF5F5] hover:bg-[#FFF5F5]" : ""}`}
                        onClick={() => handleExpand(row.emp_code)}
                      >
                        <td className="px-4 py-2.5 font-mono text-xs font-bold text-[#1A1A1A] whitespace-nowrap">{row.emp_code}</td>
                        <td className="px-3 py-2.5 text-[#1A1A1A] font-medium whitespace-nowrap max-w-[180px] truncate">{row.name}</td>
                        {showEntityCol && (
                          <td className="px-3 py-2.5">
                            <span className="text-[9px] font-semibold bg-[#F4F4F2] border border-[#E2E2DF] px-1.5 py-0.5 rounded">{row.entity_id}</span>
                          </td>
                        )}
                        <td className="px-3 py-2.5 text-center text-xs text-[#5A5A5A]">{fmt(row.total_days)}</td>
                        <td className="px-3 py-2.5 text-center text-xs font-semibold text-[#1A1A1A]">{fmt(row.pay_days)}</td>
                        <td className="px-2 py-2.5 text-center text-xs text-green-700 font-semibold bg-green-50/30">{fmt(row.days_p)}</td>
                        <td className="px-2 py-2.5 text-center text-xs text-red-700 font-semibold bg-red-50/30">{fmt(row.days_a)}</td>
                        <td className="px-2 py-2.5 text-center text-xs text-orange-700 bg-orange-50/30">{fmt(row.days_lwp)}</td>
                        <td className="px-2 py-2.5 text-center text-xs text-[#5A5A5A]">{fmt(row.days_wo)}</td>
                        <td className="px-2 py-2.5 text-center text-xs text-blue-700 bg-blue-50/30">{fmt(row.days_cl)}</td>
                        <td className="px-2 py-2.5 text-center text-xs text-blue-700 bg-blue-50/30">{fmt(row.days_pl)}</td>
                        <td className="px-2 py-2.5 text-center text-xs text-blue-700 bg-blue-50/30">{fmt(row.days_sl)}</td>
                        <td className="px-2 py-2.5 text-center text-xs text-[#5A5A5A]">{fmt(row.days_h)}</td>
                        <td className="px-2 py-2.5 text-center text-xs text-[#D97706] bg-amber-50/30">{fmt(row.late_days)}</td>
                        <td className="px-2 py-2.5 text-center text-xs text-[#5A5A5A]">{row.ot_hours > 0 ? row.ot_hours.toFixed(1) : "—"}</td>
                        <td className="px-3 py-2.5">
                          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                            row.status === "locked"    ? "bg-[#1A1A1A]/10 text-[#1A1A1A]"
                            : row.status === "processed" ? "bg-green-100 text-green-700"
                            : "bg-amber-100 text-amber-700"
                          }`}>{row.status}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {isExpanded
                            ? <ChevronDown  size={13} className="text-[#E5202E] mx-auto" />
                            : <ChevronRight size={13} className="text-[#6B6B6B] mx-auto" />
                          }
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-[#FFF5F5]">
                          <td colSpan={colSpan} className="px-6 py-4">
                            <DailyBreakdown
                              empCode={row.emp_code}
                              data={dailyData[row.emp_code]}
                              loading={dailyLoading === row.emp_code}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!summaryLoading && totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#E2E2DF]">
            <span className="text-[#5A5A5A] text-xs">
              Page {page} of {totalPages} · {filtered.length} records
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs border border-[#E2E2DF] rounded-lg text-[#5A5A5A] hover:bg-[#F4F4F2] disabled:opacity-40 transition"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-xs border border-[#E2E2DF] rounded-lg text-[#5A5A5A] hover:bg-[#F4F4F2] disabled:opacity-40 transition"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </GlassCard>

      {/* ── SECTION 3: Import panel ──────────────────────────────────────────── */}
      {canImport && (
        <GlassCard>
          <button
            onClick={() => setImportOpen((o) => !o)}
            className="w-full flex items-center justify-between p-4 text-left"
          >
            <div className="flex items-center gap-2">
              <Upload size={16} className="text-[#E5202E]" />
              <span className="font-semibold text-[#1A1A1A] text-sm">Import Attendance CSV</span>
              {commitResult && (
                <span className="text-[9px] font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                  {commitResult.imported} imported
                </span>
              )}
            </div>
            <ChevronDown
              size={16}
              className={`text-[#5A5A5A] transition-transform ${importOpen ? "rotate-180" : ""}`}
            />
          </button>

          {importOpen && (
            <div className="border-t border-[#E2E2DF] p-4 space-y-4">

              {/* Target period — the import always lands in the Period selected above */}
              <div className="flex items-start gap-2 rounded-xl bg-[#E5202E]/[0.06] border border-[#E5202E]/20 p-3">
                <Clock size={14} className="text-[#E5202E] shrink-0 mt-0.5" />
                <p className="text-xs text-[#1A1A1A]">
                  Importing attendance for <span className="font-bold">{monthLabel}</span>.
                  This is the <span className="font-semibold">Period</span> selected at the top — change it there to target a different month.
                </p>
              </div>

              {/* Entity selector (super_admin + ALL tab only) */}
              {user?.role === "super_admin" && selEntity === "ALL" && (
                <div>
                  <label className="text-[#5A5A5A] text-xs font-semibold mb-1.5 block">Import for entity</label>
                  <select
                    value={importEntity}
                    onChange={(e) => setImportEntity(e.target.value)}
                    className="bg-white border border-[#E2E2DF] rounded-xl px-3 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 min-h-[44px]"
                  >
                    <option value="">— Select entity —</option>
                    {ENTITIES.map((e) => <option key={e.id} value={e.id}>{e.id}</option>)}
                  </select>
                </div>
              )}

              {/* Step indicator */}
              <div className="flex items-center">
                {["Download template", "Upload & validate", "Review & commit"].map((label, i) => {
                  const stepNum = i + 1;
                  const done    = importStep > stepNum;
                  const active  = importStep === stepNum;
                  return (
                    <div key={i} className="flex items-center flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition ${
                          done ? "bg-green-500 text-white" : active ? "bg-[#E5202E] text-white" : "bg-[#E2E2DF] text-[#6B6B6B]"
                        }`}>
                          {done ? <CheckCircle size={12} /> : stepNum}
                        </div>
                        <span className={`text-xs font-semibold whitespace-nowrap hidden sm:block ${active ? "text-[#1A1A1A]" : "text-[#6B6B6B]"}`}>
                          {label}
                        </span>
                      </div>
                      {i < 2 && <div className="flex-1 h-px bg-[#E2E2DF] mx-2 min-w-[8px]" />}
                    </div>
                  );
                })}
              </div>

              {/* Step 1: Download template */}
              <div className={`rounded-xl border p-4 transition ${importStep === 1 ? "border-[#E5202E]/30 bg-[#FFF5F5]" : "border-[#E2E2DF] bg-[#F9F9F7]"}`}>
                <p className="text-sm font-semibold text-[#1A1A1A] mb-1">Step 1 — Download template <span className="font-normal text-[#6B6B6B]">(optional)</span></p>
                <p className="text-xs text-[#5A5A5A] mb-3">
                  Pre-fills all active employees&apos; SAP codes + {daysInMonth(selYear, selMonth)} total days for {monthLabel}.
                  Fill in attendance columns, then upload below. Already have your own file? Skip straight to Step 2.
                </p>
                <p className="text-xs text-[#5A5A5A] mb-3">
                  Optional <span className="font-semibold">Other Earning</span> / <span className="font-semibold">Other Deduction</span> columns
                  let you add a one-off reward or penalty for that month (earning adds to net, deduction cuts it). Leave blank for none.
                </p>
                <button
                  onClick={handleTemplateDownload}
                  disabled={templateDl || !importEntity}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition min-h-[40px] disabled:opacity-60"
                >
                  <Download size={14} />
                  {templateDl ? "Generating…" : "Download template"}
                </button>
                {!importEntity && (
                  <p className="text-xs text-amber-600 mt-2">Select an entity above to download the template.</p>
                )}
              </div>

              {/* Step 2: Upload + validate — always available (template download is optional) */}
              {importStep <= 3 && (
                <div className={`rounded-xl border p-4 space-y-3 transition ${importStep === 2 ? "border-[#E5202E]/30 bg-[#FFF5F5]" : "border-[#E2E2DF] bg-[#F9F9F7]"}`}>
                  <p className="text-sm font-semibold text-[#1A1A1A]">Step 2 — Upload & validate</p>

                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition ${
                      dragOver ? "border-[#E5202E] bg-[#E5202E]/5" : "border-[#E2E2DF] hover:border-[#E5202E]/40"
                    }`}
                  >
                    <Upload size={22} className="mx-auto mb-2 text-[#6B6B6B]" />
                    {importFile ? (
                      <p className="text-sm font-semibold text-[#1A1A1A]">{importFile.name}</p>
                    ) : (
                      <>
                        <p className="text-sm text-[#5A5A5A]">
                          Drag & drop a file or <span className="text-[#E5202E] font-semibold">click to browse</span>
                        </p>
                        <p className="text-xs text-[#6B6B6B] mt-1">.csv or .xlsx</p>
                      </>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                    />
                  </div>

                  <button
                    onClick={handleValidate}
                    disabled={!importFile || validating}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition min-h-[40px] disabled:opacity-60"
                  >
                    <CheckCircle size={14} />
                    {validating ? "Validating…" : "Validate"}
                  </button>
                </div>
              )}

              {/* Step 3: Preview + commit */}
              {importStep >= 3 && validateResult && (
                <div className={`rounded-xl border p-4 space-y-3 transition ${importStep === 3 ? "border-[#E5202E]/30 bg-[#FFF5F5]" : "border-[#E2E2DF]"}`}>
                  <p className="text-sm font-semibold text-[#1A1A1A]">Step 3 — Review & commit</p>

                  {/* Summary badges */}
                  <div className="flex flex-wrap gap-2">
                    <span className="flex items-center gap-1 text-xs font-semibold bg-green-100 text-green-700 px-2.5 py-1 rounded-full">
                      <CheckCircle size={12} /> {validateResult.valid_count} valid
                    </span>
                    {validateResult.warning_count > 0 && (
                      <span className="flex items-center gap-1 text-xs font-semibold bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full">
                        <AlertTriangle size={12} /> {validateResult.warning_count} warnings
                      </span>
                    )}
                    {validateResult.unmatched_count > 0 && (
                      <span className="flex items-center gap-1 text-xs font-semibold bg-red-100 text-red-700 px-2.5 py-1 rounded-full">
                        <XCircle size={12} /> {validateResult.unmatched_count} unmatched
                      </span>
                    )}
                  </div>

                  {/* Unmatched codes list (skipped) */}
                  {validateResult.unmatched.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-3 max-h-40 overflow-y-auto">
                      <p className="text-xs font-semibold text-red-700 mb-2">Unmatched rows (will be skipped):</p>
                      <ul className="space-y-1">
                        {validateResult.unmatched.map((u, i) => (
                          <li key={i} className="text-xs text-red-700">
                            Row {u.row}:{" "}
                            <span className="font-mono font-bold">{u.uid || "(blank)"}</span>
                            {u.name ? ` — ${u.name}` : ""} · {u.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Warnings list (still imported, but flagged) */}
                  {validateResult.warnings.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 max-h-40 overflow-y-auto">
                      <p className="text-xs font-semibold text-amber-700 mb-2">Warnings (these rows will still be imported):</p>
                      <ul className="space-y-1">
                        {validateResult.warnings.map((w, i) => (
                          <li key={i} className="text-xs text-amber-700">
                            Row {w.row}:{" "}
                            <span className="font-mono font-bold">{w.emp_code}</span> · {w.issues.join("; ")}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {commitResult ? (
                    <div className="flex items-start gap-2 bg-green-50 border border-green-200 rounded-xl p-3">
                      <CheckCircle size={16} className="text-green-600 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-green-700">{commitResult.imported} employees updated for {monthLabel}</p>
                        {commitResult.skipped.length > 0 && (
                          <p className="text-xs text-green-600">{commitResult.skipped.length} skipped (payroll locked)</p>
                        )}
                        {commitResult.warnings && commitResult.warnings.length > 0 && (
                          <div className="mt-2 border-t border-green-200 pt-2">
                            <p className="text-xs font-semibold text-[#D97706]">Approved leaves kept ({commitResult.warnings.length}):</p>
                            <ul className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                              {commitResult.warnings.map((w, i) => (
                                <li key={i} className="text-[11px] text-[#92400E]">{w.message}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={resetImport}
                        className="text-xs text-[#5A5A5A] hover:text-[#1A1A1A] flex items-center gap-1 shrink-0"
                      >
                        <RefreshCw size={11} /> New import
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleCommit}
                        disabled={committing || validateResult.valid_count === 0}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition min-h-[40px] disabled:opacity-60"
                      >
                        {committing ? "Committing…" : `Commit ${validateResult.valid_count} rows`}
                      </button>
                      <button
                        onClick={resetImport}
                        className="text-xs text-[#5A5A5A] hover:text-[#1A1A1A] flex items-center gap-1 min-h-[40px]"
                      >
                        <RefreshCw size={11} /> Start over
                      </button>
                    </div>
                  )}
                </div>
              )}

            </div>
          )}
        </GlassCard>
      )}

      {/* ── SECTION 4: Payroll integration notice ───────────────────────────── */}
      {summaryRows.length > 0 && (
        <div className="flex items-start gap-3 bg-blue-50/80 border border-blue-200 rounded-2xl p-4">
          <FileText size={15} className="text-blue-500 mt-0.5 shrink-0" />
          <p className="text-sm text-blue-700">
            Attendance data for <strong>{monthLabel}</strong> is available.
            Run payroll from the <strong>Payslip</strong> section to calculate salaries based on pay days.
          </p>
        </div>
      )}

    </div>
  );
}
