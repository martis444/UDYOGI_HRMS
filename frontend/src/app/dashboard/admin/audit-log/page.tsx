"use client";

import React, { useEffect, useState, useCallback } from "react";
import GlassCard from "@/components/ui/GlassCard";
import { useAuth, hasRole } from "@/lib/auth";
import { apiGetAuditLog } from "@/lib/api";
import {
  Shield, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Search, X,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditEntry {
  id: number;
  user_code: string;
  action: string;
  table_name: string;
  record_id: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  ts: string;
}

// ─── Action badges ────────────────────────────────────────────────────────────

const ACTION_STYLES: Record<string, { label: string; cls: string }> = {
  CREATE:         { label: "Create",        cls: "bg-[#16A34A]/10 text-[#16A34A]" },
  UPDATE:         { label: "Update",        cls: "bg-[#D97706]/10 text-[#D97706]" },
  COLUMN_UPDATE:  { label: "Column update", cls: "bg-[#D97706]/10 text-[#D97706]" },
  DELETE:         { label: "Delete",        cls: "bg-[#DC2626]/10 text-[#DC2626]" },
  LOGIN:          { label: "Login",         cls: "bg-[#2563EB]/10 text-[#2563EB]" },
  EXPORT:         { label: "Export",        cls: "bg-[#5A5A5A]/10 text-[#5A5A5A]" },
  RESET_PASSWORD: { label: "Reset PW",      cls: "bg-[#E5202E]/10 text-[#E5202E]" },
  IMPORT:         { label: "Import",        cls: "bg-[#9333EA]/10 text-[#9333EA]" },
};

const KNOWN_ACTIONS = [
  "CREATE", "UPDATE", "COLUMN_UPDATE", "DELETE",
  "LOGIN", "EXPORT", "RESET_PASSWORD", "IMPORT",
];
const KNOWN_TABLES = [
  "employees", "users", "payroll_months", "attendance_daily",
  "statutory_config", "biometric_mapping",
];

function ActionBadge({ action }: { action: string }) {
  const s = ACTION_STYLES[action] ?? { label: action, cls: "bg-[#F4F4F2] text-[#5A5A5A]" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${s.cls}`}>
      {s.label}
    </span>
  );
}

// ─── Glass card ───────────────────────────────────────────────────────────────

// ─── JSON diff ────────────────────────────────────────────────────────────────

function JsonDiff({
  old_values,
  new_values,
}: {
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
}) {
  if (!old_values && !new_values) {
    return <p className="text-[#5A5A5A] text-xs italic">No payload recorded</p>;
  }

  const keys = Array.from(
    new Set([...Object.keys(old_values ?? {}), ...Object.keys(new_values ?? {})])
  );

  return (
    <div className="space-y-1">
      {keys.map((k) => {
        const oldVal = old_values?.[k];
        const newVal = new_values?.[k];
        const changed =
          JSON.stringify(oldVal) !== JSON.stringify(newVal) &&
          !(old_values === null && newVal !== undefined);
        const showChange = old_values !== null && changed;

        return (
          <div
            key={k}
            className={`flex gap-2 text-xs px-2 py-1.5 rounded-lg ${showChange ? "bg-[#E5202E]/5" : "bg-[#F4F4F2]/60"}`}
          >
            <span className="text-[#5A5A5A] font-mono min-w-[130px] shrink-0 truncate">{k}</span>
            {showChange ? (
              <span className="flex gap-1.5 items-center flex-wrap">
                {oldVal !== undefined && (
                  <span className="line-through text-[#6B6B6B]">{String(oldVal)}</span>
                )}
                <span className="text-[#C0C0C0] text-[10px]">→</span>
                {newVal !== undefined && (
                  <span className="text-[#E5202E] font-semibold">{String(newVal)}</span>
                )}
              </span>
            ) : (
              <span className="text-[#1A1A1A] break-all">
                {String(newVal ?? oldVal ?? "—")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

const PER_PAGE = 50;

export default function AuditLogPage() {
  const { user } = useAuth();

  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [filterUserCode, setFilterUserCode] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterTable, setFilterTable] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        per_page: String(PER_PAGE),
      };
      if (filterUserCode.trim()) params.user_code = filterUserCode.trim();
      if (filterAction) params.action = filterAction;
      if (filterTable) params.table_name = filterTable;
      if (filterFrom) params.from_date = filterFrom;
      if (filterTo) params.to_date = filterTo;

      const data = await apiGetAuditLog(params);
      setLogs(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [page, filterUserCode, filterAction, filterTable, filterFrom, filterTo]);

  useEffect(() => { setPage(1); }, [filterUserCode, filterAction, filterTable, filterFrom, filterTo]);
  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const clearFilters = () => {
    setFilterUserCode(""); setFilterAction(""); setFilterTable("");
    setFilterFrom(""); setFilterTo(""); setPage(1);
  };

  const hasFilters = filterUserCode || filterAction || filterTable || filterFrom || filterTo;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const from = Math.min((page - 1) * PER_PAGE + 1, total);
  const to = Math.min(page * PER_PAGE, total);

  if (!user) return null;

  if (!hasRole(user, "super_admin", "entity_admin")) {
    return (
      <div className="p-6 text-center text-[#5A5A5A] text-sm">
        Access restricted to administrators.
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#E5202E]/10 flex items-center justify-center shrink-0">
          <Shield size={18} className="text-[#E5202E]" />
        </div>
        <div>
          <h1 className="text-white font-semibold text-xl leading-tight">Audit log</h1>
          <p className="text-[#5A5A5A] text-xs mt-0.5">
            {loading ? "—" : `${total.toLocaleString("en-IN")} entries, newest first`}
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <GlassCard className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B6B6B] pointer-events-none" />
            <input
              value={filterUserCode}
              onChange={(e) => setFilterUserCode(e.target.value)}
              placeholder="User code…"
              className="w-full bg-white border border-[#E2E2DF] rounded-xl pl-8 pr-3 py-2 text-sm text-[#1A1A1A] placeholder:text-[#6B6B6B] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 min-h-[40px]"
            />
          </div>

          <select
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            className="bg-white border border-[#E2E2DF] rounded-xl px-3 py-2 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 min-h-[40px]"
          >
            <option value="">All actions</option>
            {KNOWN_ACTIONS.map((a) => (
              <option key={a} value={a}>{ACTION_STYLES[a]?.label ?? a}</option>
            ))}
          </select>

          <select
            value={filterTable}
            onChange={(e) => setFilterTable(e.target.value)}
            className="bg-white border border-[#E2E2DF] rounded-xl px-3 py-2 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 min-h-[40px]"
          >
            <option value="">All tables</option>
            {KNOWN_TABLES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>

          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="bg-white border border-[#E2E2DF] rounded-xl px-3 py-2 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 min-h-[40px]"
          />

          <div className="flex gap-2">
            <input
              type="date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              className="flex-1 bg-white border border-[#E2E2DF] rounded-xl px-3 py-2 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 min-h-[40px]"
            />
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="w-10 h-10 flex items-center justify-center rounded-xl border border-[#E2E2DF] hover:bg-[#F4F4F2] text-[#5A5A5A] transition shrink-0"
                title="Clear filters"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </GlassCard>

      {/* Table */}
      <GlassCard className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead>
              <tr className="border-b border-[#E2E2DF] bg-[#F4F4F2]/60">
                {["Timestamp", "User", "Action", "Table", "Record", ""].map((h, i) => (
                  <th
                    key={i}
                    className={`text-left px-4 py-3 text-[#5A5A5A] font-semibold text-[11px] uppercase tracking-wide whitespace-nowrap ${
                      i === 3 ? "hidden lg:table-cell" : i === 5 ? "w-8" : ""
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-16 text-[#5A5A5A]">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-[#E5202E] border-t-transparent rounded-full animate-spin" />
                      Loading…
                    </div>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-16">
                    <div className="flex flex-col items-center gap-2">
                      <Shield size={32} className="text-[#E2E2DF]" />
                      <p className="text-[#5A5A5A] text-sm">No audit log entries found</p>
                      {hasFilters && (
                        <button
                          onClick={clearFilters}
                          className="text-xs text-[#E5202E] font-semibold hover:underline"
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isExpanded = expandedId === log.id;
                  return (
                    <React.Fragment key={log.id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : log.id)}
                        className="border-b border-[#E2E2DF] hover:bg-[#F4F4F2]/40 transition cursor-pointer"
                      >
                        <td className="px-4 py-3 text-xs text-[#5A5A5A] whitespace-nowrap font-mono">
                          {new Date(log.ts).toLocaleString("en-IN", {
                            day: "2-digit", month: "short", year: "numeric",
                            hour: "2-digit", minute: "2-digit", hour12: false,
                          })}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs bg-[#F4F4F2] px-1.5 py-0.5 rounded font-bold text-[#1A1A1A]">
                            {log.user_code}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <ActionBadge action={log.action} />
                        </td>
                        <td className="px-4 py-3 text-xs text-[#5A5A5A] hidden lg:table-cell font-mono">
                          {log.table_name}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-mono text-[#1A1A1A]">{log.record_id}</span>
                        </td>
                        <td className="px-4 py-3">
                          {isExpanded
                            ? <ChevronUp size={14} className="text-[#5A5A5A] ml-auto" />
                            : <ChevronDown size={14} className="text-[#5A5A5A] ml-auto" />}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="border-b border-[#E2E2DF] bg-[#FAFAFA]">
                          <td colSpan={6} className="px-6 py-4">
                            <div className="space-y-3 max-w-3xl">
                              <div className="flex items-center gap-4 text-xs text-[#5A5A5A]">
                                <span>
                                  Table: <span className="font-mono text-[#1A1A1A]">{log.table_name}</span>
                                </span>
                                {log.ip_address && (
                                  <span>
                                    IP: <span className="font-mono text-[#1A1A1A]">{log.ip_address}</span>
                                  </span>
                                )}
                              </div>
                              <JsonDiff old_values={log.old_values} new_values={log.new_values} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#E2E2DF]">
            <p className="text-xs text-[#5A5A5A]">
              {total === 0 ? "No results" : `Showing ${from}–${to} of ${total.toLocaleString("en-IN")}`}
            </p>
            <div className="flex items-center gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="w-9 h-9 flex items-center justify-center rounded-lg border border-[#E2E2DF] disabled:opacity-40 hover:bg-[#F4F4F2] transition"
              >
                <ChevronLeft size={14} className="text-[#1A1A1A]" />
              </button>
              <span className="text-xs text-[#1A1A1A] px-2 font-medium">{page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="w-9 h-9 flex items-center justify-center rounded-lg border border-[#E2E2DF] disabled:opacity-40 hover:bg-[#F4F4F2] transition"
              >
                <ChevronRight size={14} className="text-[#1A1A1A]" />
              </button>
            </div>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
