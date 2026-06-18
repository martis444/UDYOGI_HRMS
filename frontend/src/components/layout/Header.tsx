"use client";

import { LogOut, Menu } from "lucide-react";
import { ENTITIES, useEntityStore } from "@/store/entity";
import type { AuthUser } from "@/lib/auth";

interface HeaderProps {
  user: AuthUser;
  onLogout: () => void;
  onMenuClick: () => void;
}

const ENTITY_UNDERLINE: Record<string, string> = {
  ALL:   "#E5202E",
  UPPL:  "#E5202E",
  USAPL: "#9CA3AF",
  UAPL:  "#16A34A",
  UMPL:  "#2563EB",
};

export default function Header({ user, onLogout, onMenuClick }: HeaderProps) {
  const { selected, setSelected } = useEntityStore();

  const visibleEntities =
    user.role === "super_admin"
      ? ENTITIES
      : ENTITIES.filter(
          (e) => e.id === "ALL" || e.id === user.entity_id
        );

  return (
    <header
      className="flex items-center h-14 px-4 border-b border-white/10 gap-4 shrink-0"
      style={{
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(48px) saturate(200%)",
        WebkitBackdropFilter: "blur(48px) saturate(200%)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.10), 0 1px 0 rgba(0,0,0,0.2)",
      }}
    >
      {/* Mobile hamburger */}
      <button
        onClick={onMenuClick}
        className="lg:hidden text-white/60 hover:text-white transition"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {/* Entity tabs */}
      <nav className="flex items-end gap-1 flex-1 overflow-x-auto h-full no-scrollbar">
        {visibleEntities.map((entity) => {
          const active = selected === entity.id;
          const underlineColor = ENTITY_UNDERLINE[entity.id];
          return (
            <button
              key={entity.id}
              onClick={() => setSelected(entity.id)}
              className={`press relative px-3 h-full text-sm font-medium transition whitespace-nowrap shrink-0 min-h-[44px] ${
                active ? "text-white" : "text-white/50 hover:text-white/80"
              }`}
            >
              {entity.id === "ALL" ? "All entities" : entity.label}
              <span
                className={`absolute bottom-0 left-0 right-0 h-0.5 rounded-t transition-all duration-200 origin-left ${
                  active ? "opacity-100 scale-x-100" : "opacity-0 scale-x-0"
                }`}
                style={{ backgroundColor: underlineColor }}
              />
            </button>
          );
        })}
      </nav>

      {/* User info + logout */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="hidden sm:block text-right">
          <p className="text-white text-xs font-semibold leading-tight">{user.name}</p>
          <p className="text-white/40 text-[10px]">{user.emp_code}</p>
        </div>
        <button
          onClick={onLogout}
          className="press text-white/50 hover:text-white transition p-1.5 rounded-lg hover:bg-white/10"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}
