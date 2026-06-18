"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import GlassCard from "@/components/ui/GlassCard";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { useAuth, isAdminRole } from "@/lib/auth";
import { entityColor } from "@/lib/entities";
import { ENTITIES } from "@/store/entity";
import {
  apiGetLocations, apiCreateLocation, apiUpdateLocation, apiDeleteLocation,
  apiGetStatutory, type LocationRow,
} from "@/lib/api";
import {
  MapPin, Plus, Search, Pencil, Trash2, X, Loader2, AlertCircle, CheckCircle2,
} from "lucide-react";

const REAL_ENTITIES = ENTITIES.filter((e) => e.id !== "ALL");
const INPUT = "w-full bg-white border border-[#E2E2DF] rounded-xl px-3 py-2.5 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#E5202E] focus:ring-1 focus:ring-[#E5202E]/30 placeholder:text-[#6B6B6B]";
const SELECT = `${INPUT} appearance-none cursor-pointer`;

function slug(name: string): string {
  return (name || "").toUpperCase().replace(/[()]/g, " ").replace(/[^A-Z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function errMsg(e: unknown, fallback: string): string {
  const m = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
  return typeof m === "string" ? m : fallback;
}

function StatusPill({ status }: { status: string }) {
  const active = status === "active";
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
      style={active ? { background: "rgba(22,163,74,0.10)", color: "#16A34A" } : { background: "#F4F4F2", color: "#6B6B6B" }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: active ? "#16A34A" : "#9A9A9A" }} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export default function LocationsPage() {
  const { user } = useAuth();
  const isAdmin = isAdminRole(user);

  const [rows, setRows] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [ptCodes, setPtCodes] = useState<string[]>(["NIL"]);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const [modal, setModal] = useState<null | { mode: "add" | "edit"; loc?: LocationRow }>(null);
  const [delTarget, setDelTarget] = useState<LocationRow | null>(null);

  const showToast = useCallback((kind: "ok" | "err", msg: string) => {
    setToast({ kind, msg }); setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    apiGetLocations().then((d) => setRows(d.locations)).catch(() => setRows([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiGetStatutory().then((d) => {
      const codes = Object.keys(d || {});
      if (!codes.includes("NIL")) codes.push("NIL");
      setPtCodes(codes.sort());
    }).catch(() => setPtCodes(["GJ", "MH", "NIL", "WB"]));
  }, []);

  const states = useMemo(() => Array.from(new Set(rows.map((r) => r.state).filter(Boolean))).sort(), [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (stateFilter !== "ALL" && r.state !== stateFilter) return false;
    if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!r.name.toLowerCase().includes(q) && !r.id.toLowerCase().includes(q) && !(r.gstn ?? "").toLowerCase().includes(q)) return false;
    }
    return true;
  }), [rows, search, stateFilter, statusFilter]);

  if (!user) return null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-white font-semibold text-xl flex items-center gap-2"><MapPin size={20} /> Locations (GSTN)</h1>
          <p className="text-white/50 text-sm mt-0.5">{rows.length} units · manage GSTN registrations and PT state</p>
        </div>
        {isAdmin && (
          <button onClick={() => setModal({ mode: "add" })}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition font-semibold press">
            <Plus size={15} /> Add Location
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6B6B6B]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name / code / GSTN…"
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-black/10 bg-white/80 text-[#1A1A1A] text-sm focus:outline-none focus:ring-2 focus:ring-[#E5202E]/30 placeholder:text-[#6B6B6B]" />
        </div>
        <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className={`${SELECT} max-w-[180px] py-2`}>
          <option value="ALL">All states</option>
          {states.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${SELECT} max-w-[150px] py-2`}>
          <option value="ALL">All status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <span className="text-white/40 text-xs ml-auto">{filtered.length} shown</span>
      </div>

      {/* Table */}
      <GlassCard className="overflow-hidden">
        {loading ? (
          <div className="p-5"><SkeletonRows rows={6} cols={6} /></div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-[#6B6B6B] text-sm">No locations match.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/[0.07] text-[#6B6B6B] text-[11px] uppercase tracking-wide">
                  {["Name", "Code", "GSTN", "State", "PT", "Entity", "Phone", "Status", ""].map((h, i) => (
                    <th key={i} className={`px-3 py-3 ${i === 8 ? "text-right pr-5" : "text-left"} ${i === 0 ? "pl-5" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05]">
                {filtered.map((l) => (
                  <tr key={l.id} className="hover:bg-black/[0.025] transition-colors">
                    <td className="px-3 py-3 pl-5 text-[#1A1A1A] font-medium">{l.name}</td>
                    <td className="px-3 py-3 font-mono text-xs text-[#6B6B6B]">{l.id}</td>
                    <td className="px-3 py-3 font-mono text-xs text-[#1A1A1A]">{l.gstn || "—"}</td>
                    <td className="px-3 py-3 text-[#1A1A1A]">{l.state || "—"}</td>
                    <td className="px-3 py-3">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#F4F4F2] text-[#1A1A1A]">{l.pt_state_code}</span>
                    </td>
                    <td className="px-3 py-3">
                      {l.entity_id ? (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${entityColor(l.entity_id)}18`, color: entityColor(l.entity_id) }}>{l.entity_id}</span>
                      ) : <span className="text-[#6B6B6B] text-xs">—</span>}
                    </td>
                    <td className="px-3 py-3 text-[#6B6B6B] text-xs">{l.phone || "—"}</td>
                    <td className="px-3 py-3"><StatusPill status={l.status} /></td>
                    <td className="px-3 py-3 pr-5">
                      {isAdmin && (
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={() => setModal({ mode: "edit", loc: l })} aria-label="Edit"
                            className="p-1.5 rounded-lg text-[#6B6B6B] hover:bg-black/[0.06] hover:text-[#1A1A1A] transition"><Pencil size={14} /></button>
                          <button onClick={() => setDelTarget(l)} aria-label="Delete"
                            className="p-1.5 rounded-lg text-[#6B6B6B] hover:bg-[#DC2626]/10 hover:text-[#DC2626] transition"><Trash2 size={14} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {modal && (
        <LocationModal mode={modal.mode} loc={modal.loc} ptCodes={ptCodes}
          onClose={() => setModal(null)}
          onSaved={(m) => { setModal(null); showToast("ok", m); load(); }}
          onError={(m) => showToast("err", m)} />
      )}

      {delTarget && (
        <DeleteModal loc={delTarget} onClose={() => setDelTarget(null)}
          onDone={(m) => { setDelTarget(null); showToast("ok", m); load(); }}
          onError={(m) => showToast("err", m)} />
      )}

      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 flex items-start gap-2 px-4 py-3 rounded-xl shadow-2xl text-sm max-w-sm text-white ${toast.kind === "ok" ? "bg-[#16A34A]" : "bg-[#DC2626]"}`}>
          {toast.kind === "ok" ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" /> : <AlertCircle size={16} className="shrink-0 mt-0.5" />}
          <span>{toast.msg}</span>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[#5A5A5A] mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function LocationModal({ mode, loc, ptCodes, onClose, onSaved, onError }: {
  mode: "add" | "edit"; loc?: LocationRow; ptCodes: string[];
  onClose: () => void; onSaved: (m: string) => void; onError: (m: string) => void;
}) {
  const [name, setName] = useState(loc?.name ?? "");
  const [gstn, setGstn] = useState(loc?.gstn ?? "");
  const [city, setCity] = useState(loc?.city ?? "");
  const [state, setState] = useState(loc?.state ?? "");
  const [pt, setPt] = useState(loc?.pt_state_code ?? "NIL");
  const [entity, setEntity] = useState(loc?.entity_id ?? "");
  const [phone, setPhone] = useState(loc?.phone ?? "");
  const [status, setStatus] = useState<string>(loc?.status ?? "active");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const previewId = mode === "add" ? slug(name) : loc!.id;

  const submit = async () => {
    setError("");
    if (mode === "add" && !slug(name)) { setError("Name must contain letters or digits."); return; }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name, gstn, city, state, pt_state_code: pt, entity_id: entity || null, phone };
      if (mode === "edit") body.status = status;
      if (mode === "add") { await apiCreateLocation(body); onSaved("Location created"); }
      else { await apiUpdateLocation(loc!.id, body); onSaved("Location updated"); }
    } catch (e: unknown) {
      const m = errMsg(e, "Save failed"); setError(m); onError(m);
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-[#E2E2DF] max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-[#E2E2DF] flex items-center justify-between sticky top-0 bg-white rounded-t-2xl">
          <h3 className="text-[#1A1A1A] font-semibold text-base flex items-center gap-2"><MapPin size={16} className="text-[#E5202E]" /> {mode === "add" ? "Add location" : `Edit ${loc!.id}`}</h3>
          <button onClick={onClose} className="text-[#6B6B6B] hover:text-[#1A1A1A] transition"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <Field label="Name *">
            <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} placeholder="e.g. RANIHATI-HARNESS" disabled={mode === "edit"} />
            <p className="text-[11px] text-[#6B6B6B] mt-1">Code (id): <span className="font-mono text-[#1A1A1A]">{previewId || "—"}</span>{mode === "edit" && " (immutable)"}</p>
          </Field>
          <Field label="GSTN"><input value={gstn} onChange={(e) => setGstn(e.target.value)} className={`${INPUT} font-mono`} placeholder="19AAACU3814F1ZH" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="City"><input value={city} onChange={(e) => setCity(e.target.value)} className={INPUT} /></Field>
            <Field label="State"><input value={state} onChange={(e) => setState(e.target.value)} className={INPUT} /></Field>
            <Field label="PT state">
              <select value={pt} onChange={(e) => setPt(e.target.value)} className={SELECT}>
                {ptCodes.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Entity">
              <select value={entity} onChange={(e) => setEntity(e.target.value)} className={SELECT}>
                <option value="">None (group-wide)</option>
                {REAL_ENTITIES.map((e) => <option key={e.id} value={e.id}>{e.id}</option>)}
              </select>
            </Field>
            <Field label="Phone"><input value={phone} onChange={(e) => setPhone(e.target.value)} className={INPUT} /></Field>
            {mode === "edit" && (
              <Field label="Status">
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={SELECT}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
            )}
          </div>
          {error && <div className="flex items-start gap-2 p-3 rounded-xl bg-[#DC2626]/8 border border-[#DC2626]/20 text-[#DC2626] text-sm"><AlertCircle size={15} className="shrink-0 mt-0.5" /> {error}</div>}
        </div>
        <div className="px-5 py-4 border-t border-[#E2E2DF] flex items-center justify-end gap-2 sticky bottom-0 bg-white rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2.5 text-sm bg-white border border-[#E2E2DF] text-[#5A5A5A] hover:bg-[#F4F4F2] rounded-xl transition font-medium">Cancel</button>
          <button onClick={submit} disabled={saving} className="flex items-center gap-2 px-6 py-2.5 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition font-semibold disabled:opacity-60">
            {saving ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : (mode === "add" ? "Create" : "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteModal({ loc, onClose, onDone, onError }: {
  loc: LocationRow; onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState("");
  const [refError, setRefError] = useState("");

  const deactivate = async () => {
    setBusy("deact");
    try { await apiUpdateLocation(loc.id, { status: "inactive" }); onDone("Location deactivated"); }
    catch (e: unknown) { onError(errMsg(e, "Deactivate failed")); }
    finally { setBusy(""); }
  };
  const hardDelete = async () => {
    setBusy("del"); setRefError("");
    try { await apiDeleteLocation(loc.id, true); onDone("Location deleted"); }
    catch (e: unknown) {
      const m = errMsg(e, "Delete failed");
      // 409 → referenced
      setRefError(m); onError(m);
    } finally { setBusy(""); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-[#E2E2DF] p-5">
        <h3 className="text-[#1A1A1A] font-semibold text-base mb-1">Remove {loc.name}?</h3>
        <p className="text-[#5A5A5A] text-sm mb-4">Permanent delete only works if nothing references this location. Otherwise deactivate it (hidden from new-employee dropdowns, existing records keep working).</p>
        {refError && <div className="flex items-start gap-2 p-3 mb-3 rounded-xl bg-[#DC2626]/8 border border-[#DC2626]/20 text-[#DC2626] text-sm"><AlertCircle size={15} className="shrink-0 mt-0.5" /> {refError} — reassign them first, or deactivate instead.</div>}
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2.5 text-sm bg-white border border-[#E2E2DF] text-[#5A5A5A] hover:bg-[#F4F4F2] rounded-xl transition font-medium">Cancel</button>
          <button onClick={deactivate} disabled={!!busy} className="flex items-center gap-2 px-4 py-2.5 text-sm bg-[#1A1A1A] text-white hover:bg-black rounded-xl transition font-semibold disabled:opacity-60">
            {busy === "deact" ? <Loader2 size={13} className="animate-spin" /> : null} Deactivate
          </button>
          <button onClick={hardDelete} disabled={!!busy} className="flex items-center gap-2 px-4 py-2.5 text-sm bg-[#E5202E] text-white hover:bg-[#C81824] rounded-xl transition font-semibold disabled:opacity-60">
            {busy === "del" ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Delete
          </button>
        </div>
      </div>
    </div>
  );
}
