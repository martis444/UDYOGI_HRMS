"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { apiBulkImportValidate, apiBulkImportCommit } from "@/lib/api";
import {
  ChevronLeft, Download, Upload, CheckCircle2,
  AlertCircle, FileSpreadsheet, X, Loader2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ValidateResult {
  valid: unknown[];
  errors: { row?: number; legacy_code?: string; column?: string; error: string }[];
  total_valid: number;
  total_error: number;
}

interface CommitResult {
  created: number;
  message?: string;
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = ["Download template", "Upload file", "Review", "Commit"];

function Steps({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <div className={`flex items-center gap-2 shrink-0 ${active ? "text-[#E5202E]" : done ? "text-[#16A34A]" : "text-[#6B6B6B]"}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition ${active ? "border-[#E5202E] bg-[#E5202E]/10 text-[#E5202E]" : done ? "border-[#16A34A] bg-[#16A34A]/10 text-[#16A34A]" : "border-[#E2E2DF] text-[#6B6B6B]"}`}>
                {done ? "✓" : i + 1}
              </div>
              <span className={`text-xs font-semibold hidden sm:block ${active ? "text-[#1A1A1A]" : done ? "text-[#16A34A]" : "text-[#6B6B6B]"}`}>{label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 rounded transition ${i < current ? "bg-[#16A34A]" : "bg-[#E2E2DF]"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── CSV Template ─────────────────────────────────────────────────────────────

const TEMPLATE_HEADERS = [
  "emp_code", "legacy_code", "name", "father_name", "dob", "gender",
  "marital_status", "blood_group", "religion", "mobile", "email", "doj",
  "entity_id", "location_id", "department_id", "division", "designation",
  "grade_id", "shift_id", "ctc_annual", "basic", "hra", "spl", "cca",
  "pf_applicable", "pt_applicable", "pan", "aadhaar", "uan", "esic_no",
  "bank_name", "bank_acc", "ifsc", "bank_branch",
  "present_addr", "present_city", "present_state", "present_pin",
  "perm_addr", "perm_city", "perm_state", "perm_pin", "status",
];

function downloadTemplate() {
  const csv = TEMPLATE_HEADERS.join(",") + "\n";
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "employee_upload_template.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BulkImportPage() {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [validating, setValidating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [apiError, setApiError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (f: File | null) => {
    if (!f) return;
    if (!f.name.match(/\.(csv|xlsx|xls)$/i)) {
      setApiError("Only CSV or Excel (.xlsx/.xls) files are supported.");
      return;
    }
    setApiError("");
    setFile(f);
    setStep(1);
  };

  const handleValidate = async () => {
    if (!file) return;
    setValidating(true);
    setApiError("");
    try {
      const result = await apiBulkImportValidate(file);
      setValidateResult(result);
      setStep(2);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setApiError(typeof msg === "string" ? msg : "Validation failed. Check your file and try again.");
    } finally {
      setValidating(false);
    }
  };

  const handleCommit = async () => {
    if (!validateResult || validateResult.total_valid === 0) return;
    setCommitting(true);
    setApiError("");
    try {
      const result = await apiBulkImportCommit(validateResult.valid as unknown[], file?.name ?? "bulk_import.csv");
      setCommitResult(result);
      setStep(3);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setApiError(typeof msg === "string" ? msg : "Commit failed. Please try again.");
    } finally {
      setCommitting(false);
    }
  };

  const reset = () => {
    setStep(0); setFile(null); setValidateResult(null);
    setCommitResult(null); setApiError("");
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
        <span className="text-[#1A1A1A] text-sm font-semibold">Bulk import</span>
      </div>

      <div className="mb-6">
        <h1 className="text-white font-semibold text-xl">Bulk import employees</h1>
        <p className="text-white/50 text-sm mt-1">Upload a CSV or Excel file to add multiple employees at once.</p>
      </div>

      {/* Step indicator */}
      <div
        className="rounded-2xl border border-[#E2E2DF] bg-white/80 shadow-sm p-4 mb-5"
        style={{ backdropFilter: "blur(12px)" }}
      >
        <Steps current={step} />
      </div>

      {/* Error */}
      {apiError && (
        <div className="flex items-start gap-2 p-4 mb-5 rounded-xl bg-[#DC2626]/8 border border-[#DC2626]/20 text-[#DC2626] text-sm">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          {apiError}
        </div>
      )}

      {/* ── Step 0: Download template ── */}
      {step === 0 && (
        <div
          className="rounded-2xl border border-[#E2E2DF] bg-white/80 shadow-sm p-8 text-center"
          style={{ backdropFilter: "blur(12px)" }}
        >
          <div className="w-14 h-14 rounded-2xl bg-[#E5202E]/10 flex items-center justify-center mx-auto mb-4">
            <Download size={24} className="text-[#E5202E]" />
          </div>
          <h2 className="text-[#1A1A1A] font-semibold text-base mb-2">Download the template</h2>
          <p className="text-[#5A5A5A] text-sm mb-6 max-w-sm mx-auto">
            Fill in employee data using the provided CSV template. Column headers must match exactly.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={downloadTemplate}
              className="flex items-center gap-2 px-5 py-2.5 bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition shadow-sm font-semibold text-sm min-h-[44px]"
            >
              <Download size={15} />
              Download template CSV
            </button>
            <button
              onClick={() => setStep(1)}
              className="flex items-center gap-2 px-5 py-2.5 bg-white border border-[#E2E2DF] text-[#1A1A1A] hover:bg-[#F4F4F2] rounded-xl transition font-medium text-sm min-h-[44px]"
            >
              I already have a file
            </button>
          </div>
          <div className="mt-6 p-3 rounded-xl bg-[#F4F4F2] text-left">
            <p className="text-[10px] font-semibold text-[#5A5A5A] uppercase tracking-wide mb-2">Required columns</p>
            <p className="text-[11px] text-[#5A5A5A] font-mono leading-relaxed">
              name · doj · entity_id · location_id
            </p>
          </div>
          <div className="mt-3 p-4 rounded-xl bg-[#F4F4F2] text-left">
            <p className="text-[10px] font-semibold text-[#5A5A5A] uppercase tracking-wide mb-2">How to fill the columns</p>
            <ul className="text-[11px] text-[#5A5A5A] leading-relaxed space-y-1 list-disc pl-4">
              <li><b>emp_code</b> — leave <b>blank</b>; the system auto-generates it (e.g. UP000001). Put the old/existing code in <b>legacy_code</b>.</li>
              <li><b>legacy_code</b> — the employee&apos;s previous code, e.g. <span className="font-mono">E0204</span> (optional).</li>
              <li><b>dob, doj</b> — date as <span className="font-mono">YYYY-MM-DD</span> (e.g. 2024-03-15). Also accepted: DD/MM/YYYY, DD-MM-YYYY.</li>
              <li><b>mobile</b> — optional, 10 digits. Multiple numbers: separate with <span className="font-mono">/</span> &nbsp;e.g. <span className="font-mono">9876543210/9123456780</span>.</li>
              <li><b>entity_id</b> — one of <span className="font-mono">UPPL · USAPL · UAPL · UMPL</span>.</li>
              <li><b>department_id</b> — the department <b>name</b> (e.g. <span className="font-mono">ADMIN</span>). New names are created automatically per entity. <b>division</b> is free text.</li>
              <li><b>gender</b> — male / female. &nbsp;<b>pf_applicable / pt_applicable</b> — true / false.</li>
              <li>Leave any unknown cell <b>blank</b> — blanks are skipped, never imported as empty.</li>
            </ul>
          </div>
        </div>
      )}

      {/* ── Step 1: Upload ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div
            className="rounded-2xl border border-[#E2E2DF] bg-white/80 shadow-sm"
            style={{ backdropFilter: "blur(12px)" }}
          >
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFileSelect(e.dataTransfer.files[0] ?? null); }}
              onClick={() => fileInputRef.current?.click()}
              className={`p-10 text-center cursor-pointer rounded-2xl border-2 border-dashed transition ${dragOver ? "border-[#E5202E] bg-[#E5202E]/4" : "border-[#E2E2DF] hover:border-[#E5202E]/50 hover:bg-[#F4F4F2]/50"}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
              />
              <div className="w-12 h-12 rounded-xl bg-[#F4F4F2] flex items-center justify-center mx-auto mb-4">
                <FileSpreadsheet size={22} className="text-[#5A5A5A]" />
              </div>
              {file ? (
                <>
                  <p className="text-[#1A1A1A] font-semibold text-sm">{file.name}</p>
                  <p className="text-[#5A5A5A] text-xs mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                </>
              ) : (
                <>
                  <p className="text-[#1A1A1A] font-semibold text-sm">Drop file here or click to browse</p>
                  <p className="text-[#5A5A5A] text-xs mt-1">CSV or Excel (.xlsx / .xls)</p>
                </>
              )}
            </div>

            {file && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[#E2E2DF]">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet size={14} className="text-[#16A34A]" />
                  <span className="text-sm text-[#1A1A1A] font-medium">{file.name}</span>
                </div>
                <button
                  onClick={() => { setFile(null); setApiError(""); }}
                  className="text-[#6B6B6B] hover:text-[#DC2626] transition"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep(0)}
              className="px-4 py-2.5 text-sm bg-white border border-[#E2E2DF] text-[#5A5A5A] hover:bg-[#F4F4F2] rounded-xl transition font-medium min-h-[44px]"
            >
              ← Back
            </button>
            <button
              onClick={handleValidate}
              disabled={!file || validating}
              className="flex items-center gap-2 px-5 py-2.5 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition shadow-sm font-semibold min-h-[44px] disabled:opacity-60"
            >
              {validating ? (
                <><Loader2 size={14} className="animate-spin" /> Validating…</>
              ) : (
                "Validate file →"
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Review ── */}
      {step === 2 && validateResult && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3">
            <div
              className="rounded-2xl border border-[#16A34A]/20 bg-[#16A34A]/6 p-4"
            >
              <p className="text-xs font-semibold text-[#16A34A] mb-1">Valid rows</p>
              <p className="text-2xl font-bold text-[#16A34A]">{validateResult.total_valid}</p>
              <p className="text-xs text-[#5A5A5A] mt-1">Ready to import</p>
            </div>
            <div
              className={`rounded-2xl border p-4 ${validateResult.total_error > 0 ? "border-[#DC2626]/20 bg-[#DC2626]/6" : "border-[#E2E2DF] bg-[#F4F4F2]"}`}
            >
              <p className={`text-xs font-semibold mb-1 ${validateResult.total_error > 0 ? "text-[#DC2626]" : "text-[#5A5A5A]"}`}>Errors</p>
              <p className={`text-2xl font-bold ${validateResult.total_error > 0 ? "text-[#DC2626]" : "text-[#5A5A5A]"}`}>{validateResult.total_error}</p>
              <p className="text-xs text-[#5A5A5A] mt-1">Rows skipped</p>
            </div>
          </div>

          {/* Error list */}
          {validateResult.errors.length > 0 && (
            <div
              className="rounded-2xl border border-[#E2E2DF] bg-white/80 shadow-sm overflow-hidden"
              style={{ backdropFilter: "blur(12px)" }}
            >
              <div className="px-4 py-3 border-b border-[#E2E2DF] bg-[#F4F4F2]/60">
                <p className="text-sm font-semibold text-[#1A1A1A]">Validation errors</p>
                <p className="text-xs text-[#5A5A5A] mt-0.5">These rows will be skipped</p>
              </div>
              <div className="overflow-x-auto max-h-64">
                <table className="w-full text-xs min-w-[400px]">
                  <thead className="sticky top-0 bg-[#F4F4F2]">
                    <tr>
                      <th className="text-left px-4 py-2 text-[#5A5A5A] font-semibold">Row</th>
                      <th className="text-left px-4 py-2 text-[#5A5A5A] font-semibold">Legacy code</th>
                      <th className="text-left px-4 py-2 text-[#5A5A5A] font-semibold">Column</th>
                      <th className="text-left px-4 py-2 text-[#5A5A5A] font-semibold">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validateResult.errors.map((e, i) => (
                      <tr key={i} className="border-t border-[#E2E2DF] hover:bg-[#F4F4F2]/40">
                        <td className="px-4 py-2 text-[#5A5A5A]">{e.row ?? "—"}</td>
                        <td className="px-4 py-2 font-mono text-[#1A1A1A]">{e.legacy_code ?? "—"}</td>
                        <td className="px-4 py-2 text-[#5A5A5A]">{e.column ?? "—"}</td>
                        <td className="px-4 py-2 text-[#DC2626]">{e.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep(1)}
              className="px-4 py-2.5 text-sm bg-white border border-[#E2E2DF] text-[#5A5A5A] hover:bg-[#F4F4F2] rounded-xl transition font-medium min-h-[44px]"
            >
              ← Re-upload
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={validateResult.total_valid === 0}
              className="flex items-center gap-2 px-5 py-2.5 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition shadow-sm font-semibold min-h-[44px] disabled:opacity-50"
            >
              Confirm import ({validateResult.total_valid} rows) →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Commit ── */}
      {step === 3 && !commitResult && validateResult && (
        <div className="space-y-4">
          <div
            className="rounded-2xl border border-[#E2E2DF] bg-white/80 shadow-sm p-6 text-center"
            style={{ backdropFilter: "blur(12px)" }}
          >
            <div className="w-14 h-14 rounded-2xl bg-[#D97706]/10 flex items-center justify-center mx-auto mb-4">
              <Upload size={22} className="text-[#D97706]" />
            </div>
            <h2 className="text-[#1A1A1A] font-semibold text-base mb-2">Ready to import</h2>
            <p className="text-[#5A5A5A] text-sm mb-1">
              <span className="text-[#1A1A1A] font-bold">{validateResult.total_valid}</span> employees will be created.
            </p>
            {validateResult.total_error > 0 && (
              <p className="text-[#5A5A5A] text-sm">
                <span className="text-[#DC2626] font-bold">{validateResult.total_error}</span> rows with errors will be skipped.
              </p>
            )}
            <p className="text-xs text-[#6B6B6B] mt-3">This action cannot be undone.</p>
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep(2)}
              className="px-4 py-2.5 text-sm bg-white border border-[#E2E2DF] text-[#5A5A5A] hover:bg-[#F4F4F2] rounded-xl transition font-medium min-h-[44px]"
            >
              ← Back
            </button>
            <button
              onClick={handleCommit}
              disabled={committing}
              className="flex items-center gap-2 px-5 py-2.5 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition shadow-sm font-semibold min-h-[44px] disabled:opacity-60"
            >
              {committing ? (
                <><Loader2 size={14} className="animate-spin" /> Importing…</>
              ) : (
                "Confirm & import"
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Done ── */}
      {commitResult && (
        <div
          className="rounded-2xl border border-[#16A34A]/20 bg-[#16A34A]/6 p-8 text-center"
        >
          <CheckCircle2 size={40} className="text-[#16A34A] mx-auto mb-4" />
          <h2 className="text-[#1A1A1A] font-semibold text-base mb-2">Import complete</h2>
          <p className="text-[#5A5A5A] text-sm">
            <span className="text-[#16A34A] font-bold">{commitResult.created}</span> employees created successfully.
          </p>
          <div className="flex items-center justify-center gap-3 mt-6">
            <button
              onClick={reset}
              className="px-4 py-2.5 text-sm bg-white border border-[#E2E2DF] text-[#1A1A1A] hover:bg-[#F4F4F2] rounded-xl transition font-medium min-h-[44px]"
            >
              Import another file
            </button>
            <Link
              href="/dashboard/employees"
              className="flex items-center gap-2 px-5 py-2.5 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition shadow-sm font-semibold min-h-[44px]"
            >
              View employees →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
