"use client";

import { useEffect, useState, useCallback } from "react";
import GlassCard from "@/components/ui/GlassCard";
import Link from "next/link";
import { useEntityStore } from "@/store/entity";
import { apiGetEmployees, apiDownloadEmployeeExport, apiGetActiveLocations } from "@/lib/api";
import { useAuth, isAdminRole } from "@/lib/auth";
import {
  Users, Plus, Upload, Download, Search,
  ChevronLeft, ChevronRight,
} from "lucide-react";

interface EmpItem {
  emp_code: string;
  sap_code?: string;
  name: string;
  entity_id: string;
  location_city?: string;
  department?: string;
  designation?: string;
  grade?: string;
  status?: string;
}

const ENTITY_COLOR: Record<string, string> = {
  UPPL: "#E5202E",
  USAPL: "#4B5563",
  UAPL: "#16A34A",
  UMPL: "#2563EB",
};

function StatusBadge({ status }: { status?: string }) {
  const s = (status ?? "").toLowerCase();
  const cls =
    s === "active"
      ? "bg-[#16A34A]/10 text-[#16A34A]"
      : s === "inactive"
      ? "bg-[#5A5A5A]/10 text-[#5A5A5A]"
      : s === "exited"
      ? "bg-[#DC2626]/10 text-[#DC2626]"
      : "bg-[#F4F4F2] text-[#6B6B6B]";
  const dotCls =
    s === "active"
      ? "bg-[#16A34A]"
      : s === "inactive"
      ? "bg-[#5A5A5A]"
      : "bg-[#DC2626]";
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>
      {status && <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />}
      {status ?? "—"}
    </span>
  );
}

const PER_PAGE = 25;

// Table columns + their responsive visibility, in render order.
const TABLE_COLS = [
  { label: "Emp code", cls: "" },
  { label: "SAP code", cls: "hidden sm:table-cell" },
  { label: "Name", cls: "" },
  { label: "Entity", cls: "hidden md:table-cell" },
  { label: "Location", cls: "hidden lg:table-cell" },
  { label: "Department", cls: "hidden lg:table-cell" },
  { label: "Designation", cls: "hidden xl:table-cell" },
  { label: "Status", cls: "" },
  { label: "", cls: "text-right" },
];

export default function EmployeesPage() {
  const { user } = useAuth();
  const { selected: entityFilter } = useEntityStore();

  const [employees, setEmployees] = useState<EmpItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [designationFilter, setDesignationFilter] = useState("");
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Load active locations once for the Location filter dropdown.
  useEffect(() => {
    apiGetActiveLocations()
      .then((d) => setLocations(d.locations ?? []))
      .catch(() => setLocations([]));
  }, []);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const params: Record<string, string> = {
        page: String(page),
        per_page: String(PER_PAGE),
      };
      if (entityFilter !== "ALL") params.entity_id = entityFilter;
      if (search.trim()) params.search = search.trim();
      if (statusFilter) params.status = statusFilter;
      if (locationFilter) params.location_id = locationFilter;
      if (departmentFilter.trim()) params.department = departmentFilter.trim();
      if (designationFilter.trim()) params.designation = designationFilter.trim();

      const data = await apiGetEmployees(params);
      setEmployees(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } }; message?: string })?.response?.data?.detail
        ?? (err as { message?: string })?.message
        ?? "Failed to load employees";
      console.error("[employees] fetch error:", err);
      setFetchError(msg);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, [entityFilter, page, search, statusFilter, locationFilter, departmentFilter, designationFilter]);

  // Reset page on filter change
  useEffect(() => { setPage(1); }, [entityFilter, search, statusFilter, locationFilter, departmentFilter, designationFilter]);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params: Record<string, string> = {};
      if (entityFilter !== "ALL") params.entity_id = entityFilter;
      if (statusFilter) params.status = statusFilter;
      if (search.trim()) params.search = search.trim();
      if (locationFilter) params.location_id = locationFilter;
      if (departmentFilter.trim()) params.department = departmentFilter.trim();
      if (designationFilter.trim()) params.designation = designationFilter.trim();
      await apiDownloadEmployeeExport(params);
    } finally {
      setExporting(false);
    }
  };

  const isAdmin = isAdminRole(user);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const from = Math.min((page - 1) * PER_PAGE + 1, total);
  const to = Math.min(page * PER_PAGE, total);

  if (!user) return null;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#E5202E]/10 flex items-center justify-center shrink-0">
            <Users size={18} className="text-[#E5202E]" />
          </div>
          <div>
            <h1 className="text-white font-semibold text-xl leading-tight">Employees</h1>
            <p className="text-[#5A5A5A] text-xs mt-0.5">{loading ? "—" : `${total} total`}</p>
          </div>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-1.5 px-3.5 py-2 text-sm bg-white border border-[#E2E2DF] text-[#1A1A1A] hover:bg-[#F4F4F2] rounded-xl transition min-h-[44px] font-medium disabled:opacity-60"
            >
              <Download size={14} />
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
            <Link
              href="/dashboard/employees/bulk-import"
              className="flex items-center gap-1.5 px-3.5 py-2 text-sm bg-white border border-[#E2E2DF] text-[#1A1A1A] hover:bg-[#F4F4F2] rounded-xl transition min-h-[44px] font-medium"
            >
              <Upload size={14} />
              Bulk import
            </Link>
            <Link
              href="/dashboard/employees/add"
              className="flex items-center gap-1.5 px-3.5 py-2 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition shadow-sm min-h-[44px] font-semibold"
            >
              <Plus size={14} />
              Add employee
            </Link>
          </div>
        )}
      </div>

      {/* Filters */}
      <GlassCard className="p-3 flex flex-col sm:flex-row sm:flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B6B6B] pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, emp / legacy / SAP code…"
            className="w-full bg-white border border-[#E2E2DF] rounded-xl pl-9 pr-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#6B6B6B] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30"
          />
        </div>
        <select
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          className="bg-white border border-[#E2E2DF] rounded-xl px-3 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 min-h-[44px] sm:w-44"
        >
          <option value="">All locations</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <input
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          placeholder="Department"
          className="bg-white border border-[#E2E2DF] rounded-xl px-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#6B6B6B] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 min-h-[44px] sm:w-40"
        />
        <input
          value={designationFilter}
          onChange={(e) => setDesignationFilter(e.target.value)}
          placeholder="Designation"
          className="bg-white border border-[#E2E2DF] rounded-xl px-3 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[#6B6B6B] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 min-h-[44px] sm:w-40"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-white border border-[#E2E2DF] rounded-xl px-3 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 min-h-[44px] sm:w-40"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="exited">Exited</option>
        </select>
      </GlassCard>

      {/* Table */}
      <GlassCard className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b border-[#E2E2DF] bg-[#F4F4F2]/60">
                {TABLE_COLS.map((c, i) => (
                  <th
                    key={i}
                    className={`text-left px-4 py-3 text-[#5A5A5A] font-semibold text-[11px] uppercase tracking-wide whitespace-nowrap ${c.cls}`}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={TABLE_COLS.length} className="text-center py-16 text-[#5A5A5A]">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-[#E5202E] border-t-transparent rounded-full animate-spin" />
                      Loading…
                    </div>
                  </td>
                </tr>
              ) : employees.length === 0 ? (
                <tr>
                  <td colSpan={TABLE_COLS.length} className="text-center py-16">
                    <div className="flex flex-col items-center gap-2">
                      <Users size={32} className="text-[#E2E2DF]" />
                      {fetchError ? (
                        <p className="text-[#DC2626] text-sm font-medium">{fetchError}</p>
                      ) : (
                        <p className="text-[#5A5A5A] text-sm">No employees found</p>
                      )}
                      {isAdmin && !fetchError && (
                        <Link
                          href="/dashboard/employees/add"
                          className="text-xs text-[#E5202E] font-semibold hover:underline mt-1"
                        >
                          Add the first employee →
                        </Link>
                      )}
                      {fetchError && (
                        <button onClick={fetchEmployees} className="text-xs text-[#E5202E] font-semibold hover:underline mt-1">
                          Retry →
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                employees.map((emp) => {
                  const ec = ENTITY_COLOR[emp.entity_id] ?? "#4B5563";
                  return (
                    <tr key={emp.emp_code} className="border-b border-[#E2E2DF] last:border-0 hover:bg-[#F4F4F2]/40 transition">
                      <td className="px-4 py-3.5">
                        <span className="font-mono text-xs font-bold text-[#1A1A1A] bg-[#F4F4F2] px-2 py-1 rounded-lg tracking-wide">
                          {emp.emp_code}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-[#5A5A5A] text-xs font-mono hidden sm:table-cell">{emp.sap_code || "—"}</td>
                      <td className="px-4 py-3.5 font-medium text-[#1A1A1A] whitespace-nowrap">{emp.name}</td>
                      <td className="px-4 py-3.5 hidden md:table-cell">
                        <span
                          className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: `${ec}18`, color: ec }}
                        >
                          {emp.entity_id}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-[#5A5A5A] text-xs hidden lg:table-cell">{emp.location_city ?? "—"}</td>
                      <td className="px-4 py-3.5 text-[#5A5A5A] text-xs hidden lg:table-cell">{emp.department ?? "—"}</td>
                      <td className="px-4 py-3.5 text-[#5A5A5A] text-xs hidden xl:table-cell">{emp.designation ?? "—"}</td>
                      <td className="px-4 py-3.5"><StatusBadge status={emp.status} /></td>
                      <td className="px-4 py-3.5 text-right">
                        <Link
                          href={`/dashboard/employees/${emp.emp_code}`}
                          className="text-xs font-semibold text-[#E5202E] hover:text-[#C81824] hover:underline whitespace-nowrap"
                        >
                          View →
                        </Link>
                      </td>
                    </tr>
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
              {total === 0 ? "No results" : `Showing ${from}–${to} of ${total}`}
            </p>
            <div className="flex items-center gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="w-9 h-9 flex items-center justify-center rounded-lg border border-[#E2E2DF] disabled:opacity-40 hover:bg-[#F4F4F2] transition"
              >
                <ChevronLeft size={14} className="text-[#1A1A1A]" />
              </button>
              <span className="text-xs text-[#1A1A1A] px-2 font-medium">
                {page} / {totalPages}
              </span>
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
