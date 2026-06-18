"use client";

import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth, isAdminRole, isEmployee, isEmployeeAllowedPath } from "@/lib/auth";
import { apiPendingLeaveCount } from "@/lib/api";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import BottomNav from "@/components/layout/BottomNav";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router   = useRouter();
  const [drawerOpen, setDrawerOpen]       = useState(false);
  const [pendingLeaves, setPendingLeaves] = useState(0);

  // Lock plain employees to their allowed pages — redirect any other route.
  useEffect(() => {
    if (user && isEmployee(user) && !isEmployeeAllowedPath(pathname)) {
      router.replace("/dashboard");
    }
  }, [user, pathname, router]);

  useEffect(() => {
    if (!user) return;
    const canApprove = isAdminRole(user);
    if (!canApprove) return;
    apiPendingLeaveCount().then((d) => setPendingLeaves(d.count)).catch(() => {});
    const t = setInterval(() => {
      apiPendingLeaveCount().then((d) => setPendingLeaves(d.count)).catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, [user]);

  // Close drawer on resize to lg
  useEffect(() => {
    function onResize() {
      if (window.innerWidth >= 1024) setDrawerOpen(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#1A1A1A] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-[#E5202E] border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div
      className="h-screen flex overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at 12% 8%, rgba(229,32,46,0.14) 0%, transparent 48%), radial-gradient(ellipse at 88% 92%, rgba(37,99,235,0.09) 0%, transparent 48%), linear-gradient(160deg, #111318 0%, #0d1016 55%, #131519 100%)",
      }}
    >
      {/* Desktop sidebar */}
      <div className="hidden lg:flex h-full">
        <Sidebar user={user} pendingLeaves={pendingLeaves} />
      </div>

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative z-10 h-full">
            <Sidebar user={user} pendingLeaves={pendingLeaves} onClose={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header
          user={user}
          onLogout={logout}
          onMenuClick={() => setDrawerOpen(true)}
        />

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">
          {children}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
