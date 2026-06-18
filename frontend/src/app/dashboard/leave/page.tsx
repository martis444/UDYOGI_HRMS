"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useEntityStore, ENTITIES } from "@/store/entity";
import { apiLeaveTracker } from "@/lib/api";
import type { LeaveTrackerEmployee } from "@/lib/api";
import { Search, Users, X } from "lucide-react";
import GlassCard from "@/components/ui/GlassCard";
import { ENTITY_COLORS } from "@/lib/entities";

const ALLOWED_ROLES = ["super_admin", "entity_admin"];

function BalancePill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      className="flex flex-col items-center px-2.5 py-1.5 rounded-lg min-w-[44px]"
      style={{ background: `${color}12`, border: `1px solid ${color}25` }}
    >
      <span className="text-[10px] font-bold" style={{ color }}>{label}</span>
      <span className="text-[#1A1A1A] text-sm font-bold leading-tight">{Math.floor(value)}</span>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string | number; sub: string; color: string;
}) {
  return (
    <GlassCard className="p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${color}14` }}>
          <Icon size={15} color={color} />
        </div>
        <div>
          <p className="text-[#5A5A5A] text-xs">{label}</p>
          <p className="text-[#1A1A1A] font-bold text-xl leading-tight">{value}</p>
          <p className="text-[#6B6B6B] text-[11px] mt-0.5">{sub}</p>
        </div>
      </div>
    </GlassCard>
  );
}

export default function LeaveTrackerPage() {
  const { user } = useAuth();
  const router   = useRouter();
  const { selected } = useEntityStore();

  const [data, setData]                 = useState<LeaveTrackerEmployee[]>([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState("");
  const [entityFilter, setEntityFilter] = useState<string>("ALL");
  const [selectedEmpCode, setSelectedEmpCode] = useState<string | null>(null);

  const isSuperAdmin = user?.role === "super_admin";

  useEffect(() => {
    if (user && !ALLOWED_ROLES.includes(user.role)) {
      router.replace("/dashboard");
    }
  }, [user, router]);

  useEffect(() => {
    setLoading(true);
    const scope = isSuperAdmin ? undefined : (selected !== "ALL" ? selected : undefined);
    apiLeaveTracker(scope)
      .then((d) => setData(d.employees))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [isSuperAdmin, selected]);

  const filtered = useMemo(() => {
    let list = data;
    if (isSuperAdmin && entityFilter !== "ALL") {
      list = list.filter((e) => e.entity_id === entityFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) => e.name.toLowerCase().includes(q) || e.emp_code.toLowerCase().includes(q)
      );
    }
    return list;
  }, [data, entityFilter, search, isSuperAdmin]);

  const selectedEmployee = filtered.find((e) => e.emp_code === selectedEmpCode) ?? null;

  // Reset selection when the chosen employee leaves the filtered view
  useEffect(() => {
    if (selectedEmpCode && !filtered.find((e) => e.emp_code === selectedEmpCode)) {
      setSelectedEmpCode(null);
    }
  }, [filtered, selectedEmpCode]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-white font-semibold text-xl">Leave tracker</h1>
        <p className="text-white/50 text-sm mt-0.5">
          Leave balances for all active employees
        </p>
      </div>

      {/* Summary card */}
      <div className="max-w-xs">
        <StatCard icon={Users} label="Active employees" value={filtered.length} sub="in scope" color="#E5202E" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B6B6B]" />
          <input
            type="text"
            placeholder="Search name or code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-black/10 bg-white/70 text-[#1A1A1A] text-sm focus:outline-none focus:ring-2 focus:ring-[#E5202E]/30 placeholder:text-[#B0B0B0]"
          />
        </div>

        {isSuperAdmin && (
          <div className="flex gap-2 flex-wrap">
            {ENTITIES.map(({ id }) => (
              <button
                key={id}
                onClick={() => setEntityFilter(id)}
                className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-150"
                style={
                  entityFilter === id
                    ? { background: ENTITY_COLORS[id] ?? "#1A1A1A", color: "#fff" }
                    : { background: "rgba(255,255,255,0.72)", color: "#5A5A5A", border: "1px solid rgba(0,0,0,0.08)" }
                }
              >
                {id}
              </button>
            ))}
          </div>
        )}

        <span className="text-white/40 text-xs ml-auto">
          {filtered.length} employee{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <GlassCard className="overflow-hidden">
        {loading ? (
          <div className="flex items-center gap-3 p-6">
            <div className="w-4 h-4 rounded-full border-2 border-[#E5202E] border-t-transparent animate-spin" />
            <span className="text-[#5A5A5A] text-sm">Loading leave data…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-[#6B6B6B] text-sm">No employees found.</div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/[0.07]">
                    {["Employee", "Entity", "CL", "SL", "PL", "Status"].map((h) => (
                      <th key={h} className="text-left text-[#6B6B6B] text-[11px] font-semibold uppercase tracking-wide px-4 py-3 first:pl-5 last:pr-5">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.05]">
                  {filtered.map((emp) => {
                    const ec = ENTITY_COLORS[emp.entity_id] ?? "#6B7280";
                    const isSelected = emp.emp_code === selectedEmpCode;
                    return (
                      <tr
                        key={emp.emp_code}
                        onClick={() => setSelectedEmpCode((prev) => prev === emp.emp_code ? null : emp.emp_code)}
                        className={`cursor-pointer transition-colors ${isSelected ? "bg-[#E5202E]/[0.06]" : "hover:bg-black/[0.025]"}`}
                      >
                        {/* Employee */}
                        <td className="px-5 py-3.5">
                          <p className="text-[#1A1A1A] font-semibold text-sm">{emp.name}</p>
                          <p className="text-[#6B6B6B] text-xs">{emp.emp_code}</p>
                        </td>
                        {/* Entity */}
                        <td className="px-4 py-3.5">
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${ec}14`, color: ec }}>
                            {emp.entity_id}
                          </span>
                        </td>
                        {/* CL */}
                        <td className="px-4 py-3.5">
                          <span className="text-[#1A1A1A] font-semibold">{Math.floor(emp.CL.balance)}</span>
                          <span className="text-[#6B6B6B] text-xs"> / {Math.floor(emp.CL.entitlement)}</span>
                        </td>
                        {/* SL */}
                        <td className="px-4 py-3.5">
                          <span className="text-[#1A1A1A] font-semibold">{Math.floor(emp.SL.balance)}</span>
                          <span className="text-[#6B6B6B] text-xs"> / {Math.floor(emp.SL.entitlement)}</span>
                        </td>
                        {/* PL */}
                        <td className="px-4 py-3.5">
                          {!emp.pl_eligible ? (
                            <span className="text-[#6B6B6B] text-xs italic">{"< 1yr"}</span>
                          ) : (
                            <span className="text-[#1A1A1A] font-semibold">{emp.PL.balance.toFixed(1)}</span>
                          )}
                        </td>
                        {/* Status */}
                        <td className="px-4 pr-5 py-3.5">
                          {emp.category === "worker" ? (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Worker</span>
                          ) : emp.is_on_probation ? (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(217,119,6,0.12)", color: "#D97706" }}>Probation</span>
                          ) : (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(22,163,74,0.12)", color: "#16A34A" }}>
                              {emp.service_years}yr service
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-black/[0.05]">
              {filtered.map((emp) => {
                const ec = ENTITY_COLORS[emp.entity_id] ?? "#6B7280";
                const isSelected = emp.emp_code === selectedEmpCode;
                return (
                  <div
                    key={emp.emp_code}
                    onClick={() => setSelectedEmpCode((prev) => prev === emp.emp_code ? null : emp.emp_code)}
                    className={`p-4 space-y-3 cursor-pointer transition-colors ${isSelected ? "bg-[#E5202E]/[0.06]" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[#1A1A1A] font-semibold text-sm">{emp.name}</p>
                        <p className="text-[#6B6B6B] text-xs">{emp.emp_code}</p>
                      </div>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${ec}14`, color: ec }}>
                        {emp.entity_id}
                      </span>
                    </div>
                    <div className="flex gap-2 justify-center">
                      <BalancePill label="CL" value={emp.CL.balance} color="#E5202E" />
                      <BalancePill label="SL" value={emp.SL.balance} color="#D97706" />
                      {emp.pl_eligible
                        ? <BalancePill label="PL" value={emp.PL.balance} color="#2563EB" />
                        : <div className="flex flex-col items-center px-2.5 py-1.5 rounded-lg" style={{ background: "#6B728012", border: "1px solid #6B728025" }}>
                            <span className="text-[10px] font-bold text-gray-400">PL</span>
                            <span className="text-xs text-gray-400">—</span>
                          </div>
                      }
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </GlassCard>

      {/* Selected employee detail panel */}
      {selectedEmployee && (() => {
        const emp = selectedEmployee;
        const ec = ENTITY_COLORS[emp.entity_id] ?? "#6B7280";
        return (
          <GlassCard className="p-5 rise-in">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-black/[0.07]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[#1A1A1A] font-semibold">{emp.name}</span>
                <span className="text-[#6B6B6B] text-xs">{emp.emp_code}</span>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${ec}14`, color: ec }}>
                  {emp.entity_id}
                </span>
              </div>
              <button
                onClick={() => setSelectedEmpCode(null)}
                aria-label="Close detail panel"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#6B6B6B] hover:bg-black/[0.05] hover:text-[#5A5A5A] transition-colors shrink-0"
              >
                <X size={15} />
              </button>
            </div>

            {/* Leave balances row */}
            <div className="flex gap-2.5 flex-wrap justify-center pt-4">
              <div className="flex flex-col px-3.5 py-2 rounded-xl" style={{ background: "rgba(229,32,46,0.07)" }}>
                <span className="text-[10px] font-bold" style={{ color: "#E5202E" }}>CL</span>
                <span className="text-[#1A1A1A] text-sm font-bold leading-tight">{Math.floor(emp.CL.used)}/{Math.floor(emp.CL.entitlement)}</span>
              </div>
              <div className="flex flex-col px-3.5 py-2 rounded-xl" style={{ background: "rgba(217,119,6,0.07)" }}>
                <span className="text-[10px] font-bold" style={{ color: "#D97706" }}>SL</span>
                <span className="text-[#1A1A1A] text-sm font-bold leading-tight">{Math.floor(emp.SL.used)}/{Math.floor(emp.SL.entitlement)}</span>
              </div>
              <div className="flex flex-col px-3.5 py-2 rounded-xl" style={{ background: "rgba(37,99,235,0.07)" }}>
                <span className="text-[10px] font-bold" style={{ color: "#2563EB" }}>PL</span>
                <span className="text-[#1A1A1A] text-sm font-bold leading-tight">{emp.PL.balance.toFixed(1)}</span>
              </div>
            </div>
          </GlassCard>
        );
      })()}
    </div>
  );
}
