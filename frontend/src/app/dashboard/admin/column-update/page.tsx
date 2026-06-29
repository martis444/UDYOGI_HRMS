"use client";

import { useEffect, useState, useRef } from "react";
import GlassCard from "@/components/ui/GlassCard";
import { useAuth } from "@/lib/auth";
import { apiGetFormOptions, apiColumnUpdateTemplate, apiColumnUpdateValidate, apiColumnUpdateCommit } from "@/lib/api";
import {
  Columns, Download, Upload, CheckCircle, Lock, AlertCircle, ChevronRight, RotateCcw,
} from "lucide-react";

// ─── Column metadata ──────────────────────────────────────────────────────────

interface ColMeta { key: string; label: string; group: string; }

const ALLOWED_COLUMNS: ColMeta[] = [
  { key: "sap_code",          label: "SAP code",            group: "Profile" },
  { key: "designation",       label: "Designation",         group: "Profile" },
  { key: "department_id",     label: "Department",          group: "Profile" },
  { key: "grade_id",          label: "Grade",               group: "Profile" },
  { key: "shift_id",          label: "Shift",               group: "Profile" },
  { key: "location_id",       label: "Location",            group: "Profile" },
  { key: "reporting_mgr_code",label: "Reporting manager",   group: "Profile" },
  { key: "profit_center_code",label: "Profit center code",  group: "Costing" },
  { key: "profit_center_name",label: "Profit center name",  group: "Costing" },
  { key: "cost_center_code",  label: "Cost center code",    group: "Costing" },
  { key: "cost_center_name",  label: "Cost center name",    group: "Costing" },
  { key: "basic",             label: "Basic salary",        group: "Salary" },
  { key: "hra",               label: "HRA",                 group: "Salary" },
  { key: "spl",               label: "Special allowance",   group: "Salary" },
  { key: "cca",               label: "CCA",                 group: "Salary" },
  { key: "leave_travel",      label: "LTA",                 group: "Salary" },
  { key: "medical",           label: "Medical",             group: "Salary" },
  { key: "other_earning",     label: "Other earning",       group: "Salary" },
  { key: "ctc_annual",        label: "CTC annual",          group: "Salary" },
  { key: "bank_name",         label: "Bank name",           group: "Banking" },
  { key: "ifsc",              label: "IFSC code",           group: "Banking" },
  { key: "confirmation_date", label: "Confirmation date",    group: "Status" },
  { key: "resignation_date",  label: "Resignation date",    group: "Status" },
];

const LOCKED_COLUMNS: ColMeta[] = [
  { key: "emp_code",      label: "Employee code",      group: "" },
  { key: "entity_id",     label: "Entity",             group: "" },
  { key: "pan",           label: "PAN",                group: "" },
  { key: "aadhaar_enc",   label: "Aadhaar",            group: "" },
  { key: "bank_acc_enc",  label: "Bank account no.",   group: "" },
];

const GROUPS = ["Profile", "Salary", "Banking"];

// ─── Types ────────────────────────────────────────────────────────────────────

interface ColChange { column: string; old_value: string | null; new_value: string; }
interface EmpChanges { emp_code: string; changes: ColChange[]; }

interface ValidateResult {
  change_set: EmpChanges[];
  total_employees: number;
  total_changes: number;
  errors: { row?: number; emp_code?: string; column?: string; error: string }[];
}

interface EntityOption { id: string; name: string; prefix: string; }

// ─── Glass card ───────────────────────────────────────────────────────────────

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEP_LABELS = ["Configure", "Download template", "Upload & validate", "Review & commit"];

function StepBar({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-0">
      {STEP_LABELS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={i} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition ${
                  done
                    ? "bg-[#E5202E] text-white"
                    : active
                    ? "bg-[#E5202E] text-white ring-4 ring-[#E5202E]/20"
                    : "bg-[#E2E2DF] text-[#6B6B6B]"
                }`}
              >
                {done ? <CheckCircle size={14} /> : i + 1}
              </div>
              <span
                className={`text-[10px] font-semibold whitespace-nowrap hidden sm:block ${
                  active ? "text-[#E5202E]" : done ? "text-[#5A5A5A]" : "text-[#C0C0C0]"
                }`}
              >
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div
                className={`h-0.5 w-8 sm:w-16 mx-1 rounded-full transition ${done ? "bg-[#E5202E]" : "bg-[#E2E2DF]"}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Configure ────────────────────────────────────────────────────────

function StepConfigure({
  entities,
  selectedEntity,
  setSelectedEntity,
  selectedCols,
  setSelectedCols,
  onNext,
}: {
  entities: EntityOption[];
  selectedEntity: string;
  setSelectedEntity: (v: string) => void;
  selectedCols: Set<string>;
  setSelectedCols: (s: Set<string>) => void;
  onNext: () => void;
}) {
  const toggle = (key: string) => {
    const next = new Set(selectedCols);
    next.has(key) ? next.delete(key) : next.add(key);
    setSelectedCols(next);
  };

  const selectGroup = (group: string) => {
    const groupKeys = ALLOWED_COLUMNS.filter((c) => c.group === group).map((c) => c.key);
    const allSelected = groupKeys.every((k) => selectedCols.has(k));
    const next = new Set(selectedCols);
    if (allSelected) {
      groupKeys.forEach((k) => next.delete(k));
    } else {
      groupKeys.forEach((k) => next.add(k));
    }
    setSelectedCols(next);
  };

  return (
    <div className="space-y-5">
      {/* Entity selector */}
      <GlassCard className="p-5 space-y-3">
        <h3 className="text-[#1A1A1A] font-semibold text-sm">Select entity</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {entities.map((e) => (
            <button
              key={e.id}
              onClick={() => setSelectedEntity(e.id)}
              className={`px-3 py-2.5 rounded-xl border text-sm font-semibold transition min-h-[44px] ${
                selectedEntity === e.id
                  ? "bg-[#E5202E] border-[#E5202E] text-white shadow-sm"
                  : "bg-white border-[#E2E2DF] text-[#5A5A5A] hover:border-[#E5202E]/40 hover:text-[#1A1A1A]"
              }`}
            >
              {e.id}
            </button>
          ))}
        </div>
      </GlassCard>

      {/* Column selector */}
      <GlassCard className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[#1A1A1A] font-semibold text-sm">Select columns to update</h3>
          <span className="text-xs text-[#5A5A5A]">{selectedCols.size} selected</span>
        </div>

        {GROUPS.map((group) => {
          const cols = ALLOWED_COLUMNS.filter((c) => c.group === group);
          const allChecked = cols.every((c) => selectedCols.has(c.key));
          const someChecked = cols.some((c) => selectedCols.has(c.key));
          return (
            <div key={group}>
              <button
                onClick={() => selectGroup(group)}
                className="flex items-center gap-2 text-xs font-semibold text-[#5A5A5A] uppercase tracking-widest mb-2 hover:text-[#1A1A1A] transition"
              >
                <div
                  className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition ${
                    allChecked
                      ? "bg-[#E5202E] border-[#E5202E]"
                      : someChecked
                      ? "bg-[#E5202E]/30 border-[#E5202E]/50"
                      : "border-[#C0C0C0]"
                  }`}
                >
                  {(allChecked || someChecked) && (
                    <span className="w-1.5 h-0.5 bg-white rounded-full" />
                  )}
                </div>
                {group}
              </button>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 pl-1">
                {cols.map((col) => (
                  <label
                    key={col.key}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition text-sm min-h-[44px] ${
                      selectedCols.has(col.key)
                        ? "bg-[#E5202E]/5 border-[#E5202E]/30 text-[#1A1A1A]"
                        : "bg-white border-[#E2E2DF] text-[#5A5A5A] hover:border-[#E5202E]/30 hover:text-[#1A1A1A]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedCols.has(col.key)}
                      onChange={() => toggle(col.key)}
                      className="accent-[#E5202E] w-3.5 h-3.5 shrink-0"
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            </div>
          );
        })}

        {/* Locked columns (read-only display) */}
        <div>
          <p className="text-xs font-semibold text-[#C0C0C0] uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <Lock size={11} />
            Locked (not updatable)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 pl-1">
            {LOCKED_COLUMNS.map((col) => (
              <div
                key={col.key}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-[#E2E2DF] bg-[#F4F4F2]/50 text-[#C0C0C0] text-sm select-none"
              >
                <Lock size={12} className="shrink-0" />
                {col.label}
              </div>
            ))}
          </div>
        </div>
      </GlassCard>

      <div className="flex justify-end">
        <button
          onClick={onNext}
          disabled={!selectedEntity || selectedCols.size === 0}
          className="flex items-center gap-2 px-5 py-3 rounded-xl bg-[#E5202E] text-white font-semibold text-sm hover:bg-[#C81824] transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
        >
          Next
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ─── Step 2: Download template ────────────────────────────────────────────────

function StepDownload({
  selectedEntity,
  selectedCols,
  onNext,
  onBack,
}: {
  selectedEntity: string;
  selectedCols: Set<string>;
  onNext: () => void;
  onBack: () => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      await apiColumnUpdateTemplate(Array.from(selectedCols), selectedEntity);
      setDownloaded(true);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Download failed. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const cols = Array.from(selectedCols).map(
    (k) => ALLOWED_COLUMNS.find((c) => c.key === k)?.label ?? k
  );

  return (
    <div className="space-y-5">
      <GlassCard className="p-5 space-y-5">
        <div>
          <h3 className="text-[#1A1A1A] font-semibold text-sm mb-1">Download your update template</h3>
          <p className="text-xs text-[#5A5A5A]">
            A pre-filled CSV for <strong>{selectedEntity}</strong> with {selectedCols.size} column{selectedCols.size !== 1 ? "s" : ""} will be generated.
          </p>
        </div>

        {/* Columns preview */}
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs font-mono bg-[#F4F4F2] px-2 py-1 rounded-lg text-[#5A5A5A] font-semibold">emp_code</span>
          {cols.map((c) => (
            <span key={c} className="text-xs font-mono bg-[#E5202E]/8 border border-[#E5202E]/20 px-2 py-1 rounded-lg text-[#E5202E] font-semibold">
              {c}
            </span>
          ))}
        </div>

        {/* Instructions */}
        <div className="bg-[#F4F4F2] rounded-xl p-4 space-y-2">
          <p className="text-xs font-semibold text-[#1A1A1A]">Filling out the template</p>
          <ul className="space-y-1.5 text-xs text-[#5A5A5A]">
            <li className="flex items-start gap-2"><span className="text-[#E5202E] font-bold mt-0.5">•</span> The <code className="font-mono bg-white px-1 rounded">emp_code</code> column is locked — do not edit it.</li>
            <li className="flex items-start gap-2"><span className="text-[#E5202E] font-bold mt-0.5">•</span> Leave a cell blank to keep the current value — blanks are skipped.</li>
            <li className="flex items-start gap-2"><span className="text-[#E5202E] font-bold mt-0.5">•</span> Salary columns accept numbers only (e.g. <code className="font-mono bg-white px-1 rounded">9000</code>).</li>
            <li className="flex items-start gap-2"><span className="text-[#E5202E] font-bold mt-0.5">•</span> ID columns (department_id, grade_id, shift_id, location_id) must be valid integer IDs.</li>
          </ul>
        </div>

        {error && (
          <div
            className="rounded-xl px-4 py-3"
            style={{ background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.20)" }}
          >
            <p className="text-sm text-[#DC2626]">{error}</p>
          </div>
        )}

        <button
          onClick={handleDownload}
          disabled={downloading}
          className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl font-semibold text-sm transition shadow-sm min-h-[44px] ${
            downloaded
              ? "bg-[#16A34A] text-white hover:bg-[#15803D]"
              : "bg-[#E5202E] text-white hover:bg-[#C81824]"
          } disabled:opacity-60`}
        >
          {downloading ? (
            <><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Generating…</>
          ) : downloaded ? (
            <><CheckCircle size={15} /> Downloaded — download again</>
          ) : (
            <><Download size={15} /> Download template CSV</>
          )}
        </button>
      </GlassCard>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-5 py-3 rounded-xl border border-[#E2E2DF] text-[#1A1A1A] text-sm font-medium hover:bg-[#F4F4F2] transition min-h-[44px]"
        >
          Back
        </button>
        <button
          onClick={onNext}
          disabled={!downloaded}
          className="flex items-center gap-2 px-5 py-3 rounded-xl bg-[#E5202E] text-white font-semibold text-sm hover:bg-[#C81824] transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
        >
          Next <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Upload & validate ────────────────────────────────────────────────

function StepValidate({
  onResult,
  onBack,
}: {
  onResult: (r: ValidateResult) => void;
  onBack: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ValidateResult | null>(null);

  const handleFile = (f: File | null) => {
    setFile(f);
    setResult(null);
    setError(null);
  };

  const handleValidate = async () => {
    if (!file) return;
    setValidating(true);
    setError(null);
    try {
      const data = await apiColumnUpdateValidate(file);
      setResult(data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Validation failed. Please check your file and try again.");
    } finally {
      setValidating(false);
    }
  };

  const canProceed = result && result.change_set.length > 0 && result.errors.length === 0;

  return (
    <div className="space-y-5">
      <GlassCard className="p-5 space-y-4">
        <h3 className="text-[#1A1A1A] font-semibold text-sm">Upload your filled template</h3>

        {/* Drop zone */}
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0] ?? null); }}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition ${
            file
              ? "border-[#16A34A]/40 bg-[#16A34A]/5"
              : "border-[#E2E2DF] hover:border-[#E5202E]/40 hover:bg-[#E5202E]/5"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <div className="flex flex-col items-center gap-2">
              <CheckCircle size={24} className="text-[#16A34A]" />
              <p className="text-[#1A1A1A] font-semibold text-sm">{file.name}</p>
              <p className="text-[#5A5A5A] text-xs">{(file.size / 1024).toFixed(1)} KB · click to change</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload size={24} className="text-[#C0C0C0]" />
              <p className="text-[#1A1A1A] text-sm font-semibold">Drop CSV here or click to browse</p>
              <p className="text-[#6B6B6B] text-xs">Only .csv files are accepted</p>
            </div>
          )}
        </div>

        {error && (
          <div
            className="rounded-xl px-4 py-3 flex items-start gap-2"
            style={{ background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.20)" }}
          >
            <AlertCircle size={14} className="text-[#DC2626] shrink-0 mt-0.5" />
            <p className="text-sm text-[#DC2626]">{error}</p>
          </div>
        )}

        <button
          onClick={handleValidate}
          disabled={!file || validating}
          className="w-full py-3 rounded-xl bg-[#E5202E] text-white font-semibold text-sm hover:bg-[#C81824] transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] flex items-center justify-center gap-2"
        >
          {validating ? (
            <><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Validating…</>
          ) : "Validate"}
        </button>

        {/* Validation result summary */}
        {result && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center bg-[#F4F4F2] rounded-xl p-3">
                <p className="text-[#1A1A1A] font-bold text-xl">{result.total_employees}</p>
                <p className="text-[#5A5A5A] text-[10px] uppercase tracking-wide font-semibold mt-0.5">Employees</p>
              </div>
              <div className="text-center bg-[#F4F4F2] rounded-xl p-3">
                <p className="text-[#1A1A1A] font-bold text-xl">{result.total_changes}</p>
                <p className="text-[#5A5A5A] text-[10px] uppercase tracking-wide font-semibold mt-0.5">Changes</p>
              </div>
              <div className={`text-center rounded-xl p-3 ${result.errors.length > 0 ? "bg-[#DC2626]/8" : "bg-[#16A34A]/8"}`}>
                <p className={`font-bold text-xl ${result.errors.length > 0 ? "text-[#DC2626]" : "text-[#16A34A]"}`}>
                  {result.errors.length}
                </p>
                <p className="text-[#5A5A5A] text-[10px] uppercase tracking-wide font-semibold mt-0.5">Errors</p>
              </div>
            </div>

            {/* Errors list */}
            {result.errors.length > 0 && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {result.errors.map((err, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-xs px-3 py-2 rounded-lg"
                    style={{ background: "rgba(220,38,38,0.07)" }}
                  >
                    <AlertCircle size={12} className="text-[#DC2626] shrink-0 mt-0.5" />
                    <span className="text-[#DC2626]">
                      {err.emp_code && <strong>{err.emp_code}</strong>}
                      {err.column && <> · {err.column}</>}
                      {err.row && <> (row {err.row})</>}
                      {" — "}{err.error}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {result.change_set.length === 0 && result.errors.length === 0 && (
              <p className="text-xs text-[#5A5A5A] text-center">No changes detected — all values match current data.</p>
            )}
          </div>
        )}
      </GlassCard>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-5 py-3 rounded-xl border border-[#E2E2DF] text-[#1A1A1A] text-sm font-medium hover:bg-[#F4F4F2] transition min-h-[44px]"
        >
          Back
        </button>
        <button
          onClick={() => result && onResult(result)}
          disabled={!canProceed}
          className="flex items-center gap-2 px-5 py-3 rounded-xl bg-[#E5202E] text-white font-semibold text-sm hover:bg-[#C81824] transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
        >
          Review changes <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

// ─── Step 4: Review & commit ──────────────────────────────────────────────────

function StepCommit({
  result,
  onBack,
  onReset,
}: {
  result: ValidateResult;
  onBack: () => void;
  onReset: () => void;
}) {
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleCommit = async () => {
    setCommitting(true);
    setError(null);
    try {
      const data = await apiColumnUpdateCommit(result.change_set);
      setSuccess(data.message ?? `Updated ${data.applied} employees successfully.`);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg ?? "Commit failed. No changes were applied.");
    } finally {
      setCommitting(false);
    }
  };

  if (success) {
    return (
      <GlassCard className="p-8 text-center space-y-4">
        <div className="w-14 h-14 rounded-full bg-[#16A34A]/10 flex items-center justify-center mx-auto">
          <CheckCircle size={28} className="text-[#16A34A]" />
        </div>
        <div>
          <p className="text-[#1A1A1A] font-semibold text-lg">{success}</p>
          <p className="text-[#5A5A5A] text-sm mt-1">All changes have been applied and logged in the audit trail.</p>
        </div>
        <button
          onClick={onReset}
          className="flex items-center justify-center gap-2 mx-auto px-5 py-3 rounded-xl border border-[#E2E2DF] text-[#1A1A1A] text-sm font-medium hover:bg-[#F4F4F2] transition min-h-[44px]"
        >
          <RotateCcw size={14} />
          Start another update
        </button>
      </GlassCard>
    );
  }

  const colLabel = (key: string) => ALLOWED_COLUMNS.find((c) => c.key === key)?.label ?? key;

  return (
    <div className="space-y-5">
      {/* Summary */}
      <GlassCard className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[#1A1A1A] font-semibold text-sm">Dry-run preview</h3>
          <div className="flex gap-3 text-xs text-[#5A5A5A]">
            <span><strong className="text-[#1A1A1A]">{result.total_employees}</strong> employees</span>
            <span><strong className="text-[#1A1A1A]">{result.total_changes}</strong> changes</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[480px]">
            <thead>
              <tr className="border-b border-[#E2E2DF] bg-[#F4F4F2]/60">
                <th className="text-left px-3 py-2.5 text-[#5A5A5A] font-semibold uppercase tracking-wide">Employee</th>
                <th className="text-left px-3 py-2.5 text-[#5A5A5A] font-semibold uppercase tracking-wide">Field</th>
                <th className="text-left px-3 py-2.5 text-[#5A5A5A] font-semibold uppercase tracking-wide">Current value</th>
                <th className="text-left px-3 py-2.5 text-[#5A5A5A] font-semibold uppercase tracking-wide">New value</th>
              </tr>
            </thead>
            <tbody>
              {result.change_set.map((emp) =>
                emp.changes.map((ch, ci) => (
                  <tr
                    key={`${emp.emp_code}-${ch.column}`}
                    className="border-b border-[#E2E2DF] last:border-0 hover:bg-[#F4F4F2]/30"
                  >
                    <td className="px-3 py-2.5">
                      {ci === 0 && (
                        <span className="font-mono font-bold text-[#1A1A1A] bg-[#F4F4F2] px-1.5 py-0.5 rounded">
                          {emp.emp_code}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[#5A5A5A]">{colLabel(ch.column)}</td>
                    <td className="px-3 py-2.5">
                      <span className="line-through text-[#6B6B6B]">{ch.old_value ?? "—"}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className="font-semibold px-1.5 py-0.5 rounded"
                        style={{ background: "rgba(229,32,46,0.08)", color: "#E5202E" }}
                      >
                        {ch.new_value}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {error && (
        <div
          className="rounded-2xl px-4 py-3 flex items-start gap-2"
          style={{ background: "rgba(220,38,38,0.07)", border: "1px solid rgba(220,38,38,0.20)" }}
        >
          <AlertCircle size={14} className="text-[#DC2626] shrink-0 mt-0.5" />
          <p className="text-sm text-[#DC2626]">{error}</p>
        </div>
      )}

      <div className="flex justify-between">
        <button
          onClick={onBack}
          disabled={committing}
          className="px-5 py-3 rounded-xl border border-[#E2E2DF] text-[#1A1A1A] text-sm font-medium hover:bg-[#F4F4F2] transition min-h-[44px] disabled:opacity-50"
        >
          Back
        </button>
        <button
          onClick={handleCommit}
          disabled={committing}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-[#E5202E] text-white font-semibold text-sm hover:bg-[#C81824] transition shadow-sm disabled:opacity-60 min-h-[44px]"
        >
          {committing ? (
            <><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Applying…</>
          ) : (
            <>Apply {result.total_changes} change{result.total_changes !== 1 ? "s" : ""}</>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ColumnUpdatePage() {
  const { user } = useAuth();
  const [step, setStep] = useState(0);

  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [selectedEntity, setSelectedEntity] = useState("");
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set());
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null);

  useEffect(() => {
    apiGetFormOptions()
      .then((d) => setEntities(d.entities ?? []))
      .catch(() => {});
  }, []);

  const reset = () => {
    setStep(0);
    setSelectedEntity("");
    setSelectedCols(new Set());
    setValidateResult(null);
  };

  if (!user) return null;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#E5202E]/10 flex items-center justify-center shrink-0">
          <Columns size={18} className="text-[#E5202E]" />
        </div>
        <div>
          <h1 className="text-white font-semibold text-xl leading-tight">Column update</h1>
          <p className="text-white/50 text-xs mt-0.5">Bulk-update employee fields via CSV</p>
        </div>
      </div>

      {/* Step bar */}
      <div className="flex justify-center">
        <StepBar step={step} />
      </div>

      {/* Step content */}
      {step === 0 && (
        <StepConfigure
          entities={entities}
          selectedEntity={selectedEntity}
          setSelectedEntity={setSelectedEntity}
          selectedCols={selectedCols}
          setSelectedCols={setSelectedCols}
          onNext={() => setStep(1)}
        />
      )}
      {step === 1 && (
        <StepDownload
          selectedEntity={selectedEntity}
          selectedCols={selectedCols}
          onNext={() => setStep(2)}
          onBack={() => setStep(0)}
        />
      )}
      {step === 2 && (
        <StepValidate
          onResult={(r) => { setValidateResult(r); setStep(3); }}
          onBack={() => setStep(1)}
        />
      )}
      {step === 3 && validateResult && (
        <StepCommit
          result={validateResult}
          onBack={() => setStep(2)}
          onReset={reset}
        />
      )}
    </div>
  );
}
