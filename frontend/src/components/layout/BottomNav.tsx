"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Clock, BookOpen, CheckSquare, FileText, CalendarPlus } from "lucide-react";
import { useAuth, isAdminRole, isEmployee } from "@/lib/auth";

export default function BottomNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const isAdmin = user ? isAdminRole(user) : false;
  const employee = isEmployee(user);

  const TABS = employee
    ? [
        { label: "Home",     href: "/dashboard",             icon: LayoutDashboard },
        { label: "Payslips", href: "/dashboard/payslips",    icon: FileText },
        { label: "Leave",    href: "/dashboard/leave/apply", icon: CalendarPlus },
      ]
    : [
        { label: "Home",       href: "/dashboard",                                       icon: LayoutDashboard },
        { label: "Attendance", href: "/dashboard/attendance",                             icon: Clock },
        { label: "Leave",      href: isAdmin ? "/dashboard/leave" : "/dashboard/leave/apply", icon: BookOpen },
        { label: "Approve",    href: "/dashboard/approvals",                              icon: CheckSquare },
      ];

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === href;
    return pathname.startsWith(href);
  }

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 border-t border-white/10 z-40"
      style={{
        background: "rgba(255,255,255,0.06)",
        backdropFilter: "blur(48px) saturate(180%)",
        WebkitBackdropFilter: "blur(48px) saturate(180%)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10)",
      }}
    >
      <div className="flex items-center justify-around h-16 px-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.label}
              href={tab.href}
              className={`press flex flex-col items-center gap-0.5 flex-1 min-h-[44px] justify-center transition-colors ${
                active ? "text-[#E5202E]" : "text-white/50 hover:text-white/80"
              }`}
            >
              <Icon size={20} />
              <span className="text-[10px] font-medium">{tab.label}</span>
              <span
                className={`w-1 h-1 rounded-full bg-[#E5202E] mt-0.5 transition-opacity duration-200 ${
                  active ? "opacity-100" : "opacity-0"
                }`}
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
