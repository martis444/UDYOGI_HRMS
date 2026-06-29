"use client";

// Bulk salary increment — upload a CSV, preview the computed new salaries, apply
// them all in one transaction. Each row picks a mode: pct / flat / abs_<field>.

import { useState, useCallback } from "react";
import Link from "next/link";
import GlassCard from "@/components/ui/GlassCard";
import {
  apiBulkIncrementValidate,
  apiBulkIncrementCommit,
  type BulkIncrementRow,
} from "@/lib/api";
import {
  TrendingUp, Upload, Download, ChevronLeft, Loader2, AlertCircle,
  CheckCircle2, FileSpreadsheet,
} from "lucide-react";

const TEMPLATE = [
  "emp_code,effective_from,reason,mode,value",
  "UP000001,2026-08-01,increment,pct,10",
  "UP000002,2026-08-01,increment,flat,2000",
  "UP000003,2026-08-01,increment,abs_basic,15000",
].join("\n");

const MODES: [string, string][] = [
  ["pct", "Raise every component by value %  (e.g. 10 = +10%)"],
  ["flat", "Add value rupees to Basic"],
  ["abs_basic", "Set Basic to value (absolute)"],
  ["abs_hra", "Set HRA to value"],
  ["abs_spl", "Set SPL to value"],
  ["abs_cca", "Set CCA to value"],
  ["abs_lta", "Set LTA (leave_travel) to value"],
  ["abs_other", "Set Other Earning to value"],
];

const money = (n: number) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

function errMsg(e: unknown, fb: string) {
  const m = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return typeof m === "string" ? m : fb;
}

function downloadTemplate() {
  const blob = new Blob([TEMPLATE + "\n"], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "bulk_increment_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function BulkIncrementPage() {
  const [file, setFile] = useState<File | null>(null);
  const [valid, setValid] = useState<BulkIncrementRow[]>([]);
  const [errors, setErrors] = useState<{ emp_code: string; error: string }[]>([]);
  const [validating, setValidating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [validated, setValidated] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<number | null>(null);

  const reset = () => {
    setValid([]); setErrors([]); setValidated(false); setError(""); setDone(null);
  };

  const onValidate = useCallback(async () => {
    if (!file) return;
    setValidating(true); setError(""); setDone(null);
    try {
      const res = await apiBulkIncrementValidate(file);
      setValid(res.valid ?? []);
      setErrors(res.errors ?? []);
      setValidated(true);
    } catch (e) {
      setError(errMsg(e, "Could not read the file."));
    } finally {
      setValidating(false);
    }
  }, [file]);

  const onApply = useCallback(async () => {
    if (valid.length === 0) return;
    setApplying(true); setError("");
    try {
      const res = await apiBulkIncrementCommit(valid);
      setDone(res.applied);
      setValid([]); setErrors([]); setValidated(false); setFile(null);
    } catch (e) {
      setError(errMsg(e, "Failed to apply increments."));
    } finally {
      setApplying(false);
    }
  }, [valid]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/payroll"
          className="w-9 h-9 rounded-lg border border-[#E2E2DF] bg-white flex items-center justify-center text-[#5A5A5A] hover:bg-[#F4F4F2] transition"
        >
          <ChevronLeft size={16} />
        </Link>
        <div className="w-10 h-10 rounded-xl bg-[#1A1A1A] flex items-center justify-center text-white">
          <TrendingUp size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[#1A1A1A]">Bulk salary increment</h1>
          <p className="text-[#6B6B6B] text-sm">
            Apply increments to many employees at once — % hike, flat add, or absolute values.
          </p>
        </div>
      </div>

      {done !== null && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-[#16A34A]/8 border border-[#16A34A]/20 text-[#16A34A] text-sm">
          <CheckCircle2 size={16} /> Applied {done} increment{done === 1 ? "" : "s"} successfully.
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-[#DC2626]/8 border border-[#DC2626]/20 text-[#DC2626] text-sm">
          <AlertCircle size={16} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* Step 1 — template + reference */}
      <GlassCard className="p-5">
        <h2 className="text-[#1A1A1A] font-semibold text-base mb-2">1 · Prepare the file</h2>
        <p className="text-[#5A5A5A] text-sm mb-3">
          Columns: <code className="text-[#1A1A1A]">emp_code, effective_from, reason, mode, value</code>.
          Effective date must be the <b>1st of a month</b> (e.g. 2026-08-01). Reason = increment or correction.
        </p>
        <div className="grid sm:grid-cols-2 gap-2 mb-4">
          {MODES.map(([m, desc]) => (
            <div key={m} className="flex items-baseline gap-2 text-xs text-[#5A5A5A]">
              <code className="text-[#E5202E] font-semibold shrink-0">{m}</code>
              <span>{desc}</span>
            </div>
          ))}
        </div>
        <button
          onClick={downloadTemplate}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-sm bg-white border border-[#E2E2DF] text-[#1A1A1A] rounded-xl hover:bg-[#F4F4F2] transition font-medium"
        >
          <Download size={14} /> Download template CSV
        </button>
      </GlassCard>

      {/* Step 2 — upload + validate */}
      <GlassCard className="p-5">
        <h2 className="text-[#1A1A1A] font-semibold text-base mb-3">2 · Upload &amp; preview</h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 px-3.5 py-2 text-sm bg-white border border-[#E2E2DF] text-[#1A1A1A] rounded-xl hover:bg-[#F4F4F2] transition font-medium cursor-pointer">
            <Upload size={14} /> {file ? "Change file" : "Choose CSV / XLSX"}
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }}
            />
          </label>
          {file && (
            <span className="inline-flex items-center gap-1.5 text-sm text-[#5A5A5A]">
              <FileSpreadsheet size={14} /> {file.name}
            </span>
          )}
          <button
            onClick={onValidate}
            disabled={!file || validating}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-[#1A1A1A] text-white rounded-xl hover:bg-black transition font-semibold disabled:opacity-50"
          >
            {validating ? <><Loader2 size={14} className="animate-spin" /> Validating…</> : "Validate"}
          </button>
        </div>

        {validated && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-[#5A5A5A]">
              <b className="text-[#16A34A]">{valid.length}</b> ready ·{" "}
              <b className="text-[#DC2626]">{errors.length}</b> with errors
            </p>

            {valid.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-[#E2E2DF]">
                <table className="w-full text-sm">
                  <thead className="bg-[#F4F4F2] text-[#5A5A5A] text-xs uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-3 py-2">Emp code</th>
                      <th className="text-left px-3 py-2">Name</th>
                      <th className="text-left px-3 py-2">Effective</th>
                      <th className="text-left px-3 py-2">Mode</th>
                      <th className="text-right px-3 py-2">Current gross</th>
                      <th className="text-right px-3 py-2">New gross</th>
                    </tr>
                  </thead>
                  <tbody>
                    {valid.map((r, i) => (
                      <tr key={`${r.emp_code}-${i}`} className="border-t border-[#E2E2DF]">
                        <td className="px-3 py-2 font-mono text-[#1A1A1A]">{r.emp_code}</td>
                        <td className="px-3 py-2 text-[#1A1A1A]">{r.name ?? "—"}</td>
                        <td className="px-3 py-2 text-[#5A5A5A]">{r.effective_from}</td>
                        <td className="px-3 py-2"><code className="text-[#E5202E]">{r.mode}</code> {String(r.value)}</td>
                        <td className="px-3 py-2 text-right text-[#5A5A5A]">{money(r.current_gross)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-[#1A1A1A]">{money(r.new_gross)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {errors.length > 0 && (
              <div className="rounded-xl border border-[#DC2626]/20 bg-[#DC2626]/5 p-3 space-y-1">
                {errors.map((e, i) => (
                  <p key={i} className="text-xs text-[#DC2626]">
                    <span className="font-mono font-semibold">{e.emp_code}</span> — {e.error}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </GlassCard>

      {/* Step 3 — apply */}
      {validated && valid.length > 0 && (
        <GlassCard className="p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-[#1A1A1A] font-semibold text-base">3 · Apply</h2>
              <p className="text-[#5A5A5A] text-sm">
                Applies all {valid.length} increment{valid.length === 1 ? "" : "s"} in one transaction
                {errors.length > 0 && " (rows with errors are skipped)"}. This is all-or-nothing.
              </p>
            </div>
            <button
              onClick={onApply}
              disabled={applying}
              className="inline-flex items-center gap-2 px-6 py-2.5 text-sm bg-[#E5202E] text-white rounded-xl hover:bg-[#C81824] transition font-semibold disabled:opacity-60"
            >
              {applying ? <><Loader2 size={14} className="animate-spin" /> Applying…</> : `Apply ${valid.length} increment${valid.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
