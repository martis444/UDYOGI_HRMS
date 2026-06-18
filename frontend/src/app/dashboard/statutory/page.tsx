"use client";

import { useEffect, useState, useCallback } from "react";
import GlassCard from "@/components/ui/GlassCard";
import { useAuth } from "@/lib/auth";
import { apiGetStatutory } from "@/lib/api";
import { Shield, Calculator, MapPin, ChevronDown, ChevronUp } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StatutoryRow {
  id: number;
  state_code: string;
  gender: string | null;
  gross_from: number | null;
  gross_to: number | null;
  monthly_amount: number | null;
  feb_override: number | null;
  annual_cap: number | null;
  filing_freq: string | null;
  due_day: number | null;
  penalty_desc: string | null;
  effective_from: string | null;
  effective_to: string | null;
}

type StatutoryMap = Record<string, StatutoryRow[]>;

// ─── Location → PT state mapping ─────────────────────────────────────────────

const LOCATION_PT: { city: string; state: string; state_code: string }[] = [
  { city: "Kolkata",  state: "West Bengal",   state_code: "WB" },
  { city: "Howrah",   state: "West Bengal",   state_code: "WB" },
  { city: "Pune",     state: "Maharashtra",   state_code: "MH" },
  { city: "Vapi",     state: "Gujarat",       state_code: "GJ" },
  { city: "Silvassa", state: "Silvassa",      state_code: "NIL" },
  { city: "Dadra",    state: "Dadra",         state_code: "NIL" },
  { city: "Daman",    state: "Daman",         state_code: "NIL" },
  { city: "Jaipur",   state: "Rajasthan",     state_code: "NIL" },
  { city: "Delhi",    state: "Delhi",         state_code: "NIL" },
];

// ─── PT Slab resolver (mirrors pt_resolver.py logic) ─────────────────────────

function resolvePT(stateCode: string, gross: number, gender: string, month: number, rows: StatutoryRow[]): number {
  if (stateCode === "NIL") return 0;
  const stateRows = rows.filter(
    (r) => r.state_code === stateCode && (r.gender === null || r.gender === gender)
  );
  // Sort: gender-specific first
  stateRows.sort((a, b) => {
    if (a.gender && !b.gender) return -1;
    if (!a.gender && b.gender) return 1;
    return (a.gross_from ?? 0) - (b.gross_from ?? 0);
  });
  const now = new Date();
  const effectiveRows = stateRows.filter((r) => {
    const from = r.effective_from ? new Date(r.effective_from) : new Date("2000-01-01");
    const to = r.effective_to ? new Date(r.effective_to) : new Date("2099-12-31");
    return now >= from && now <= to;
  });
  for (const r of effectiveRows) {
    const from = r.gross_from ?? 0;
    const to = r.gross_to ?? Infinity;
    if (gross >= from && (to === Infinity || gross <= to)) {
      if (month === 2 && r.feb_override !== null) return Number(r.feb_override);
      return Number(r.monthly_amount ?? 0);
    }
  }
  return 0;
}

// ─── Payroll calculator ───────────────────────────────────────────────────────

function calcPayroll(
  basic: number, hra: number, da: number, spl: number, cca: number,
  stateCode: string, gender: string, month: number, allRows: StatutoryRow[]
) {
  const gross = basic + hra + da + spl + cca;
  const pf = Math.min(Math.round((basic + da) * 0.12), 1800);
  const esic = gross <= 21000 ? Math.ceil(gross * 0.0075) : 0;
  const pt = resolvePT(stateCode, gross, gender, month, allRows);
  const net = gross - pf - esic - pt;
  return { gross, pf, esic, pt, net };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) { return n.toLocaleString("en-IN"); }

const MONTH_NAMES = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
];

// ─── PT Slab table for a single state ────────────────────────────────────────

function PTSlabTable({ rows }: { rows: StatutoryRow[] }) {
  if (rows.length === 0) return <p className="text-[#5A5A5A] text-xs italic">No PT applicable for this state.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-[340px]">
        <thead>
          <tr className="border-b border-[#E2E2DF] bg-[#F4F4F2]/60">
            {["Gross from", "Gross to", "Gender", "Monthly PT (₹)", "Feb (₹)", "Due day"].map((h) => (
              <th key={h} className="text-left px-3 py-2 text-[#5A5A5A] font-semibold text-[10px] uppercase tracking-wide whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-[#E2E2DF] last:border-0">
              <td className="px-3 py-2 text-[#1A1A1A]">₹{fmt(Number(r.gross_from ?? 0))}</td>
              <td className="px-3 py-2 text-[#1A1A1A]">{r.gross_to ? `₹${fmt(Number(r.gross_to))}` : "∞"}</td>
              <td className="px-3 py-2 text-[#5A5A5A] capitalize">{r.gender ?? "All"}</td>
              <td className="px-3 py-2 font-semibold text-[#1A1A1A]">{r.monthly_amount !== null ? fmt(Number(r.monthly_amount)) : "—"}</td>
              <td className="px-3 py-2 text-[#5A5A5A]">{r.feb_override !== null ? fmt(Number(r.feb_override)) : "—"}</td>
              <td className="px-3 py-2 text-[#5A5A5A]">{r.due_day ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Collapsible state PT card ────────────────────────────────────────────────

function PTStateCard({ stateCode, rows }: { stateCode: string; rows: StatutoryRow[] }) {
  const [open, setOpen] = useState(stateCode === "WB" || stateCode === "MH");
  const locations = LOCATION_PT.filter((l) => l.state_code === stateCode);

  return (
    <GlassCard className="overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#F4F4F2]/40 transition"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#E5202E]/10 flex items-center justify-center shrink-0">
            <MapPin size={14} className="text-[#E5202E]" />
          </div>
          <div className="text-left">
            <p className="text-[#1A1A1A] font-semibold text-sm">
              {stateCode === "NIL" ? "No PT states" : `PT – ${stateCode}`}
            </p>
            <p className="text-[#5A5A5A] text-xs mt-0.5">
              {locations.map((l) => l.city).join(", ")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {stateCode === "NIL" ? (
            <span className="text-[10px] font-bold bg-[#5A5A5A]/10 text-[#5A5A5A] px-2 py-0.5 rounded-full">NIL</span>
          ) : (
            <span className="text-[10px] font-bold bg-[#E5202E]/10 text-[#E5202E] px-2 py-0.5 rounded-full">{rows.length} slabs</span>
          )}
          {open ? <ChevronUp size={14} className="text-[#5A5A5A]" /> : <ChevronDown size={14} className="text-[#5A5A5A]" />}
        </div>
      </button>
      {open && (
        <div className="border-t border-[#E2E2DF] px-5 py-4">
          {stateCode === "NIL" ? (
            <p className="text-[#5A5A5A] text-xs">
              Locations in Silvassa, Dadra, Daman, Jaipur, and Delhi are exempt from Professional Tax.
            </p>
          ) : (
            <PTSlabTable rows={rows} />
          )}
        </div>
      )}
    </GlassCard>
  );
}

// ─── Live calculator ──────────────────────────────────────────────────────────

function LiveCalculator({ allRows }: { allRows: StatutoryRow[] }) {
  const [basic, setBasic] = useState("5000");
  const [hra, setHra] = useState("2000");
  const [da, setDa] = useState("1000");
  const [spl, setSpl] = useState("800");
  const [cca, setCca] = useState("0");
  const [location, setLocation] = useState("Kolkata");
  const [gender, setGender] = useState("male");
  const [month, setMonth] = useState(new Date().getMonth() + 1);

  const loc = LOCATION_PT.find((l) => l.city === location) ?? LOCATION_PT[0];
  const result = calcPayroll(
    Number(basic) || 0, Number(hra) || 0, Number(da) || 0,
    Number(spl) || 0, Number(cca) || 0,
    loc.state_code, gender, month, allRows
  );

  const inputCls = "bg-white border border-[#E2E2DF] rounded-xl px-3 py-2 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 w-full min-h-[44px]";

  return (
    <GlassCard className="p-5">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-8 h-8 rounded-lg bg-[#E5202E]/10 flex items-center justify-center shrink-0">
          <Calculator size={14} className="text-[#E5202E]" />
        </div>
        <div>
          <h2 className="text-[#1A1A1A] font-semibold text-sm">Salary calculator</h2>
          <p className="text-[#5A5A5A] text-xs mt-0.5">Live statutory deduction preview</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Salary inputs */}
        <div className="space-y-3">
          <p className="text-[#5A5A5A] text-[10px] uppercase tracking-wide font-semibold">Salary components</p>
          <label className="block">
            <span className="text-[#5A5A5A] text-xs mb-1 block">Basic (₹)</span>
            <input type="number" value={basic} onChange={(e) => setBasic(e.target.value)} className={inputCls} min="0" />
          </label>
          <label className="block">
            <span className="text-[#5A5A5A] text-xs mb-1 block">HRA (₹)</span>
            <input type="number" value={hra} onChange={(e) => setHra(e.target.value)} className={inputCls} min="0" />
          </label>
          <label className="block">
            <span className="text-[#5A5A5A] text-xs mb-1 block">DA (₹)</span>
            <input type="number" value={da} onChange={(e) => setDa(e.target.value)} className={inputCls} min="0" />
          </label>
          <label className="block">
            <span className="text-[#5A5A5A] text-xs mb-1 block">Special allowance (₹)</span>
            <input type="number" value={spl} onChange={(e) => setSpl(e.target.value)} className={inputCls} min="0" />
          </label>
          <label className="block">
            <span className="text-[#5A5A5A] text-xs mb-1 block">CCA (₹)</span>
            <input type="number" value={cca} onChange={(e) => setCca(e.target.value)} className={inputCls} min="0" />
          </label>
        </div>

        {/* Parameters */}
        <div className="space-y-3">
          <p className="text-[#5A5A5A] text-[10px] uppercase tracking-wide font-semibold">Parameters</p>
          <label className="block">
            <span className="text-[#5A5A5A] text-xs mb-1 block">Location</span>
            <select value={location} onChange={(e) => setLocation(e.target.value)} className={inputCls}>
              {LOCATION_PT.map((l) => (
                <option key={l.city} value={l.city}>{l.city} ({l.state_code})</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[#5A5A5A] text-xs mb-1 block">Gender</span>
            <select value={gender} onChange={(e) => setGender(e.target.value)} className={inputCls}>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[#5A5A5A] text-xs mb-1 block">Month</span>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={inputCls}>
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Result panel */}
        <div className="sm:col-span-2 lg:col-span-1">
          <p className="text-[#5A5A5A] text-[10px] uppercase tracking-wide font-semibold mb-3">Result</p>
          <div className="bg-[#F4F4F2] rounded-xl p-4 space-y-3 border border-[#E2E2DF]">
            <div className="flex justify-between items-center">
              <span className="text-[#5A5A5A] text-xs">Gross salary</span>
              <span className="text-[#1A1A1A] font-semibold text-sm">₹{fmt(result.gross)}</span>
            </div>
            <div className="h-px bg-[#E2E2DF]" />
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[#5A5A5A] text-xs">PF (employee 12%)</span>
                <span className="text-[#DC2626] text-sm font-medium">−₹{fmt(result.pf)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#5A5A5A] text-xs">
                  ESIC (0.75%)
                  {result.gross > 21000 && <span className="ml-1 text-[10px] text-[#D97706]">exempt</span>}
                </span>
                <span className="text-[#DC2626] text-sm font-medium">−₹{fmt(result.esic)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#5A5A5A] text-xs">
                  PT ({loc.state_code})
                </span>
                <span className="text-[#DC2626] text-sm font-medium">−₹{fmt(result.pt)}</span>
              </div>
            </div>
            <div className="h-px bg-[#E2E2DF]" />
            <div className="flex justify-between items-center pt-1">
              <span className="text-[#1A1A1A] font-semibold text-sm">Net pay</span>
              <span className="font-bold text-xl" style={{ color: "#E5202E" }}>₹{fmt(result.net)}</span>
            </div>
          </div>

          {/* Employer cost breakdown */}
          <div className="mt-3 bg-white border border-[#E2E2DF] rounded-xl p-3 space-y-1.5">
            <p className="text-[#5A5A5A] text-[10px] uppercase tracking-wide font-semibold mb-2">Employer cost</p>
            <div className="flex justify-between">
              <span className="text-[#5A5A5A] text-xs">PF (employer 13%)</span>
              <span className="text-[#5A5A5A] text-xs font-medium">₹{fmt(Math.min(Math.round((Number(basic) + Number(da)) * 0.13), 2340))}</span>
            </div>
            {result.gross <= 21000 && (
              <div className="flex justify-between">
                <span className="text-[#5A5A5A] text-xs">ESIC (employer 3.25%)</span>
                <span className="text-[#5A5A5A] text-xs font-medium">₹{fmt(Math.ceil(result.gross * 0.0325))}</span>
              </div>
            )}
            <div className="h-px bg-[#E2E2DF]" />
            <div className="flex justify-between">
              <span className="text-[#5A5A5A] text-xs font-semibold">Total CTC (approx)</span>
              <span className="text-[#1A1A1A] text-xs font-bold">
                ₹{fmt(result.gross + Math.min(Math.round((Number(basic) + Number(da)) * 0.13), 2340) + (result.gross <= 21000 ? Math.ceil(result.gross * 0.0325) : 0))}
              </span>
            </div>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function StatutoryPage() {
  const { user } = useAuth();
  const [statutory, setStatutory] = useState<StatutoryMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatutory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGetStatutory();
      setStatutory(data);
    } catch {
      setError("Failed to load statutory configuration");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatutory(); }, [fetchStatutory]);

  if (!user) return null;

  // Flatten all rows for calculator
  const allRows: StatutoryRow[] = Object.values(statutory).flat();

  // Ordered PT states
  const ptStates = ["WB", "MH", "GJ", "NIL"].filter((s) => statutory[s] || s === "NIL");
  const nilRows = statutory["NIL"] ?? [];

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">

      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#E5202E]/10 flex items-center justify-center shrink-0">
          <Shield size={18} className="text-[#E5202E]" />
        </div>
        <div>
          <h1 className="text-white font-semibold text-xl leading-tight">Statutory rules</h1>
          <p className="text-white/50 text-xs mt-0.5">PF, ESIC, and Professional Tax configuration</p>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-[#E5202E] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <GlassCard className="p-6 text-center">
          <p className="text-[#DC2626] text-sm">{error}</p>
        </GlassCard>
      )}

      {!loading && !error && (
        <>
          {/* PF + ESIC rule cards */}
          <div>
            <h2 className="text-[#1A1A1A] font-semibold text-sm mb-3">Central statutory rules</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

              {/* PF card */}
              <GlassCard className="p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-[#2563EB]/10 flex items-center justify-center shrink-0">
                    <Shield size={14} className="text-[#2563EB]" />
                  </div>
                  <div>
                    <p className="text-[#1A1A1A] font-semibold text-sm">Provident Fund (PF)</p>
                    <p className="text-[#5A5A5A] text-xs">Employee + Employer contribution</p>
                  </div>
                </div>
                <div className="space-y-2.5">
                  <div className="flex justify-between items-center">
                    <span className="text-[#5A5A5A] text-xs">Employee deduction</span>
                    <span className="text-[#1A1A1A] font-semibold text-sm">12% of Basic+DA</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#5A5A5A] text-xs">Employer contribution</span>
                    <span className="text-[#1A1A1A] font-semibold text-sm">13% of Basic+DA</span>
                  </div>
                  <div className="h-px bg-[#E2E2DF]" />
                  <div className="flex justify-between items-center">
                    <span className="text-[#5A5A5A] text-xs">Employee cap</span>
                    <span className="bg-[#2563EB]/10 text-[#2563EB] text-xs font-bold px-2 py-0.5 rounded-full">₹1,800 / month</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#5A5A5A] text-xs">Employer cap</span>
                    <span className="bg-[#2563EB]/10 text-[#2563EB] text-xs font-bold px-2 py-0.5 rounded-full">₹2,340 / month</span>
                  </div>
                  <div className="h-px bg-[#E2E2DF]" />
                  <p className="text-[#5A5A5A] text-[10px] leading-relaxed">
                    Cap applies when Basic+DA exceeds ₹15,000. Employer contribution = EPF 3.67% + EPS 8.33%.
                  </p>
                </div>
              </GlassCard>

              {/* ESIC card */}
              <GlassCard className="p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 rounded-lg bg-[#16A34A]/10 flex items-center justify-center shrink-0">
                    <Shield size={14} className="text-[#16A34A]" />
                  </div>
                  <div>
                    <p className="text-[#1A1A1A] font-semibold text-sm">ESIC</p>
                    <p className="text-[#5A5A5A] text-xs">Employees' State Insurance Corporation</p>
                  </div>
                </div>
                <div className="space-y-2.5">
                  <div className="flex justify-between items-center">
                    <span className="text-[#5A5A5A] text-xs">Employee deduction</span>
                    <span className="text-[#1A1A1A] font-semibold text-sm">0.75% of gross</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#5A5A5A] text-xs">Employer contribution</span>
                    <span className="text-[#1A1A1A] font-semibold text-sm">3.25% of gross</span>
                  </div>
                  <div className="h-px bg-[#E2E2DF]" />
                  <div className="flex justify-between items-center">
                    <span className="text-[#5A5A5A] text-xs">Gross salary ceiling</span>
                    <span className="bg-[#16A34A]/10 text-[#16A34A] text-xs font-bold px-2 py-0.5 rounded-full">≤ ₹21,000 / month</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#5A5A5A] text-xs">Rounding rule</span>
                    <span className="text-[#5A5A5A] text-xs font-medium">Always round UP (math.ceil)</span>
                  </div>
                  <div className="h-px bg-[#E2E2DF]" />
                  <p className="text-[#5A5A5A] text-[10px] leading-relaxed">
                    ESIC is automatically set to ₹0 when gross exceeds ₹21,000. Recomputed on every salary change.
                  </p>
                </div>
              </GlassCard>
            </div>
          </div>

          {/* PT regime */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[#1A1A1A] font-semibold text-sm">Professional Tax (PT) — 9 locations</h2>
              <span className="text-[#5A5A5A] text-xs">Configured per state, queried live from DB</span>
            </div>

            {/* Location → state legend */}
            <GlassCard className="p-4 mb-4">
              <p className="text-[#5A5A5A] text-[10px] uppercase tracking-wide font-semibold mb-3">Location → PT state mapping</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[480px]">
                  <thead>
                    <tr className="border-b border-[#E2E2DF]">
                      {["City", "State", "PT code", "PT status"].map((h) => (
                        <th key={h} className="text-left py-2 pr-4 text-[#5A5A5A] font-semibold text-[10px] uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {LOCATION_PT.map((l) => (
                      <tr key={l.city} className="border-b border-[#E2E2DF] last:border-0">
                        <td className="py-2 pr-4 text-[#1A1A1A] font-medium">{l.city}</td>
                        <td className="py-2 pr-4 text-[#5A5A5A]">{l.state}</td>
                        <td className="py-2 pr-4">
                          <span
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                            style={l.state_code === "NIL"
                              ? { background: "rgba(90,90,90,0.1)", color: "#5A5A5A" }
                              : { background: "rgba(229,32,46,0.1)", color: "#E5202E" }}
                          >
                            {l.state_code}
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          {l.state_code === "NIL" ? (
                            <span className="text-[#5A5A5A] text-xs">Exempt</span>
                          ) : (
                            <span className="text-[#16A34A] text-xs font-medium">Applicable</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </GlassCard>

            {/* PT slab cards */}
            <div className="space-y-3">
              {ptStates.map((sc) => (
                <PTStateCard
                  key={sc}
                  stateCode={sc}
                  rows={sc === "NIL" ? nilRows : (statutory[sc] ?? [])}
                />
              ))}
              {/* Any extra states from DB not in the predefined list */}
              {Object.keys(statutory)
                .filter((sc) => !ptStates.includes(sc))
                .map((sc) => (
                  <PTStateCard key={sc} stateCode={sc} rows={statutory[sc]} />
                ))}
            </div>
          </div>

          {/* Live calculator */}
          <LiveCalculator allRows={allRows} />
        </>
      )}
    </div>
  );
}
