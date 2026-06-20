"use client";

import { useState } from "react";
import { apiApplyIncrement, type SalaryStructureRow } from "@/lib/api";
import { IndianRupee, TrendingUp, X, Loader2, AlertCircle } from "lucide-react";

const INPUT = "w-full bg-white border border-[#E2E2DF] rounded-xl px-3 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 placeholder:text-[#6B6B6B]";
const SELECT = `${INPUT} appearance-none cursor-pointer`;

const INC_COMPONENTS = [
  { key: "basic", label: "Basic" },
  { key: "hra", label: "HRA" },
  { key: "spl", label: "SPL" },
  { key: "cca", label: "CCA" },
  { key: "leave_travel", label: "LTA" },
  { key: "other_allowance", label: "Other allowance" },
] as const;

type IncKey = (typeof INC_COMPONENTS)[number]["key"];

function errMsg(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return typeof m === "string" ? m : fallback;
}

/** Apply an effective-dated increment. effective_from must be the 1st of a month
 *  (calendar pay-period start) — validated client-side and re-checked server-side. */
export default function IncrementModal({ empCode, active, onClose, onSuccess, onError }: {
  empCode: string; active: SalaryStructureRow | null;
  onClose: () => void; onSuccess: () => void; onError: (m: string) => void;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [reason, setReason] = useState("increment");
  const [form, setForm] = useState<Record<IncKey, string>>({
    basic: String(active?.basic ?? ""),
    hra: String(active?.hra ?? ""),
    spl: String(active?.spl ?? ""),
    cca: String(active?.cca ?? ""),
    leave_travel: String(active?.leave_travel ?? ""),
    other_allowance: String(active?.other_allowance ?? ""),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const newGross = (["basic", "hra", "spl", "cca", "leave_travel"] as IncKey[]).reduce((acc, k) => {
    const v = parseFloat(form[k]);
    return acc + (isNaN(v) ? 0 : v);
  }, 0);

  const day = effectiveFrom ? parseInt(effectiveFrom.slice(8, 10), 10) : 0;
  const is1st = day === 1;

  const submit = async () => {
    setError("");
    if (!effectiveFrom) { setError("Pick an effective-from date."); return; }
    if (!is1st) { setError("Increment must be effective from the 1st of the month."); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { effective_from: effectiveFrom, reason };
      for (const { key } of INC_COMPONENTS) if (form[key] !== "") payload[key] = form[key];
      await apiApplyIncrement(empCode, payload);
      onSuccess();
    } catch (e: unknown) {
      const m = errMsg(e, "Could not apply increment.");
      setError(m); onError(m);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-[#E2E2DF] max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-[#E2E2DF] flex items-center justify-between sticky top-0 bg-white rounded-t-2xl">
          <h3 className="text-[#1A1A1A] font-semibold text-base flex items-center gap-2"><TrendingUp size={16} className="text-[#E5202E]" /> Apply increment — {empCode}</h3>
          <button onClick={onClose} className="text-[#6B6B6B] hover:text-[#1A1A1A] transition"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#5A5A5A] mb-1.5">Effective from <span className="text-[#E5202E]">*</span></label>
            <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className={INPUT} />
            <p className="text-[11px] text-[#6B6B6B] mt-1">Increments take effect from the 1st of a month (the month granted stays at the old rate).</p>
            {effectiveFrom && !is1st && <p className="text-xs text-[#DC2626] mt-1">Date must be the 1st of a month.</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#5A5A5A] mb-1.5">Reason</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className={SELECT}>
              <option value="increment">Increment</option>
              <option value="correction">Correction</option>
            </select>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {INC_COMPONENTS.map(({ key, label }) => (
              <div key={key}>
                <label className="block text-xs font-semibold text-[#5A5A5A] mb-1.5">{label}</label>
                <div className="relative">
                  <IndianRupee size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B6B6B]" />
                  <input type="number" min="0" step="0.01" value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} className={`${INPUT} pl-7`} />
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 p-3 rounded-xl bg-[#E5202E]/6 border border-[#E5202E]/15">
            <IndianRupee size={14} className="text-[#E5202E]" />
            <span className="text-sm text-[#1A1A1A]">New monthly gross</span>
            <span className="ml-auto font-bold text-[#1A1A1A]">₹{newGross.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
          </div>
          {error && <div className="flex items-start gap-2 p-3 rounded-xl bg-[#DC2626]/8 border border-[#DC2626]/20 text-[#DC2626] text-sm"><AlertCircle size={15} className="shrink-0 mt-0.5" /> {error}</div>}
        </div>
        <div className="px-5 py-4 border-t border-[#E2E2DF] flex items-center justify-end gap-2 sticky bottom-0 bg-white rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2.5 text-sm bg-white border border-[#E2E2DF] text-[#5A5A5A] hover:bg-[#F4F4F2] rounded-xl transition font-medium">Cancel</button>
          <button onClick={submit} disabled={saving || !is1st} className="flex items-center gap-2 px-6 py-2.5 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition font-semibold disabled:opacity-60">
            {saving ? <><Loader2 size={13} className="animate-spin" /> Applying…</> : "Apply increment"}
          </button>
        </div>
      </div>
    </div>
  );
}
