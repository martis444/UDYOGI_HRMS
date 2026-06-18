"use client";

import axios from "axios";

// `??` (not `||`) so an explicit empty value is honored: empty = same-origin
// (relative) base, used in the Docker/Caddy deploy where every request path
// already starts with "/api". Dev sets a real origin (e.g. http://localhost:8000)
// in .env.local; when unset entirely we fall back to localhost:8000.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refresh = localStorage.getItem("refresh_token");

      if (refresh) {
        try {
          const { data } = await axios.post(`${API_BASE}/api/auth/refresh`, {
            refresh_token: refresh,
          });
          localStorage.setItem("access_token", data.access_token);
          original.headers.Authorization = `Bearer ${data.access_token}`;
          return api(original);
        } catch {
          clearTokens();
          if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
            window.location.href = "/login";
          }
        }
      } else {
        clearTokens();
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
          window.location.href = "/login";
        }
      }
    }

    return Promise.reject(error);
  }
);

export function clearTokens() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  localStorage.removeItem("user");
  document.cookie = "auth_session=; path=/; max-age=0; SameSite=Lax";
}

export function storeTokens(data: {
  access_token: string;
  refresh_token?: string;
  emp_code?: string;
  name?: string;
  role?: string;
  entity_id?: string;
  is_first_login?: boolean;
}) {
  localStorage.setItem("access_token", data.access_token);
  if (data.refresh_token) {
    localStorage.setItem("refresh_token", data.refresh_token);
  }
  if (data.emp_code) {
    const user = {
      emp_code: data.emp_code,
      name: data.name ?? "",
      role: data.role ?? "",
      entity_id: data.entity_id ?? "",
      is_first_login: data.is_first_login ?? false,
    };
    localStorage.setItem("user", JSON.stringify(user));
  }
  document.cookie = `auth_session=1; path=/; max-age=86400; SameSite=Lax`;
}

// ─── Auth ───────────────────────────────────────────────────────────────────

export async function apiLogin(emp_code: string, password: string) {
  const { data } = await api.post("/api/auth/login", { emp_code, password });
  return data;
}

export async function apiChangePassword(
  current_password: string,
  new_password: string
) {
  const { data } = await api.post("/api/auth/change-password", {
    current_password,
    new_password,
  });
  return data;
}

// ─── Employees ───────────────────────────────────────────────────────────────

export async function apiGetEmployees(params?: Record<string, string>) {
  const { data } = await api.get("/api/employees", { params });
  return data;
}

export async function apiGetEmployee(code: string) {
  const { data } = await api.get(`/api/employees/${code}`);
  return data;
}

// ─── Salary structure history + increments ────────────────────────────────────

export interface SalaryStructureRow {
  id: number;
  effective_from: string;
  effective_to: string | null;
  basic: number;
  hra: number;
  da: number;
  spl: number;
  cca: number;
  leave_travel: number;
  other_allowance: number;
  gross: number;
  reason: string;
  created_by: string | null;
  created_at: string | null;
  status: "active" | "historical";
}

export async function apiGetSalaryHistory(
  emp_code: string,
): Promise<{ emp_code: string; structures: SalaryStructureRow[] }> {
  const { data } = await api.get(`/api/employees/${emp_code}/salary-history`);
  return data;
}

export async function apiApplyIncrement(
  emp_code: string,
  payload: Record<string, unknown>,
): Promise<{ structure: SalaryStructureRow; gross: number }> {
  const { data } = await api.post(`/api/employees/${emp_code}/increment`, payload);
  return data;
}

// ─── Locations (GSTN) ─────────────────────────────────────────────────────────

export interface LocationRow {
  id: string;
  name: string;
  gstn: string | null;
  city: string;
  state: string;
  pt_state_code: string;
  entity_id: string | null;
  status: "active" | "inactive";
  phone: string | null;
}

export async function apiGetLocations(): Promise<{ locations: LocationRow[] }> {
  const { data } = await api.get("/api/locations");
  return data;
}

export async function apiGetActiveLocations(): Promise<{ locations: { id: string; name: string }[] }> {
  const { data } = await api.get("/api/locations/active");
  return data;
}

export async function apiCreateLocation(body: Record<string, unknown>): Promise<LocationRow> {
  const { data } = await api.post("/api/locations", body);
  return data;
}

export async function apiUpdateLocation(id: string, body: Record<string, unknown>): Promise<LocationRow> {
  const { data } = await api.put(`/api/locations/${id}`, body);
  return data;
}

export async function apiDeleteLocation(id: string, hard = false): Promise<{ message: string }> {
  const { data } = await api.delete(`/api/locations/${id}`, { params: hard ? { hard: true } : {} });
  return data;
}

// ─── Meta / system stats ──────────────────────────────────────────────────────

export interface SystemStats {
  employees_total: number;
  employees_active: number;
  entities: number;
  locations_active: number;
  payroll_months_processed: number;
  payroll_months_locked: number;
  loans_active: number;
  db_table_count: number;
  app_version: string;
  server_time: string;
}

export async function apiGetSystemStats(): Promise<SystemStats> {
  const { data } = await api.get("/api/meta/system-stats");
  return data;
}

// ─── Loans / advances ─────────────────────────────────────────────────────────

export interface LoanRow {
  id: number;
  emp_code: string;
  name: string | null;
  loan_type: string;
  principal: number;
  emi: number;
  outstanding: number;
  tenure_months: number;
  start_date: string | null;
  end_date: string | null;
  status: "active" | "paused" | "closed" | "written_off";
  remarks: string | null;
}

export interface LoanScheduleRow {
  year: number;
  month: number;
  scheduled_emi: number;
  actual_emi: number;
  is_overridden: boolean;
  override_reason: string | null;
  overridden_by: string | null;
  applied: boolean;
}

export async function apiGetLoans(params?: Record<string, string>): Promise<{ loans: LoanRow[] }> {
  const { data } = await api.get("/api/loans", { params });
  return data;
}

export async function apiGetLoan(id: number): Promise<LoanRow & { schedule: LoanScheduleRow[] }> {
  const { data } = await api.get(`/api/loans/${id}`);
  return data;
}

export async function apiCreateLoan(body: Record<string, unknown>): Promise<LoanRow> {
  const { data } = await api.post("/api/loans", body);
  return data;
}

export async function apiUpdateLoan(id: number, body: Record<string, unknown>): Promise<LoanRow> {
  const { data } = await api.put(`/api/loans/${id}`, body);
  return data;
}

export async function apiOverrideLoanEmi(
  id: number,
  body: { year: number; month: number; emi: number; reason: string },
): Promise<LoanScheduleRow> {
  const { data } = await api.post(`/api/loans/${id}/override`, body);
  return data;
}

export async function apiCloseLoan(id: number): Promise<LoanRow> {
  const { data } = await api.post(`/api/loans/${id}/close`);
  return data;
}

// ─── Payroll console (status / process / lock / unlock) ───────────────────────

export interface PayrollMonthRow {
  entity_id: string;
  year: number;
  month: number;
  employee_count: number;
  status: "draft" | "processed" | "locked";
  total_net: number;
  total_gross: number;
  locked_count: number;
  processed_count: number;
  draft_count: number;
  locked_at: string | null;
}

export interface ProcessMonthResult {
  processed: number;
  errors: { emp_code: string; error: string }[];
}

export async function apiGetPayrollMonths(
  params: { entity_id?: string; year?: number },
): Promise<{ year: number; months: PayrollMonthRow[] }> {
  const { data } = await api.get("/api/payroll/months", { params });
  return data;
}

export async function apiProcessMonth(
  body: { entity_id: string; year: number; month: number },
): Promise<ProcessMonthResult> {
  const { data } = await api.post("/api/payslip/process-month", body);
  return data;
}

export async function apiLockPayroll(
  body: { entity_id: string; year: number; month: number },
): Promise<{ locked_count: number; status: string }> {
  const { data } = await api.post("/api/payroll/lock", body);
  return data;
}

export async function apiUnlockPayroll(
  body: { entity_id: string; year: number; month: number; reason: string },
): Promise<{ unlocked_count: number; status: string }> {
  const { data } = await api.post("/api/payroll/unlock", body);
  return data;
}

// ─── Payslip ─────────────────────────────────────────────────────────────────

export async function apiGetPayslip(emp_code: string, year: number, month: number) {
  const { data } = await api.get("/api/payslip/data", {
    params: { emp_code, year, month },
  });
  return data;
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export async function apiGetMasterData(params?: Record<string, string>) {
  const { data } = await api.get("/api/admin/master-data", { params });
  return data;
}

export async function apiGetAuditLog(params?: Record<string, string>) {
  const { data } = await api.get("/api/admin/audit-log", { params });
  return data;
}

export async function apiGetStatutory() {
  const { data } = await api.get("/api/admin/statutory");
  return data;
}

export async function apiGetFormOptions() {
  const { data } = await api.get("/api/admin/form-options");
  return data;
}

// ─── Employee mutations ───────────────────────────────────────────────────────

export async function apiGetNextEmpCode(entity_id: string) {
  const { data } = await api.get("/api/employees/next-code", { params: { entity_id } });
  return data;
}

export async function apiCreateEmployee(body: Record<string, unknown>) {
  const { data } = await api.post("/api/employees", body);
  return data;
}

export async function apiUpdateEmployee(code: string, body: Record<string, unknown>) {
  const { data } = await api.put(`/api/employees/${code}`, body);
  return data;
}

export async function apiDeleteEmployee(code: string) {
  const { data } = await api.delete(`/api/employees/${code}`);
  return data;
}

// ─── Bulk import ──────────────────────────────────────────────────────────────

export async function apiBulkImportValidate(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await api.post("/api/employees/bulk-import/validate", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function apiBulkImportCommit(rows: unknown[], filename: string) {
  const { data } = await api.post("/api/employees/bulk-import/commit", { rows, filename });
  return data;
}

// ─── File downloads ───────────────────────────────────────────────────────────

export async function apiDownloadEmployeeExport(params?: Record<string, string>) {
  const response = await api.get("/api/employees/export", {
    params,
    responseType: "blob",
  });
  const url = URL.createObjectURL(response.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "employees_export.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function apiResetPassword(emp_code: string) {
  const { data } = await api.post("/api/admin/reset-password", { emp_code });
  return data;
}

export async function apiColumnUpdateTemplate(columns: string[], entity_id: string) {
  const response = await api.post(
    "/api/admin/column-update/template",
    { columns, entity_id },
    { responseType: "blob" }
  );
  const url = URL.createObjectURL(response.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "column_update_template.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function apiColumnUpdateValidate(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await api.post("/api/admin/column-update/validate", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function apiColumnUpdateCommit(change_set: unknown[]) {
  const { data } = await api.post("/api/admin/column-update/commit", { change_set });
  return data;
}

// ─── Attendance ───────────────────────────────────────────────────────────────

export async function apiGetAttendanceSummary(month: number, year: number, entity_id: string) {
  const { data } = await api.get("/api/attendance/monthly-summary", {
    params: { month, year, entity_id },
  });
  return data;
}

export async function apiGetAttendanceDaily(emp_code: string, from_date: string, to_date: string) {
  const { data } = await api.get("/api/attendance/daily", {
    params: { emp_code, from_date, to_date },
  });
  return data;
}

export async function apiDownloadAttendanceTemplate(month: number, year: number, entity_id: string) {
  const token = localStorage.getItem("access_token");
  const params = new URLSearchParams({ month: String(month), year: String(year), entity_id });
  const res = await fetch(`${API_BASE}/api/attendance/template?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Template request failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendance_template_${year}_${String(month).padStart(2, "0")}_${entity_id}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function apiAttendanceImportValidate(
  file: File,
  year: number,
  month: number,
  entity_id: string
) {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await api.post("/api/attendance/import/validate", formData, {
    params: { year, month, entity_id },
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function apiAttendanceImportCommit(
  year: number,
  month: number,
  entity_id: string,
  rows: unknown[]
) {
  const { data } = await api.post("/api/attendance/import/commit", { year, month, entity_id, rows });
  return data;
}

export async function apiDownloadPayslipPdf(emp_code: string, year: number, month: number) {
  const token = localStorage.getItem("access_token");
  const params = new URLSearchParams({ emp_code, year: String(year), month: String(month) });
  const res = await fetch(`${API_BASE}/api/payslip/pdf?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`PDF request failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payslip_${emp_code}_${year}_${String(month).padStart(2, "0")}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Leave ────────────────────────────────────────────────────────────────────

export interface LeaveBalanceEntry {
  year: number;
  entitlement: number;
  used: number;
  balance: number;
  carried_forward: number;
  accrued_ytd: number;
  taken_ytd: number;
  encashed_ytd: number;
}

export interface LeaveBalanceMeta {
  category: string;
  is_on_probation: boolean;
  service_years: number;
  daily_rate: number;
  pl_cash_value: number;
  pl_eligible: boolean;
}

export interface LeaveBalanceResponse {
  CL?: LeaveBalanceEntry;
  SL?: LeaveBalanceEntry;
  PL?: LeaveBalanceEntry;
  _meta?: LeaveBalanceMeta;
}

export async function apiGetLeaveBalance(emp_code: string): Promise<LeaveBalanceResponse> {
  const { data } = await api.get(`/api/leave/balance/${emp_code}`);
  return data;
}

// ─── Leave Requests ───────────────────────────────────────────────────────────

export interface LeaveRequest {
  id: number;
  emp_code: string;
  employee_name?: string;
  leave_type: string;
  from_date: string;
  to_date: string;
  days: number;
  reason?: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  approved_by?: string;
  approved_at?: string;
  created_at?: string;
}

export async function apiApplyLeave(body: {
  leave_type: string;
  from_date: string;
  to_date: string;
  reason?: string;
}): Promise<LeaveRequest> {
  const { data } = await api.post("/api/leave/apply", body);
  return data;
}

export async function apiMyLeaveRequests(): Promise<LeaveRequest[]> {
  const { data } = await api.get("/api/leave/my-requests");
  return data;
}

export async function apiPendingLeaveRequests(): Promise<LeaveRequest[]> {
  const { data } = await api.get("/api/leave/pending");
  return data;
}

export async function apiPendingLeaveCount(): Promise<{ count: number }> {
  const { data } = await api.get("/api/leave/pending-count");
  return data;
}

export async function apiApproveLeave(id: number): Promise<{ message: string }> {
  const { data } = await api.put(`/api/leave/approve/${id}`);
  return data;
}

export async function apiRejectLeave(id: number, reason?: string): Promise<{ message: string }> {
  const { data } = await api.put(`/api/leave/reject/${id}`, { reason });
  return data;
}

export async function apiCancelLeave(id: number): Promise<{ message: string }> {
  const { data } = await api.put(`/api/leave/cancel/${id}`);
  return data;
}

export interface LeaveTrackerEmployee {
  emp_code: string;
  name: string;
  entity_id: string;
  category: string;
  is_on_probation: boolean;
  service_years: number;
  basic: number;
  daily_rate: number;
  CL: { balance: number; used: number; entitlement: number };
  SL: { balance: number; used: number; entitlement: number };
  PL: { balance: number; used: number; encashed_ytd: number };
  pl_cash_value: number;
  pl_eligible: boolean;
  streak_months: number;
  streak_goal: number;
  streak_achieved: boolean;
}

export async function apiLeaveTracker(entity_id?: string): Promise<{
  employees: LeaveTrackerEmployee[];
  total: number;
  year: number;
}> {
  const { data } = await api.get("/api/leave/tracker", {
    params: entity_id ? { entity_id } : {},
  });
  return data;
}

// ─── Punch attendance ─────────────────────────────────────────────────────────

export interface TodayAttendance {
  punched_in: boolean;
  punched_out: boolean;
  first_in: string | null;
  last_out: string | null;
  hours_worked: number | null;
}

export interface PunchResult extends TodayAttendance {
  punch_type: "in" | "out";
}

export async function apiGetTodayAttendance(): Promise<TodayAttendance> {
  const { data } = await api.get("/api/attendance/today");
  return data;
}

export async function apiPunch(): Promise<PunchResult> {
  const { data } = await api.post("/api/attendance/punch");
  return data;
}

export async function apiGetLeaveStreak(emp_code: string): Promise<{
  emp_code: string;
  streak_months: number;
  streak_goal: number;
  streak_achieved: boolean;
}> {
  const { data } = await api.get(`/api/leave/streak/${emp_code}`);
  return data;
}
