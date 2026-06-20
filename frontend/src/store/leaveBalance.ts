import { create } from "zustand";
import { useEffect } from "react";
import { apiGetLeaveBalance, type LeaveBalanceResponse } from "@/lib/api";

// Shared leave-balance cache (15.7) keyed by emp_code, so the dashboard card and
// the apply page read ONE cache entry and never drift. Mutations invalidate the
// key (every mounted view refetches); window-focus refetches stale tabs.

interface Entry {
  data: LeaveBalanceResponse | null;
  loading: boolean;
  error: boolean;
}

interface LeaveBalanceStore {
  byEmp: Record<string, Entry>;
  fetch: (emp: string, force?: boolean) => Promise<void>;
  invalidate: (emp: string) => void;
}

export const useLeaveBalanceStore = create<LeaveBalanceStore>((set, get) => ({
  byEmp: {},
  fetch: async (emp, force = false) => {
    if (!emp) return;
    const cur = get().byEmp[emp];
    if (cur?.loading) return;            // de-dupe in-flight
    if (cur?.data && !force) return;     // cached; refetch only on force (mutation/focus)
    set((s) => ({ byEmp: { ...s.byEmp, [emp]: { data: cur?.data ?? null, loading: true, error: false } } }));
    try {
      const data = await apiGetLeaveBalance(emp);
      set((s) => ({ byEmp: { ...s.byEmp, [emp]: { data, loading: false, error: false } } }));
    } catch {
      set((s) => ({ byEmp: { ...s.byEmp, [emp]: { data: cur?.data ?? null, loading: false, error: true } } }));
    }
  },
  invalidate: (emp) => { void get().fetch(emp, true); },
}));

/** Hook: one shared cache entry per emp_code, with refetch-on-window-focus. */
export function useLeaveBalance(empCode: string | undefined) {
  const entry = useLeaveBalanceStore((s) => (empCode ? s.byEmp[empCode] : undefined));
  const fetch = useLeaveBalanceStore((s) => s.fetch);

  useEffect(() => {
    if (!empCode) return;
    void fetch(empCode);
    const onFocus = () => fetch(empCode, true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [empCode, fetch]);

  return { balances: entry?.data ?? null, loading: entry?.loading ?? false };
}

/** Call after a successful apply/approve so every mounted view refetches. */
export function invalidateLeaveBalance(empCode: string) {
  useLeaveBalanceStore.getState().invalidate(empCode);
}
