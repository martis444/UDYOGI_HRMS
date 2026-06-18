"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  apiGetFormOptions, apiGetNextEmpCode, apiCreateEmployee, apiGetActiveLocations,
} from "@/lib/api";
import { ChevronLeft, ChevronDown, IndianRupee, AlertCircle } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LocationOption { id: string; city: string; state: string; entity_id: string; }
interface DepartmentOption { id: number; name: string; entity_id: string; }
interface GradeOption { id: number; code: string; name: string; entity_id: string; }
interface ShiftOption { id: number; name: string; in_time: string; out_time: string; entity_id: string; }
interface EntityOption { id: string; name: string; prefix: string; }

interface FormOptions {
  entities: EntityOption[];
  locations: LocationOption[];
  departments: DepartmentOption[];
  grades: GradeOption[];
  shifts: ShiftOption[];
}

type FormState = {
  // Personal
  name: string; mobile: string; email: string; doj: string; dob: string;
  gender: string; father_name: string; marital_status: string;
  blood_group: string; religion: string;
  // Org
  entity_id: string; location_id: string; department_id: string;
  designation: string; division: string; grade_id: string;
  shift_id: string; reporting_mgr_code: string;
  // Salary
  basic: string; hra: string; da: string; spl: string; cca: string;
  ctc_annual: string; pf_applicable: boolean; pt_applicable: boolean;
  // Statutory
  pan: string; aadhaar: string; uan: string; esic_no: string;
  bank_name: string; bank_acc: string; ifsc: string; bank_branch: string;
  // Address
  present_addr: string; present_city: string; present_state: string; present_pin: string;
  perm_addr: string; perm_city: string; perm_state: string; perm_pin: string;
  status: string;
};

const EMPTY: FormState = {
  name: "", mobile: "", email: "", doj: "", dob: "",
  gender: "", father_name: "", marital_status: "", blood_group: "", religion: "",
  entity_id: "", location_id: "", department_id: "", designation: "", division: "",
  grade_id: "", shift_id: "", reporting_mgr_code: "",
  basic: "", hra: "", da: "", spl: "", cca: "", ctc_annual: "",
  pf_applicable: true, pt_applicable: true,
  pan: "", aadhaar: "", uan: "", esic_no: "",
  bank_name: "", bank_acc: "", ifsc: "", bank_branch: "",
  present_addr: "", present_city: "", present_state: "", present_pin: "",
  perm_addr: "", perm_city: "", perm_state: "", perm_pin: "",
  status: "active",
};

// ─── UI helpers ───────────────────────────────────────────────────────────────

function Section({
  title, open, onToggle, children,
}: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#E2E2DF] bg-white/80 shadow-sm overflow-hidden" style={{ backdropFilter: "blur(12px)" }}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 bg-[#F4F4F2]/60 hover:bg-[#F4F4F2] transition text-left"
      >
        <span className="text-[#1A1A1A] font-semibold text-sm">{title}</span>
        <ChevronDown size={16} className={`text-[#5A5A5A] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-5 py-5 border-t border-[#E2E2DF]">{children}</div>}
    </div>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[#5A5A5A] mb-1.5">
        {label}{required && <span className="text-[#E5202E] ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-[#6B6B6B] mt-1">{hint}</p>}
    </div>
  );
}

const INPUT = "w-full bg-white border border-[#E2E2DF] rounded-xl px-3 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 placeholder:text-[#6B6B6B]";
const SELECT = `${INPUT} appearance-none cursor-pointer`;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AddEmployeePage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [opts, setOpts] = useState<FormOptions | null>(null);
  const [activeLocations, setActiveLocations] = useState<{ id: string; name: string }[]>([]);
  const [nextCode, setNextCode] = useState("");
  const [sameAddr, setSameAddr] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [openSections, setOpenSections] = useState({ personal: true, org: true, salary: true, statutory: false, address: false });

  // Load form options + active locations once
  useEffect(() => {
    apiGetFormOptions().then((d) => setOpts(d)).catch(() => {});
    apiGetActiveLocations().then((d) => setActiveLocations(d.locations)).catch(() => {});
  }, []);

  // Preview next emp code when entity changes
  useEffect(() => {
    if (!form.entity_id) { setNextCode(""); return; }
    apiGetNextEmpCode(form.entity_id).then((d) => setNextCode(d.next_code ?? "")).catch(() => setNextCode(""));
  }, [form.entity_id]);

  // Sync perm address from present when sameAddr = true
  useEffect(() => {
    if (!sameAddr) return;
    setForm((f) => ({
      ...f,
      perm_addr: f.present_addr, perm_city: f.present_city,
      perm_state: f.present_state, perm_pin: f.present_pin,
    }));
  }, [sameAddr, form.present_addr, form.present_city, form.present_state, form.present_pin]);

  const set = useCallback((field: keyof FormState, value: string | boolean) => {
    setForm((f) => ({ ...f, [field]: value }));
  }, []);

  const toggleSection = (k: keyof typeof openSections) =>
    setOpenSections((s) => ({ ...s, [k]: !s[k] }));

  // Gross calc
  const gross = ["basic", "hra", "da", "spl", "cca"].reduce((acc, k) => {
    const v = parseFloat(form[k as keyof FormState] as string);
    return acc + (isNaN(v) ? 0 : v);
  }, 0);

  // Locations are group-wide (GSTN units) — not entity-filtered; from /locations/active
  const locations = activeLocations;
  const departments = opts?.departments.filter((d) => !form.entity_id || d.entity_id === form.entity_id) ?? [];
  const grades = opts?.grades.filter((g) => !form.entity_id || g.entity_id === form.entity_id) ?? [];
  const shifts = opts?.shifts.filter((s) => !form.entity_id || s.entity_id === form.entity_id) ?? [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      // Map all non-empty fields
      const strFields: (keyof FormState)[] = [
        "name", "mobile", "email", "doj", "dob", "gender", "father_name", "marital_status",
        "blood_group", "religion", "entity_id", "location_id", "designation", "division",
        "reporting_mgr_code", "pan", "aadhaar", "uan", "esic_no",
        "bank_name", "bank_acc", "ifsc", "bank_branch",
        "present_addr", "present_city", "present_state", "present_pin",
        "perm_addr", "perm_city", "perm_state", "perm_pin", "status",
        "ctc_annual", "basic", "hra", "da", "spl", "cca",
      ];
      for (const f of strFields) {
        const v = form[f];
        if (v !== "" && v !== null && v !== undefined) body[f] = v;
      }
      // Numeric IDs
      if (form.department_id) body.department_id = parseInt(form.department_id);
      if (form.grade_id) body.grade_id = parseInt(form.grade_id);
      if (form.shift_id) body.shift_id = parseInt(form.shift_id);
      // Booleans always included
      body.pf_applicable = form.pf_applicable;
      body.pt_applicable = form.pt_applicable;

      const result = await apiCreateEmployee(body);
      router.push(`/dashboard/employees/${result.emp_code}`);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      if (typeof detail === "string") {
        setError(detail);
      } else if (Array.isArray(detail)) {
        setError(detail.map((e: { loc?: string[]; msg?: string }) => `${(e.loc ?? []).slice(1).join(".")}: ${e.msg}`).join(" | "));
      } else {
        setError("Failed to create employee. Check fields and try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto pb-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-5">
        <Link href="/dashboard/employees" className="flex items-center gap-1 text-[#5A5A5A] hover:text-[#1A1A1A] text-sm transition">
          <ChevronLeft size={16} />
          Employees
        </Link>
        <span className="text-[#E2E2DF]">/</span>
        <span className="text-[#1A1A1A] text-sm font-semibold">Add employee</span>
      </div>

      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-white font-semibold text-xl">New employee</h1>
          {nextCode ? (
            <p className="text-[#5A5A5A] text-sm mt-1">
              Will be assigned <span className="font-mono font-bold text-[#E5202E]">{nextCode}</span>
            </p>
          ) : (
            <p className="text-[#5A5A5A] text-sm mt-1">Select an entity to see the assigned code</p>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-4 mb-5 rounded-xl bg-[#DC2626]/8 border border-[#DC2626]/20 text-[#DC2626] text-sm">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* ── Section 1: Personal ── */}
        <Section title="Personal information" open={openSections.personal} onToggle={() => toggleSection("personal")}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Full name" required>
              <input required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="As per Aadhaar" className={INPUT} />
            </Field>
            <Field label="Mobile" required hint="10 digits, no spaces">
              <input required value={form.mobile} onChange={(e) => set("mobile", e.target.value)} placeholder="9XXXXXXXXX" maxLength={10} className={INPUT} />
            </Field>
            <Field label="Email">
              <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="name@company.com" className={INPUT} />
            </Field>
            <Field label="Date of joining" required>
              <input required type="date" value={form.doj} onChange={(e) => set("doj", e.target.value)} className={INPUT} />
            </Field>
            <Field label="Date of birth">
              <input type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} className={INPUT} />
            </Field>
            <Field label="Gender">
              <select value={form.gender} onChange={(e) => set("gender", e.target.value)} className={SELECT}>
                <option value="">Select</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Father's name">
              <input value={form.father_name} onChange={(e) => set("father_name", e.target.value)} placeholder="Father's full name" className={INPUT} />
            </Field>
            <Field label="Marital status">
              <select value={form.marital_status} onChange={(e) => set("marital_status", e.target.value)} className={SELECT}>
                <option value="">Select</option>
                <option value="single">Single</option>
                <option value="married">Married</option>
                <option value="divorced">Divorced</option>
                <option value="widowed">Widowed</option>
              </select>
            </Field>
            <Field label="Blood group">
              <select value={form.blood_group} onChange={(e) => set("blood_group", e.target.value)} className={SELECT}>
                <option value="">Select</option>
                {["A+","A-","B+","B-","AB+","AB-","O+","O-"].map((bg) => <option key={bg} value={bg}>{bg}</option>)}
              </select>
            </Field>
            <Field label="Religion">
              <input value={form.religion} onChange={(e) => set("religion", e.target.value)} placeholder="Optional" className={INPUT} />
            </Field>
          </div>
        </Section>

        {/* ── Section 2: Organisation ── */}
        <Section title="Organisation" open={openSections.org} onToggle={() => toggleSection("org")}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Entity" required>
              <select required value={form.entity_id} onChange={(e) => { set("entity_id", e.target.value); set("location_id", ""); set("department_id", ""); set("grade_id", ""); set("shift_id", ""); }} className={SELECT}>
                <option value="">Select entity</option>
                {(opts?.entities ?? []).map((e) => (
                  <option key={e.id} value={e.id}>{e.id} — {e.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Location" required>
              <select required value={form.location_id} onChange={(e) => set("location_id", e.target.value)} className={SELECT}>
                <option value="">Select location</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Department">
              <select value={form.department_id} onChange={(e) => set("department_id", e.target.value)} disabled={!form.entity_id} className={SELECT}>
                <option value="">Select department</option>
                {departments.map((d) => (
                  <option key={d.id} value={String(d.id)}>{d.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Designation">
              <input value={form.designation} onChange={(e) => set("designation", e.target.value)} placeholder="e.g. Production Supervisor" className={INPUT} />
            </Field>
            <Field label="Division">
              <input value={form.division} onChange={(e) => set("division", e.target.value)} placeholder="Optional" className={INPUT} />
            </Field>
            <Field label="Grade">
              <select value={form.grade_id} onChange={(e) => set("grade_id", e.target.value)} disabled={!form.entity_id} className={SELECT}>
                <option value="">Select grade</option>
                {grades.map((g) => (
                  <option key={g.id} value={String(g.id)}>{g.code}{g.name ? ` — ${g.name}` : ""}</option>
                ))}
              </select>
            </Field>
            <Field label="Shift">
              <select value={form.shift_id} onChange={(e) => set("shift_id", e.target.value)} disabled={!form.entity_id} className={SELECT}>
                <option value="">Select shift</option>
                {shifts.map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.name} ({s.in_time.slice(0, 5)}–{s.out_time.slice(0, 5)})</option>
                ))}
              </select>
            </Field>
            <Field label="Reporting manager code">
              <input value={form.reporting_mgr_code} onChange={(e) => set("reporting_mgr_code", e.target.value)} placeholder="e.g. UP000005" className={INPUT} />
            </Field>
          </div>
        </Section>

        {/* ── Section 3: Salary ── */}
        <Section title="Salary" open={openSections.salary} onToggle={() => toggleSection("salary")}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {(["basic", "hra", "da", "spl", "cca"] as (keyof FormState)[]).map((field) => (
              <Field key={field} label={field.toUpperCase()}>
                <div className="relative">
                  <IndianRupee size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B6B6B]" />
                  <input
                    type="number" min="0" step="0.01"
                    value={form[field] as string}
                    onChange={(e) => set(field, e.target.value)}
                    placeholder="0.00"
                    className={`${INPUT} pl-7`}
                  />
                </div>
              </Field>
            ))}
            <Field label="CTC annual">
              <div className="relative">
                <IndianRupee size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B6B6B]" />
                <input type="number" min="0" step="0.01" value={form.ctc_annual} onChange={(e) => set("ctc_annual", e.target.value)} placeholder="0.00" className={`${INPUT} pl-7`} />
              </div>
            </Field>
          </div>

          {/* Gross pill */}
          <div className="mt-4 flex items-center gap-2 p-3 rounded-xl bg-[#E5202E]/6 border border-[#E5202E]/15">
            <IndianRupee size={14} className="text-[#E5202E]" />
            <span className="text-sm text-[#1A1A1A]">Monthly gross</span>
            <span className="ml-auto font-bold text-[#1A1A1A] text-base">
              ₹{gross.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            {gross > 21000 ? (
              <span className="text-[10px] text-[#D97706] font-semibold ml-1">ESIC exempt</span>
            ) : gross > 0 ? (
              <span className="text-[10px] text-[#16A34A] font-semibold ml-1">ESIC applicable</span>
            ) : null}
          </div>

          {/* Statutory flags */}
          <div className="mt-4 flex flex-wrap gap-4">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <div
                onClick={() => set("pf_applicable", !form.pf_applicable)}
                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition ${form.pf_applicable ? "bg-[#E5202E] border-[#E5202E]" : "border-[#E2E2DF] bg-white"}`}
              >
                {form.pf_applicable && <span className="text-white text-[10px] font-bold">✓</span>}
              </div>
              <span className="text-sm text-[#1A1A1A]">PF applicable</span>
            </label>
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <div
                onClick={() => set("pt_applicable", !form.pt_applicable)}
                className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition ${form.pt_applicable ? "bg-[#E5202E] border-[#E5202E]" : "border-[#E2E2DF] bg-white"}`}
              >
                {form.pt_applicable && <span className="text-white text-[10px] font-bold">✓</span>}
              </div>
              <span className="text-sm text-[#1A1A1A]">PT applicable</span>
            </label>
          </div>
        </Section>

        {/* ── Section 4: Statutory & Banking ── */}
        <Section title="Statutory IDs & banking" open={openSections.statutory} onToggle={() => toggleSection("statutory")}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="PAN" hint="Format: ABCDE1234F">
              <input value={form.pan} onChange={(e) => set("pan", e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} className={INPUT} />
            </Field>
            <Field label="Aadhaar" hint="12 digits — stored encrypted">
              <input value={form.aadhaar} onChange={(e) => set("aadhaar", e.target.value)} placeholder="XXXX XXXX XXXX" maxLength={14} className={INPUT} />
            </Field>
            <Field label="UAN">
              <input value={form.uan} onChange={(e) => set("uan", e.target.value)} placeholder="Universal Account Number" className={INPUT} />
            </Field>
            <Field label="ESIC number">
              <input value={form.esic_no} onChange={(e) => set("esic_no", e.target.value)} placeholder="ESIC insurance number" className={INPUT} />
            </Field>
          </div>
          <div className="mt-4 pt-4 border-t border-[#E2E2DF] grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Bank name">
              <input value={form.bank_name} onChange={(e) => set("bank_name", e.target.value)} placeholder="e.g. State Bank of India" className={INPUT} />
            </Field>
            <Field label="Account number" hint="Stored encrypted">
              <input value={form.bank_acc} onChange={(e) => set("bank_acc", e.target.value)} placeholder="Account number" className={INPUT} />
            </Field>
            <Field label="IFSC code">
              <input value={form.ifsc} onChange={(e) => set("ifsc", e.target.value.toUpperCase())} placeholder="SBIN0001234" maxLength={11} className={INPUT} />
            </Field>
            <Field label="Branch">
              <input value={form.bank_branch} onChange={(e) => set("bank_branch", e.target.value)} placeholder="Branch name" className={INPUT} />
            </Field>
          </div>
        </Section>

        {/* ── Section 5: Address ── */}
        <Section title="Address" open={openSections.address} onToggle={() => toggleSection("address")}>
          <p className="text-xs font-semibold text-[#5A5A5A] uppercase tracking-wide mb-3">Present address</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Field label="Street / building">
                <input value={form.present_addr} onChange={(e) => set("present_addr", e.target.value)} placeholder="House/flat, street, area" className={INPUT} />
              </Field>
            </div>
            <Field label="City">
              <input value={form.present_city} onChange={(e) => set("present_city", e.target.value)} placeholder="City" className={INPUT} />
            </Field>
            <Field label="State">
              <input value={form.present_state} onChange={(e) => set("present_state", e.target.value)} placeholder="State" className={INPUT} />
            </Field>
            <Field label="PIN code">
              <input value={form.present_pin} onChange={(e) => set("present_pin", e.target.value)} placeholder="6-digit PIN" maxLength={6} className={INPUT} />
            </Field>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer select-none my-4">
            <div
              onClick={() => setSameAddr(!sameAddr)}
              className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition ${sameAddr ? "bg-[#E5202E] border-[#E5202E]" : "border-[#E2E2DF] bg-white"}`}
            >
              {sameAddr && <span className="text-white text-[10px] font-bold">✓</span>}
            </div>
            <span className="text-sm text-[#1A1A1A]">Permanent address same as present</span>
          </label>

          {!sameAddr && (
            <>
              <p className="text-xs font-semibold text-[#5A5A5A] uppercase tracking-wide mb-3">Permanent address</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Field label="Street / building">
                    <input value={form.perm_addr} onChange={(e) => set("perm_addr", e.target.value)} placeholder="House/flat, street, area" className={INPUT} />
                  </Field>
                </div>
                <Field label="City">
                  <input value={form.perm_city} onChange={(e) => set("perm_city", e.target.value)} placeholder="City" className={INPUT} />
                </Field>
                <Field label="State">
                  <input value={form.perm_state} onChange={(e) => set("perm_state", e.target.value)} placeholder="State" className={INPUT} />
                </Field>
                <Field label="PIN code">
                  <input value={form.perm_pin} onChange={(e) => set("perm_pin", e.target.value)} placeholder="6-digit PIN" maxLength={6} className={INPUT} />
                </Field>
              </div>
            </>
          )}
        </Section>

        {/* Submit */}
        <div className="flex items-center justify-between pt-2">
          <Link
            href="/dashboard/employees"
            className="px-4 py-2.5 text-sm bg-white border border-[#E2E2DF] text-[#5A5A5A] hover:bg-[#F4F4F2] rounded-xl transition font-medium min-h-[44px] flex items-center"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition shadow-sm font-semibold min-h-[44px] disabled:opacity-60"
          >
            {saving ? "Creating…" : "Create employee"}
          </button>
        </div>
      </form>
    </div>
  );
}
