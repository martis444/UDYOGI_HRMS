"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Clock,
  FileText,
  BarChart3,
  Settings,
  ChevronRight,
  BookOpen,
  Shield,
  Fingerprint,
  KeyRound,
  Columns,
  CalendarPlus,
  MapPin,
  HandCoins,
  Award,
  Info,
  X,
} from "lucide-react";
import Logo from "@/components/Logo";
import type { AuthUser } from "@/lib/auth";
import { isAdminRole, isEmployee } from "@/lib/auth";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: number;
  adminOnly?: boolean;
  employee?: boolean; // visible to plain employees
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    group: "Self Service",
    items: [
      { label: "Dashboard",    href: "/dashboard",               icon: LayoutDashboard, employee: true },
      { label: "My payslips",  href: "/dashboard/payslips",      icon: FileText,        employee: true },
      { label: "Apply leave",  href: "/dashboard/leave/apply",   icon: CalendarPlus,    employee: true },
      { label: "Attendance",   href: "/dashboard/attendance",     icon: Clock },
    ],
  },
  {
    group: "Workplace",
    items: [
      { label: "Leave tracker", href: "/dashboard/leave",         icon: BookOpen,    adminOnly: true },
      { label: "Approvals",    href: "/dashboard/approvals",     icon: ChevronRight, badge: 0 },
    ],
  },
  {
    group: "HR Admin",
    items: [
      { label: "Employees",    href: "/dashboard/employees",     icon: Users,         adminOnly: true },
      { label: "Payroll",      href: "/dashboard/payroll",       icon: BarChart3,     adminOnly: true },
      { label: "Locations (GSTN)", href: "/dashboard/locations",            icon: MapPin,      adminOnly: true },
      { label: "Loans",          href: "/dashboard/loans",                    icon: HandCoins,   adminOnly: true },
      { label: "Biometric",      href: "/dashboard/biometric",                icon: Fingerprint, adminOnly: true },
      { label: "Audit log",      href: "/dashboard/admin/audit-log",          icon: Shield,      adminOnly: true },
      { label: "Statutory",      href: "/dashboard/statutory",                icon: Settings,    adminOnly: true },
      { label: "Column update",  href: "/dashboard/admin/column-update",      icon: Columns,     adminOnly: true },
      { label: "Password vault", href: "/dashboard/admin/password-vault",     icon: KeyRound,    adminOnly: true },
    ],
  },
  {
    group: "Info",
    items: [
      { label: "About",   href: "/dashboard/about",   icon: Info,  employee: true },
      { label: "Credits", href: "/dashboard/credits", icon: Award, employee: true },
    ],
  },
];

interface SidebarProps {
  user: AuthUser;
  onClose?: () => void;
  pendingLeaves?: number;
}

export default function Sidebar({ user, onClose, pendingLeaves = 0 }: SidebarProps) {
  const pathname = usePathname();
  const isAdmin = isAdminRole(user);
  const employee = isEmployee(user);

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === href;
    return pathname.startsWith(href);
  }

  return (
    <aside
      className="flex flex-col h-full w-56 border-r border-white/10 relative"
      style={{
        background: "rgba(255,255,255,0.05)",
        backdropFilter: "blur(48px) saturate(180%)",
        WebkitBackdropFilter: "blur(48px) saturate(180%)",
        boxShadow: "inset -1px 0 0 rgba(255,255,255,0.06)",
      }}
    >
      {/* Header */}
      <div className="relative flex items-center justify-center px-4 py-5 border-b border-white/8">
        <Logo variant="full" theme="dark" />
        {onClose && (
          <button
            onClick={onClose}
            className="absolute right-4 text-white/50 hover:text-white transition lg:hidden"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {(() => {
          let riseIdx = 0; // running index for staggered first-mount reveal
          return NAV.map((section) => {
            const visible = section.items.filter((item) =>
              employee ? item.employee : !item.adminOnly || isAdmin
            );
            if (visible.length === 0) return null;

            return (
              <div key={section.group}>
                <p className="text-white/40 text-[10px] uppercase tracking-widest font-semibold px-3 mb-2">
                  {section.group}
                </p>
                <ul className="space-y-0.5">
                  {visible.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.href);
                    const delay = `delay-${(riseIdx++ % 5) + 1}`;
                    return (
                      <li key={item.href} className={`rise-in ${delay}`}>
                        <Link
                          href={item.href}
                          onClick={onClose}
                          className={`relative flex items-center gap-3 py-2 px-3 rounded-lg text-sm transition-colors duration-150 min-h-[44px] ${
                            active
                              ? "bg-white/10 text-white font-semibold"
                              : "text-white/70 hover:bg-white/10 hover:text-white"
                          }`}
                        >
                          {/* Active left bar — slides in via scaleX */}
                          <span
                            aria-hidden
                            className={`absolute left-0 top-1 bottom-1 w-[3px] rounded-r bg-[#E5202E] origin-left transition-transform duration-200 ${
                              active ? "scale-x-100" : "scale-x-0"
                            }`}
                            style={{ transitionTimingFunction: "var(--ease-smooth)" }}
                          />
                          <Icon size={16} className="shrink-0" />
                          <span className="flex-1">{item.label}</span>
                          {typeof item.badge === "number" && item.badge > 0 && (
                            <span className="bg-[#E5202E] text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                              {item.badge}
                            </span>
                          )}
                          {item.href === "/dashboard/approvals" && pendingLeaves > 0 && (
                            <span className="bg-[#E5202E] text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                              {pendingLeaves > 9 ? "9+" : pendingLeaves}
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          });
        })()}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-white/8">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#E5202E]/20 border border-[#E5202E]/30 flex items-center justify-center text-[#E5202E] text-xs font-bold">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-white text-xs font-semibold truncate">{user.name}</p>
            <p className="text-white/40 text-[10px]">{user.emp_code}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
