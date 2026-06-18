// Single source of truth for app credits / about text.
// Reused by Credits (14.4), About (14.5). Bump `version` here; keep it in sync with
// backend app/core/version.py (which system-stats reads).

export const APP_META = {
  name: "Udyogi HRMS",
  version: "1.0.0",
  releaseDate: "2026-06",
  developer: "Sanndip Roy",
  publisher: "Udyogi Group",
  copyrightHolder: "Udyogi Group",
  description:
    "Multi-entity HR & Payroll platform for the Udyogi Group — employee records, " +
    "attendance, statutory payroll (PF / ESIC / state PT), leave accrual, loans, and " +
    "payslip generation across the group's four legal entities and all GSTN locations.",
} as const;
