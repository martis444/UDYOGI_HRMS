"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export type UserRole = "super_admin" | "entity_admin" | "employee";

export interface AuthUser {
  emp_code: string;
  name: string;
  role: UserRole;
  entity_id: string;
  is_first_login: boolean;
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("access_token");
}

export function isAuthenticated(): boolean {
  return !!getAccessToken() && !!getStoredUser();
}

export function hasRole(user: AuthUser | null, ...roles: UserRole[]): boolean {
  if (!user) return false;
  return roles.includes(user.role);
}

export function isAdminRole(user: AuthUser | null): boolean {
  return hasRole(user, "super_admin", "entity_admin");
}

// Plain employees are restricted to Dashboard, their own payslips, and leave apply.
// Everyone else (entity_admin, super_admin) gets full access.
export function isEmployee(user: AuthUser | null): boolean {
  return user?.role === "employee";
}

// Routes a plain employee is allowed to open. Anything else redirects to /dashboard.
export const EMPLOYEE_ALLOWED_PREFIXES = [
  "/dashboard/payslips",
  "/dashboard/leave/apply",
  "/dashboard/credits",
  "/dashboard/about",
];

export function isEmployeeAllowedPath(pathname: string): boolean {
  if (pathname === "/dashboard") return true;
  return EMPLOYEE_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const stored = getStoredUser();
    const token = getAccessToken();

    if (!token || !stored) {
      // Clear the proxy cookie so it doesn't bounce back to /dashboard
      document.cookie = "auth_session=; path=/; max-age=0";
      setLoading(false);
      router.replace("/login");
      return;
    }

    if (stored.is_first_login) {
      setLoading(false);
      router.replace("/change-password");
      return;
    }

    setUser(stored);
    setLoading(false);
  }, [router]);

  function logout() {
    localStorage.clear();
    document.cookie = "auth_session=; path=/; max-age=0";
    router.replace("/login");
  }

  return { user, loading, logout };
}

export function useRequireRole(...roles: UserRole[]) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user && !hasRole(user, ...roles)) {
      router.replace("/dashboard");
    }
  }, [user, loading, router, roles]);

  return { user, loading };
}
