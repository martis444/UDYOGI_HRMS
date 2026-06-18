"use client";

import { useEffect, useState } from "react";
import GlassCard from "@/components/ui/GlassCard";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useAuth, isAdminRole } from "@/lib/auth";
import { apiGetSystemStats, type SystemStats } from "@/lib/api";
import { APP_META } from "@/lib/appMeta";
import { Award, Code2, Building2, Copyright, BarChart3 } from "lucide-react";

function InfoCard({ icon: Icon, label, value, delay }: { icon: React.ElementType; label: string; value: string; delay: string }) {
  return (
    <GlassCard className={`p-5 rise-in ${delay}`}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#E5202E]/10 flex items-center justify-center shrink-0">
          <Icon size={17} className="text-[#E5202E]" />
        </div>
        <div>
          <p className="text-[#6B6B6B] text-[11px] uppercase tracking-wide font-semibold">{label}</p>
          <p className="text-[#1A1A1A] font-semibold text-base mt-0.5">{value}</p>
        </div>
      </div>
    </GlassCard>
  );
}

export default function CreditsPage() {
  const { user } = useAuth();
  const isAdmin = isAdminRole(user);
  const year = new Date().getFullYear();

  const [stats, setStats] = useState<SystemStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) { setStatsLoading(false); return; }
    apiGetSystemStats().then(setStats).catch(() => setStats(null)).finally(() => setStatsLoading(false));
  }, [isAdmin]);

  if (!user) return null;

  const statItems = stats ? [
    { label: "Employees", value: String(stats.employees_total) },
    { label: "Active", value: String(stats.employees_active) },
    { label: "Entities", value: String(stats.entities) },
    { label: "Locations", value: String(stats.locations_active) },
    { label: "Payroll processed", value: String(stats.payroll_months_processed) },
    { label: "Payroll locked", value: String(stats.payroll_months_locked) },
    { label: "Active loans", value: String(stats.loans_active) },
    { label: "Database tables", value: String(stats.db_table_count) },
    { label: "Version", value: stats.app_version },
    { label: "Server time", value: new Date(stats.server_time).toLocaleString("en-IN") },
  ] : [];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6">
      <div className="rise-in">
        <h1 className="text-white font-semibold text-xl flex items-center gap-2"><Award size={20} /> Credits</h1>
        <p className="text-white/50 text-sm mt-0.5">{APP_META.name} · v{APP_META.version}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <InfoCard icon={Code2} label="Designed & Developed by" value={APP_META.developer} delay="delay-1" />
        <InfoCard icon={Building2} label="Published by" value={APP_META.publisher} delay="delay-2" />
        <div className="sm:col-span-2">
          <InfoCard icon={Copyright} label="Copyright" value={`© ${year} ${APP_META.copyrightHolder}. All rights reserved.`} delay="delay-3" />
        </div>
      </div>

      {/* System statistics — admin only */}
      <GlassCard className="rise-in delay-4">
        <div className="px-5 py-3.5 border-b border-[#E2E2DF] bg-[#F4F4F2]/60">
          <h2 className="text-[#1A1A1A] font-semibold text-sm flex items-center gap-2">
            <BarChart3 size={15} className="text-[#5A5A5A]" /> System statistics
          </h2>
        </div>
        <div className="p-5">
          {!isAdmin ? (
            <p className="text-sm text-[#6B6B6B]">Statistics available to administrators.</p>
          ) : statsLoading ? (
            <SkeletonRows rows={3} cols={4} />
          ) : !stats ? (
            <p className="text-sm text-[#6B6B6B]">Statistics unavailable right now.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {statItems.map((s) => (
                <div key={s.label}>
                  <p className="text-[#6B6B6B] text-[11px] uppercase tracking-wide font-semibold">{s.label}</p>
                  <p className="text-[#1A1A1A] font-bold text-lg leading-tight mt-0.5">{s.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </GlassCard>
    </div>
  );
}
