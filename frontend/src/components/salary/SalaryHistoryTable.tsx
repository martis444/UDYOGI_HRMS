"use client";

import type { SalaryStructureRow } from "@/lib/api";
import { SkeletonRows } from "@/components/ui/Skeleton";

const COLS = ["Effective From", "Effective To", "Basic", "HRA", "DA", "SPL", "CCA", "LTA", "Gross", "Reason", "Status"];
const LEFT = new Set(["Effective From", "Effective To", "Reason", "Status"]);

const money = (v: number) => `₹${Number(v).toLocaleString("en-IN")}`;

/** Read-only effective-dated salary history. Shared by the Payroll console and
 *  the employee detail page so the two never drift. */
export default function SalaryHistoryTable({
  structures,
  loading,
}: { structures: SalaryStructureRow[]; loading: boolean }) {
  if (loading) return <SkeletonRows rows={4} cols={6} />;
  if (structures.length === 0) {
    return <p className="text-sm text-[#5A5A5A]">No salary structures on record.</p>;
  }

  return (
    <div className="overflow-x-auto -mx-5 px-5">
      <table className="w-full text-xs border-collapse min-w-[760px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-[#6B6B6B]">
            {COLS.map((h) => (
              <th key={h} className={`py-2 px-2 font-semibold border-b border-[#E2E2DF] ${LEFT.has(h) ? "text-left" : "text-right"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {structures.map((s) => {
            const active = s.status === "active";
            return (
              <tr key={s.id} className={active ? "bg-[#16A34A]/[0.05]" : ""}>
                <td className={`py-2 px-2 border-b border-[#F0F0EE] ${active ? "text-[#1A1A1A] font-semibold" : "text-[#5A5A5A]"}`}>{s.effective_from}</td>
                <td className={`py-2 px-2 border-b border-[#F0F0EE] ${active ? "text-[#1A1A1A]" : "text-[#5A5A5A]"}`}>{s.effective_to ?? "—"}</td>
                {([s.basic, s.hra, s.da, s.spl, s.cca, s.leave_travel] as number[]).map((v, i) => (
                  <td key={i} className={`py-2 px-2 border-b border-[#F0F0EE] text-right ${active ? "text-[#1A1A1A]" : "text-[#5A5A5A]"}`}>{money(v)}</td>
                ))}
                <td className={`py-2 px-2 border-b border-[#F0F0EE] text-right font-bold ${active ? "text-[#1A1A1A]" : "text-[#5A5A5A]"}`}>{money(s.gross)}</td>
                <td className="py-2 px-2 border-b border-[#F0F0EE] text-[#5A5A5A] capitalize">{s.reason}</td>
                <td className="py-2 px-2 border-b border-[#F0F0EE]">
                  {active ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#16A34A]/10 text-[#16A34A]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" /> active
                    </span>
                  ) : (
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#F4F4F2] text-[#6B6B6B]">historical</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
