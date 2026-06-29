"use client";

import { useState, useEffect, useCallback, use } from "react";
import GlassCard from "@/components/ui/GlassCard";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  apiGetEmployee, apiGetFormOptions, apiUpdateEmployee, apiDeleteEmployee,
  apiGetPayslip, apiDownloadPayslipPdf, apiGetActiveLocations,
  apiGetSalaryHistory, type SalaryStructureRow,
} from "@/lib/api";
import SalaryHistoryTable from "@/components/salary/SalaryHistoryTable";
import { entityColor } from "@/lib/entities";
import { useAuth, isAdminRole } from "@/lib/auth";
import {
  ChevronLeft, Edit2, Trash2, FileText, Download,
  IndianRupee, AlertCircle, CheckCircle2, Loader2,
  History, ArrowRight,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Emp {
  emp_code: string; legacy_code?: string; sap_code?: string; name: string; father_name?: string;
  dob?: string; gender?: string; marital_status?: string; blood_group?: string;
  religion?: string; mobile: string; email?: string; doj: string;
  entity_id: string; location_id: string; department_id?: number;
  division?: string; designation?: string; grade_id?: number;
  reporting_mgr_code?: string; shift_id?: number;
  category?: string;
  ctc_annual?: string; basic?: string; hra?: string;
  spl?: string; cca?: string; leave_travel?: string; monthly_gross?: string;
  medical?: string; other_earning?: string; other_allowance?: string;
  profit_center_code?: string; profit_center_name?: string;
  cost_center_code?: string; cost_center_name?: string;
  pf_applicable?: boolean; esic_applicable?: boolean; pt_applicable?: boolean;
  pan?: string; aadhaar?: string; uan?: string; esic_no?: string;
  bank_name?: string; bank_acc?: string; ifsc?: string;
  present_addr?: string; perm_addr?: string;
  confirmation_date?: string;
  status?: string; exit_date?: string; resignation_date?: string; retirement_date?: string;
  created_at?: string; updated_at?: string;
}

interface FormOptions {
  entities: { id: string; name: string; prefix: string }[];
  locations: { id: string; city: string; state: string; entity_id: string }[];
  departments: { id: number; name: string; entity_id: string }[];
  grades: { id: number; code: string; name: string; entity_id: string }[];
  shifts: { id: number; name: string; in_time: string; out_time: string; entity_id: string }[];
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status?: string }) {
  const s = (status ?? "").toLowerCase();
  const cls = s === "active" ? "bg-[#16A34A]/10 text-[#16A34A]"
    : s === "inactive" ? "bg-[#5A5A5A]/10 text-[#5A5A5A]"
    : s === "exited" ? "bg-[#DC2626]/10 text-[#DC2626]"
    : "bg-[#F4F4F2] text-[#6B6B6B]";
  const dotCls = s === "active" ? "bg-[#16A34A]" : s === "inactive" ? "bg-[#5A5A5A]" : "bg-[#DC2626]";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${cls}`}>
      {status && <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />}
      {status ?? "—"}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 py-3.5 border-b border-[#E2E2DF] bg-[#F4F4F2]/60">
      <h2 className="text-[#1A1A1A] font-semibold text-sm">{children}</h2>
    </div>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value?: string | null | boolean; mono?: boolean }) {
  const display = value === null || value === undefined || value === "" ? "—"
    : typeof value === "boolean" ? (value ? "Yes" : "No") : value;
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`text-sm text-[#1A1A1A] break-words ${mono ? "font-mono" : ""}`}>{String(display)}</p>
    </div>
  );
}

const INPUT = "w-full bg-white border border-[#E2E2DF] rounded-xl px-3 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 placeholder:text-[#6B6B6B]";
const SELECT = `${INPUT} appearance-none cursor-pointer`;

function EditField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[#5A5A5A] mb-1.5">
        {label}{required && <span className="text-[#E5202E] ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmployeeDetailPage({ params }: { params: Promise<{ emp_code: string }> }) {
  const { emp_code } = use(params);
  const router = useRouter();
  const { user } = useAuth();

  const [emp, setEmp] = useState<Emp | null>(null);
  const [opts, setOpts] = useState<FormOptions | null>(null);
  const [activeLocations, setActiveLocations] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<Emp>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveOk, setSaveOk] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Payslip state
  const [psYear, setPsYear] = useState(new Date().getFullYear());
  const [psMonth, setPsMonth] = useState(new Date().getMonth() + 1);
  const [psData, setPsData] = useState<Record<string, unknown> | null>(null);
  const [psLoading, setPsLoading] = useState(false);
  const [psError, setPsError] = useState("");

  // Salary history (read-only — increments are applied from the Payroll tab)
  const [salHistory, setSalHistory] = useState<SalaryStructureRow[]>([]);
  const [salLoading, setSalLoading] = useState(true);

  const isAdmin = isAdminRole(user);

  const loadSalaryHistory = useCallback(() => {
    setSalLoading(true);
    apiGetSalaryHistory(emp_code)
      .then((d) => setSalHistory(d.structures))
      .catch(() => setSalHistory([]))
      .finally(() => setSalLoading(false));
  }, [emp_code]);

  useEffect(() => { loadSalaryHistory(); }, [loadSalaryHistory]);

  // Load employee + form options + active locations
  useEffect(() => {
    Promise.all([
      apiGetEmployee(emp_code),
      apiGetFormOptions(),
      apiGetActiveLocations(),
    ])
      .then(([e, o, loc]) => { setEmp(e); setOpts(o); setEditForm(e); setActiveLocations(loc.locations); })
      .catch(() => router.replace("/dashboard/employees"))
      .finally(() => setLoading(false));
  }, [emp_code, router]);

  const setEditField = useCallback((field: keyof Emp, value: string | boolean) => {
    setEditForm((f) => ({ ...f, [field]: value }));
  }, []);

  // Gross live calc in edit mode
  const editGross = ["basic", "hra", "spl", "cca", "leave_travel"].reduce((acc, k) => {
    const v = parseFloat(String(editForm[k as keyof Emp] ?? ""));
    return acc + (isNaN(v) ? 0 : v);
  }, 0);

  const handleSave = async () => {
    setSaving(true);
    setSaveError("");
    setSaveOk(false);
    try {
      // Build update body (omit emp_code, nullify empties to skip)
      const body: Record<string, unknown> = {};
      const intFields = ["department_id", "grade_id", "shift_id"] as (keyof Emp)[];
      const numFields = ["basic", "hra", "spl", "cca", "leave_travel", "ctc_annual",
        "medical", "other_earning"] as (keyof Emp)[];
      // Never sent: immutable, computed, derived columns. pf_applicable &
      // esic_applicable ARE editable (the statutory-deduction toggles below);
      // pt_applicable stays auto. retirement_date is derived (DOB+60).
      const skip = new Set(["emp_code", "entity_id", "monthly_gross", "retirement_date",
        "pt_applicable"]);
      for (const [k, v] of Object.entries(editForm)) {
        if (skip.has(k)) continue;
        if (v === "" || v === null || v === undefined) continue; // skip blank
        if (intFields.includes(k as keyof Emp)) {
          body[k] = parseInt(String(v));
        } else if (numFields.includes(k as keyof Emp)) {
          body[k] = v;
        } else {
          body[k] = v;
        }
      }
      const updated = await apiUpdateEmployee(emp_code, body);
      setEmp(updated);
      setEditForm(updated);
      setSaveOk(true);
      setEditing(false);
      setTimeout(() => setSaveOk(false), 3000);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setSaveError(typeof msg === "string" ? msg : "Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiDeleteEmployee(emp_code);
      router.push("/dashboard/employees");
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const loadPayslip = async () => {
    setPsLoading(true);
    setPsError("");
    setPsData(null);
    try {
      const d = await apiGetPayslip(emp_code, psYear, psMonth);
      setPsData(d);
    } catch {
      setPsError("No payslip found for this period.");
    } finally {
      setPsLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="text-[#E5202E] animate-spin" />
      </div>
    );
  }
  if (!emp) return null;

  const entColor = entityColor(emp.entity_id);
  const filteredLocations = activeLocations;
  const filteredDepts = opts?.departments.filter((d) => d.entity_id === emp.entity_id) ?? [];
  const filteredGrades = opts?.grades.filter((g) => g.entity_id === emp.entity_id) ?? [];
  const filteredShifts = opts?.shifts.filter((s) => s.entity_id === emp.entity_id) ?? [];

  // Resolve FK ids to human-readable names for the view-mode display (fall back to the id).
  const deptName = opts?.departments.find((d) => d.id === emp.department_id)?.name
    ?? (emp.department_id != null ? String(emp.department_id) : undefined);
  const gradeName = (() => {
    const g = opts?.grades.find((g) => g.id === emp.grade_id);
    return g ? (g.name ? `${g.code} — ${g.name}` : g.code) : (emp.grade_id != null ? String(emp.grade_id) : undefined);
  })();
  const shiftName = opts?.shifts.find((s) => s.id === emp.shift_id)?.name
    ?? (emp.shift_id != null ? String(emp.shift_id) : undefined);
  const locName = activeLocations.find((l) => l.id === emp.location_id)?.name ?? emp.location_id;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto pb-10 space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Link href="/dashboard/employees" className="flex items-center gap-1 text-[#5A5A5A] hover:text-[#1A1A1A] text-sm transition">
          <ChevronLeft size={16} />
          Employees
        </Link>
        <span className="text-[#E2E2DF]">/</span>
        <span className="font-mono text-sm text-[#1A1A1A] font-bold">{emp.emp_code}</span>
      </div>

      {/* Header card */}
      <GlassCard className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-bold shrink-0"
              style={{ backgroundColor: entColor }}
            >
              {emp.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h1 className="text-white font-semibold text-xl leading-tight">{emp.name}</h1>
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <span className="font-mono text-xs font-bold bg-[#F4F4F2] px-2 py-0.5 rounded-lg text-[#1A1A1A]">
                  {emp.emp_code}
                </span>
                <span
                  className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: `${entColor}18`, color: entColor }}
                >
                  {emp.entity_id}
                </span>
                <StatusBadge status={emp.status} />
              </div>
              {emp.designation && (
                <p className="text-[#5A5A5A] text-sm mt-1">{emp.designation}</p>
              )}
            </div>
          </div>

          {isAdmin && !editing && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => { setEditing(true); setSaveOk(false); setSaveError(""); }}
                className="flex items-center gap-1.5 px-3.5 py-2 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition shadow-sm font-semibold min-h-[40px]"
              >
                <Edit2 size={13} />
                Edit
              </button>
            </div>
          )}
        </div>

        {/* Metadata row */}
        <div className="mt-4 pt-4 border-t border-[#E2E2DF] grid grid-cols-2 sm:grid-cols-4 gap-3">
          <InfoRow label="DOJ" value={emp.doj} />
          <InfoRow label="Mobile" value={emp.mobile} />
          <InfoRow label="Monthly gross" value={emp.monthly_gross ? `₹${parseFloat(emp.monthly_gross).toLocaleString("en-IN")}` : undefined} />
          <InfoRow label="PF applicable" value={emp.pf_applicable} />
          <InfoRow label="ESIC applicable" value={emp.esic_applicable} />
        </div>
      </GlassCard>

      {/* Feedback */}
      {saveOk && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-[#16A34A]/8 border border-[#16A34A]/20 text-[#16A34A] text-sm">
          <CheckCircle2 size={15} />
          Changes saved successfully.
        </div>
      )}
      {saveError && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-[#DC2626]/8 border border-[#DC2626]/20 text-[#DC2626] text-sm">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          {saveError}
        </div>
      )}

      {/* ── View mode ── */}
      {!editing && (
        <>
          {/* Personal */}
          <GlassCard>
            <SectionTitle>Personal information</SectionTitle>
            <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
              <InfoRow label="Father's name" value={emp.father_name} />
              <InfoRow label="Date of birth" value={emp.dob} />
              <InfoRow label="Gender" value={emp.gender} />
              <InfoRow label="Marital status" value={emp.marital_status} />
              <InfoRow label="Blood group" value={emp.blood_group} />
              <InfoRow label="Religion" value={emp.religion} />
              <InfoRow label="Email" value={emp.email} />
              {emp.legacy_code && <InfoRow label="Legacy code" value={emp.legacy_code} mono />}
              {emp.sap_code && <InfoRow label="SAP code" value={emp.sap_code} mono />}
            </div>
          </GlassCard>

          {/* Org */}
          <GlassCard>
            <SectionTitle>Organisation</SectionTitle>
            <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
              <InfoRow label="Location" value={locName} />
              <InfoRow label="Department" value={deptName} />
              <InfoRow label="Designation" value={emp.designation} />
              <InfoRow label="Division" value={emp.division} />
              <InfoRow label="Grade" value={gradeName} />
              <InfoRow label="Shift" value={shiftName} />
              <InfoRow label="Reporting manager" value={emp.reporting_mgr_code} mono />
              <InfoRow label="Category" value={emp.category} />
              <InfoRow label="Confirmation date" value={emp.confirmation_date} />
              <InfoRow label="Profit center code" value={emp.profit_center_code} />
              <InfoRow label="Profit center name" value={emp.profit_center_name} />
              <InfoRow label="Cost center code" value={emp.cost_center_code} />
              <InfoRow label="Cost center name" value={emp.cost_center_name} />
            </div>
          </GlassCard>

          {/* Salary */}
          <GlassCard>
            <SectionTitle>Salary</SectionTitle>
            <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
              {(["basic", "hra", "spl", "cca", "leave_travel", "ctc_annual", "medical", "other_earning"] as (keyof Emp)[]).map((f) => (
                <InfoRow key={f} label={f === "leave_travel" ? "LTA" : f === "other_earning" ? "Other earning" : f.toUpperCase().replace("_", " ")} value={emp[f] ? `₹${parseFloat(String(emp[f])).toLocaleString("en-IN")}` : undefined} />
              ))}
            </div>
          </GlassCard>

          {/* Statutory */}
          <GlassCard>
            <SectionTitle>Statutory IDs & banking</SectionTitle>
            <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
              <InfoRow label="PAN" value={emp.pan} mono />
              <InfoRow label="Aadhaar" value={emp.aadhaar} mono />
              <InfoRow label="UAN" value={emp.uan} mono />
              <InfoRow label="ESIC number" value={emp.esic_no} mono />
              <InfoRow label="Bank name" value={emp.bank_name} />
              <InfoRow label="Account" value={emp.bank_acc} mono />
              <InfoRow label="IFSC" value={emp.ifsc} mono />
            </div>
          </GlassCard>

          {/* Address */}
          <GlassCard>
            <SectionTitle>Address</SectionTitle>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-wide mb-2">Present</p>
                <p className="text-sm text-[#1A1A1A]">{emp.present_addr || "—"}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-wide mb-2">Permanent</p>
                <p className="text-sm text-[#1A1A1A]">{emp.perm_addr || "—"}</p>
              </div>
            </div>
          </GlassCard>
        </>
      )}

      {/* ── Edit mode ── */}
      {editing && (
        <div className="space-y-4">
          {/* Personal */}
          <GlassCard>
            <SectionTitle>Personal information</SectionTitle>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <EditField label="Full name" required>
                <input required value={editForm.name ?? ""} onChange={(e) => setEditField("name", e.target.value)} className={INPUT} />
              </EditField>
              <EditField label="SAP code">
                <input value={editForm.sap_code ?? ""} onChange={(e) => setEditField("sap_code", e.target.value)} placeholder="SAP employee code" className={INPUT} />
              </EditField>
              <EditField label="Mobile">
                <input value={editForm.mobile ?? ""} onChange={(e) => setEditField("mobile", e.target.value)} maxLength={10} className={INPUT} />
              </EditField>
              <EditField label="Email">
                <input type="email" value={editForm.email ?? ""} onChange={(e) => setEditField("email", e.target.value)} className={INPUT} />
              </EditField>
              <EditField label="Date of joining">
                <input type="date" value={editForm.doj ?? ""} onChange={(e) => setEditField("doj", e.target.value)} className={INPUT} />
              </EditField>
              <EditField label="Date of birth">
                <input type="date" value={editForm.dob ?? ""} onChange={(e) => setEditField("dob", e.target.value)} className={INPUT} />
              </EditField>
              <EditField label="Gender">
                <select value={editForm.gender ?? ""} onChange={(e) => setEditField("gender", e.target.value)} className={SELECT}>
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </EditField>
              <EditField label="Father's name">
                <input value={editForm.father_name ?? ""} onChange={(e) => setEditField("father_name", e.target.value)} className={INPUT} />
              </EditField>
              <EditField label="Marital status">
                <select value={editForm.marital_status ?? ""} onChange={(e) => setEditField("marital_status", e.target.value)} className={SELECT}>
                  <option value="">Select</option>
                  <option value="single">Single</option>
                  <option value="married">Married</option>
                  <option value="divorced">Divorced</option>
                  <option value="widowed">Widowed</option>
                </select>
              </EditField>
            </div>
          </GlassCard>

          {/* Org */}
          <GlassCard>
            <SectionTitle>Organisation</SectionTitle>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <EditField label="Location" required>
                <select value={editForm.location_id ?? ""} onChange={(e) => setEditField("location_id", e.target.value)} className={SELECT}>
                  <option value="">Select</option>
                  {filteredLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </EditField>
              <EditField label="Department">
                <select value={String(editForm.department_id ?? "")} onChange={(e) => setEditField("department_id", e.target.value)} className={SELECT}>
                  <option value="">Select</option>
                  {filteredDepts.map((d) => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
                </select>
              </EditField>
              <EditField label="Designation">
                <input value={editForm.designation ?? ""} onChange={(e) => setEditField("designation", e.target.value)} className={INPUT} />
              </EditField>
              <EditField label="Division">
                <input value={editForm.division ?? ""} onChange={(e) => setEditField("division", e.target.value)} className={INPUT} />
              </EditField>
              <EditField label="Grade">
                <select value={String(editForm.grade_id ?? "")} onChange={(e) => setEditField("grade_id", e.target.value)} className={SELECT}>
                  <option value="">Select</option>
                  {filteredGrades.map((g) => <option key={g.id} value={String(g.id)}>{g.code}{g.name ? ` — ${g.name}` : ""}</option>)}
                </select>
              </EditField>
              <EditField label="Shift">
                <select value={String(editForm.shift_id ?? "")} onChange={(e) => setEditField("shift_id", e.target.value)} className={SELECT}>
                  <option value="">Select</option>
                  {filteredShifts.map((s) => <option key={s.id} value={String(s.id)}>{s.name} ({s.in_time.slice(0,5)}–{s.out_time.slice(0,5)})</option>)}
                </select>
              </EditField>
              <EditField label="Reporting manager code">
                <input value={editForm.reporting_mgr_code ?? ""} onChange={(e) => setEditField("reporting_mgr_code", e.target.value)} className={INPUT} />
              </EditField>
              <EditField label="Category">
                <select value={editForm.category ?? "staff"} onChange={(e) => setEditField("category", e.target.value)} className={SELECT}>
                  <option value="director">Director</option>
                  <option value="staff">Staff</option>
                  <option value="worker">Worker</option>
                </select>
              </EditField>
              <EditField label="Profit center code">
                <input value={editForm.profit_center_code ?? ""} onChange={(e) => setEditField("profit_center_code", e.target.value)} className={INPUT} />
              </EditField>
              <EditField label="Profit center name">
                <input value={editForm.profit_center_name ?? ""} onChange={(e) => setEditField("profit_center_name", e.target.value)} className={INPUT} />
              </EditField>
              <EditField label="Cost center code">
                <input value={editForm.cost_center_code ?? ""} onChange={(e) => setEditField("cost_center_code", e.target.value)} className={INPUT} />
              </EditField>
              <EditField label="Cost center name">
                <input value={editForm.cost_center_name ?? ""} onChange={(e) => setEditField("cost_center_name", e.target.value)} className={INPUT} />
              </EditField>
              <EditField label="Status">
                <select value={editForm.status ?? ""} onChange={(e) => setEditField("status", e.target.value)} className={SELECT}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="exited">Exited</option>
                </select>
              </EditField>
              <EditField label="Confirmation date (CL/SL accrual starts after)">
                <input type="date" value={editForm.confirmation_date ?? ""} onChange={(e) => setEditField("confirmation_date", e.target.value)} className={INPUT} />
              </EditField>
              <EditField label="Resignation date">
                <input type="date" value={editForm.resignation_date ?? ""} onChange={(e) => setEditField("resignation_date", e.target.value)} className={INPUT} />
              </EditField>
              <EditField label="Retirement date (auto = DOB + 60y)">
                <input type="date" value={editForm.retirement_date ?? ""} readOnly disabled className={`${INPUT} opacity-60`} />
              </EditField>
            </div>
          </GlassCard>

          {/* Salary */}
          <GlassCard>
            <SectionTitle>Salary</SectionTitle>
            <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
              {(["basic", "hra", "spl", "cca", "leave_travel"] as (keyof Emp)[]).map((f) => (
                <EditField key={f} label={f === "leave_travel" ? "LTA" : String(f).toUpperCase()}>
                  <div className="relative">
                    <IndianRupee size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B6B6B]" />
                    <input type="number" min="0" step="0.01" value={String(editForm[f] ?? "")} onChange={(e) => setEditField(f, e.target.value)} className={`${INPUT} pl-7`} />
                  </div>
                </EditField>
              ))}
              <EditField label="CTC annual">
                <div className="relative">
                  <IndianRupee size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B6B6B]" />
                  <input type="number" min="0" step="0.01" value={String(editForm.ctc_annual ?? "")} onChange={(e) => setEditField("ctc_annual", e.target.value)} className={`${INPUT} pl-7`} />
                </div>
              </EditField>
              {([
                { key: "medical" as const, label: "Medical" },
                { key: "other_earning" as const, label: "Other earning (paid)" },
              ]).map(({ key, label }) => (
                <EditField key={key} label={label}>
                  <div className="relative">
                    <IndianRupee size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B6B6B]" />
                    <input type="number" min="0" step="0.01" value={String(editForm[key] ?? "")} onChange={(e) => setEditField(key, e.target.value)} className={`${INPUT} pl-7`} />
                  </div>
                </EditField>
              ))}
            </div>
            <div className="px-5 pb-5">
              <div className="flex items-center gap-2 p-3 rounded-xl bg-[#E5202E]/6 border border-[#E5202E]/15">
                <IndianRupee size={14} className="text-[#E5202E]" />
                <span className="text-sm text-[#1A1A1A]">Monthly gross</span>
                <span className="ml-auto font-bold text-[#1A1A1A]">
                  ₹{editGross.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </GlassCard>

          {/* Statutory deductions */}
          <GlassCard>
            <SectionTitle>Statutory deductions</SectionTitle>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[#E2E2DF] cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-[#1A1A1A]">Provident Fund (PF)</p>
                  <p className="text-xs text-[#6B6B6B]">Deduct employee PF — 12% of basic, cap ₹1,800</p>
                </div>
                <input
                  type="checkbox"
                  checked={editForm.pf_applicable ?? true}
                  onChange={(e) => setEditField("pf_applicable", e.target.checked)}
                  className="w-5 h-5 accent-[#E5202E] shrink-0"
                />
              </label>
              <label className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[#E2E2DF] cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-[#1A1A1A]">ESIC</p>
                  <p className="text-xs text-[#6B6B6B]">Deduct ESIC — 0.75%, only if gross ≤ ₹21,000</p>
                </div>
                <input
                  type="checkbox"
                  checked={editForm.esic_applicable ?? true}
                  onChange={(e) => setEditField("esic_applicable", e.target.checked)}
                  className="w-5 h-5 accent-[#E5202E] shrink-0"
                />
              </label>
            </div>
            <p className="px-5 pb-5 text-xs text-[#6B6B6B]">
              Turn a deduction off only for genuinely exempt employees — PF/ESIC are statutory for eligible
              staff. ESIC never applies above ₹21,000 gross regardless of this switch.
            </p>
          </GlassCard>

          {/* Edit actions */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => { setEditing(false); setEditForm(emp); setSaveError(""); }}
              className="px-4 py-2.5 text-sm bg-white border border-[#E2E2DF] text-[#5A5A5A] hover:bg-[#F4F4F2] rounded-xl transition font-medium min-h-[44px]"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition shadow-sm font-semibold min-h-[44px] disabled:opacity-60"
            >
              {saving ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : "Save changes"}
            </button>
          </div>
        </div>
      )}

      {/* ── Salary history ── */}
      <GlassCard>
        <div className="px-5 py-3.5 border-b border-[#E2E2DF] bg-[#F4F4F2]/60">
          <h2 className="text-[#1A1A1A] font-semibold text-sm flex items-center gap-2">
            <History size={15} className="text-[#5A5A5A]" />
            Salary history
          </h2>
        </div>
        <div className="p-5">
          <SalaryHistoryTable structures={salHistory} loading={salLoading} />
          {isAdmin && (
            <div className="mt-4 pt-3 border-t border-[#F0F0EE]">
              <Link
                href={`/dashboard/payroll?emp=${emp_code}`}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#E5202E] hover:underline"
              >
                Apply an increment from the Payroll tab
                <ArrowRight size={13} />
              </Link>
            </div>
          )}
        </div>
      </GlassCard>

      {/* ── Payslip history ── */}
      <GlassCard>
        <SectionTitle>Payslip history</SectionTitle>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={psMonth}
              onChange={(e) => setPsMonth(parseInt(e.target.value))}
              className="bg-white border border-[#E2E2DF] rounded-xl px-3 py-2 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 min-h-[44px]"
            >
              {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => (
                <option key={i} value={i + 1}>{m}</option>
              ))}
            </select>
            <select
              value={psYear}
              onChange={(e) => setPsYear(parseInt(e.target.value))}
              className="bg-white border border-[#E2E2DF] rounded-xl px-3 py-2 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 min-h-[44px]"
            >
              {[2024, 2025, 2026].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <button
              onClick={loadPayslip}
              disabled={psLoading}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition font-semibold min-h-[44px] disabled:opacity-60"
            >
              {psLoading ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
              View payslip
            </button>
          </div>

          {psError && (
            <p className="text-sm text-[#5A5A5A] flex items-center gap-2">
              <AlertCircle size={14} className="text-[#6B6B6B]" />
              {psError}
            </p>
          )}

          {psData && (
            <div className="rounded-xl border border-[#E2E2DF] bg-[#F4F4F2]/60 p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs text-[#5A5A5A]">
                    {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][psMonth - 1]} {psYear}
                  </p>
                  <p className="text-lg font-bold text-[#1A1A1A]">
                    ₹{parseFloat(String((psData as Record<string, unknown>).net_pay ?? 0)).toLocaleString("en-IN")} net
                  </p>
                </div>
                <button
                  onClick={() => apiDownloadPayslipPdf(emp_code, psYear, psMonth)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs bg-white border border-[#E2E2DF] text-[#1A1A1A] hover:bg-[#F4F4F2] rounded-xl transition font-medium min-h-[40px]"
                >
                  <Download size={12} />
                  PDF
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                {(["Gross", "PF", "ESIC", "PT"] as const).map((label) => {
                  const keyMap: Record<string, string> = { Gross: "gross_pay", PF: "pf_emp", ESIC: "esic_emp", PT: "pt" };
                  const val = (psData as Record<string, unknown>)[keyMap[label]];
                  return (
                    <div key={label}>
                      <p className="text-[#6B6B6B] font-semibold uppercase tracking-wide text-[10px] mb-0.5">{label}</p>
                      <p className="text-[#1A1A1A] font-semibold">₹{parseFloat(String(val ?? 0)).toLocaleString("en-IN")}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </GlassCard>

      {/* ── Danger zone ── */}
      {isAdmin && (
        <GlassCard className="border-[#DC2626]/20">
          <SectionTitle>Danger zone</SectionTitle>
          <div className="p-5">
            {!confirmDelete ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[#1A1A1A] font-medium">Deactivate employee</p>
                  <p className="text-xs text-[#5A5A5A] mt-0.5">Sets status to inactive. Employee data is preserved.</p>
                </div>
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1.5 px-3.5 py-2 text-sm bg-white border border-[#DC2626]/40 text-[#DC2626] hover:bg-[#DC2626]/6 rounded-xl transition font-medium min-h-[40px]"
                >
                  <Trash2 size={13} />
                  Deactivate
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-[#DC2626] font-medium">Confirm deactivation?</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-3.5 py-2 text-sm bg-white border border-[#E2E2DF] text-[#5A5A5A] hover:bg-[#F4F4F2] rounded-xl transition font-medium min-h-[40px]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-sm bg-[#DC2626] text-white hover:bg-[#B91C1C] rounded-xl transition font-medium min-h-[40px] disabled:opacity-60"
                  >
                    {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    {deleting ? "Deactivating…" : "Confirm"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
