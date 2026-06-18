"use client";

import { Fragment } from "react";
import Link from "next/link";
import GlassCard from "@/components/ui/GlassCard";
import Logo from "@/components/Logo";
import { useAuth } from "@/lib/auth";
import { APP_META } from "@/lib/appMeta";
import {
  Users, Clock, Calculator, CalendarCheck, HandCoins, MapPin, FileText, ArrowRight, Info,
} from "lucide-react";

const FEATURES = [
  { icon: Users,         label: "Employees & multi-entity" },
  { icon: Clock,         label: "Attendance & biometric" },
  { icon: Calculator,    label: "Payroll & statutory engine" },
  { icon: CalendarCheck, label: "Leave accrual & requests" },
  { icon: HandCoins,     label: "Loans & advances" },
  { icon: MapPin,        label: "Locations / GSTN" },
  { icon: FileText,      label: "Payslip PDF" },
];

// Component | License | What it does — the real stack from requirements.txt / package.json.
const TECH: { group: string; items: [string, string, string][] }[] = [
  {
    group: "Backend",
    items: [
      ["Python 3.12",        "PSF",          "Server language / runtime"],
      ["FastAPI 0.115",      "MIT",          "REST API framework"],
      ["Uvicorn 0.30",       "BSD-3-Clause", "ASGI web server"],
      ["SQLAlchemy 2.0",     "MIT",          "ORM / database toolkit"],
      ["Alembic 1.13",       "MIT",          "Database migrations"],
      ["Pydantic 2",         "MIT",          "Request/response validation & settings"],
      ["psycopg2 2.9",       "LGPL-3.0",     "PostgreSQL driver"],
      ["python-jose 3.3",    "MIT",          "JWT access/refresh tokens"],
      ["argon2-cffi 23.1",   "MIT",          "Password hashing (Argon2)"],
      ["pandas 2.2",         "BSD-3-Clause", "Bulk import parsing (CSV/XLSX)"],
      ["openpyxl 3.1",       "MIT",          "Excel (.xlsx) reading"],
      ["python-multipart",   "Apache-2.0",   "File/form upload handling"],
      ["WeasyPrint 69",      "BSD-3-Clause", "Payslip PDF generation"],
      ["Jinja2 3.1",         "BSD-3-Clause", "Payslip HTML templating"],
      ["python-dotenv 1.0",  "BSD-3-Clause", "Environment config (.env)"],
    ],
  },
  {
    group: "Frontend",
    items: [
      ["Next.js 16",         "MIT",          "React app framework (App Router)"],
      ["React 19",           "MIT",          "UI library"],
      ["TypeScript 5",       "Apache-2.0",   "Typed JavaScript"],
      ["Tailwind CSS 4",     "MIT",          "Styling / design system"],
      ["Zustand 5",          "MIT",          "Client state (entity context)"],
      ["Axios 1.x",          "MIT",          "HTTP client + token interceptor"],
      ["jwt-decode 4",       "MIT",          "Decode JWT on the client"],
      ["Recharts 3",         "MIT",          "Dashboard charts"],
      ["lucide-react",       "ISC",          "Icon set"],
      ["ESLint 9",           "MIT",          "Linting"],
    ],
  },
  {
    group: "Infrastructure",
    items: [
      ["PostgreSQL 16",      "PostgreSQL License", "Primary database"],
      ["pgcrypto",           "PostgreSQL License", "Column encryption (Aadhaar, bank a/c)"],
      ["Docker",             "Apache-2.0",   "Containerisation"],
      ["Caddy",              "Apache-2.0",   "Reverse proxy / web server"],
    ],
  },
];

export default function AboutPage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <div className="rise-in">
        <h1 className="text-white font-semibold text-xl flex items-center gap-2"><Info size={20} /> About</h1>
        <p className="text-white/50 text-sm mt-0.5">{APP_META.name}</p>
      </div>

      {/* Identity */}
      <GlassCard className="p-6 rise-in delay-1">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="bg-white/95 rounded-xl px-3 py-2"><Logo variant="full" theme="light" /></div>
          <div>
            <h2 className="text-[#1A1A1A] font-bold text-lg leading-tight">{APP_META.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#E5202E]/10 text-[#E5202E]">v{APP_META.version}</span>
              <span className="text-[#6B6B6B] text-xs">Released {APP_META.releaseDate}</span>
            </div>
          </div>
        </div>
        <p className="text-[#1A1A1A] text-sm leading-relaxed mt-5">{APP_META.description}</p>
        <p className="text-[#6B6B6B] text-xs mt-4">
          Developed by <span className="font-semibold text-[#1A1A1A]">{APP_META.developer}</span>
        </p>
      </GlassCard>

      {/* What it does */}
      <GlassCard className="rise-in delay-2">
        <div className="px-5 py-3.5 border-b border-[#E2E2DF] bg-[#F4F4F2]/60">
          <h2 className="text-[#1A1A1A] font-semibold text-sm">What it does</h2>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FEATURES.map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#E5202E]/10 flex items-center justify-center shrink-0">
                <Icon size={15} className="text-[#E5202E]" />
              </div>
              <span className="text-[#1A1A1A] text-sm">{label}</span>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Technology stack & licenses */}
      <GlassCard className="rise-in delay-3">
        <div className="px-5 py-3.5 border-b border-[#E2E2DF] bg-[#F4F4F2]/60">
          <h2 className="text-[#1A1A1A] font-semibold text-sm">Technology stack &amp; licenses</h2>
        </div>
        <div className="p-5 overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[560px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-[#6B6B6B] text-left">
                <th className="py-2 px-2 font-semibold border-b border-[#E2E2DF]">Component</th>
                <th className="py-2 px-2 font-semibold border-b border-[#E2E2DF]">License</th>
                <th className="py-2 px-2 font-semibold border-b border-[#E2E2DF]">What it does</th>
              </tr>
            </thead>
            <tbody>
              {TECH.map((sec) => (
                <Fragment key={sec.group}>
                  <tr>
                    <td colSpan={3} className="pt-4 pb-1.5 px-2 text-[11px] font-bold uppercase tracking-wide text-[#E5202E]">{sec.group}</td>
                  </tr>
                  {sec.items.map(([name, license, role]) => (
                    <tr key={name} className="hover:bg-black/[0.02]">
                      <td className="py-2 px-2 border-b border-[#F0F0EE] font-medium text-[#1A1A1A] whitespace-nowrap">{name}</td>
                      <td className="py-2 px-2 border-b border-[#F0F0EE]">
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#F4F4F2] text-[#5A5A5A] whitespace-nowrap">{license}</span>
                      </td>
                      <td className="py-2 px-2 border-b border-[#F0F0EE] text-[#5A5A5A]">{role}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-[#6B6B6B] mt-3">All components are open-source, used under their respective licenses. Trademarks belong to their owners.</p>
        </div>
      </GlassCard>

      {/* Blurb */}
      <GlassCard className="p-6 rise-in delay-4 space-y-3">
        <h2 className="text-[#1A1A1A] font-semibold text-sm">About</h2>
        <p className="text-[#1A1A1A] text-sm leading-relaxed">
          {APP_META.name} runs HR and payroll for the Udyogi Group&apos;s four legal entities
          (UPPL, USAPL, UAPL, UMPL) from a single system. It manages employee records, attendance,
          leave, and loans, and computes statutory payroll — Provident Fund, ESIC, and state
          Professional Tax — per employee, per location, per month.
        </p>
        <p className="text-[#1A1A1A] text-sm leading-relaxed">
          Payroll runs on a calendar-month cycle (paid on the 26th), with effective-dated salary
          structures so historical payslips stay accurate, and locked months that freeze finalized payroll.
        </p>
        <div className="flex items-center gap-4 pt-2 text-sm">
          <span className="text-[#6B6B6B]">Version {APP_META.version} · {APP_META.releaseDate}</span>
          <Link href="/dashboard/credits" className="inline-flex items-center gap-1.5 font-semibold text-[#E5202E] hover:underline ml-auto">
            Credits <ArrowRight size={14} />
          </Link>
        </div>
      </GlassCard>
    </div>
  );
}
