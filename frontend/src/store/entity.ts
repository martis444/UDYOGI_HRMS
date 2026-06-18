import { create } from "zustand";

export type EntityId = "ALL" | "UPPL" | "USAPL" | "UAPL" | "UMPL";

export interface EntityInfo {
  id: EntityId;
  label: string;
  prefix: string;
  color: string;
}

export const ENTITIES: EntityInfo[] = [
  { id: "ALL",   label: "All",   prefix: "ALL", color: "#1A1A1A" },
  { id: "UPPL",  label: "UPPL",  prefix: "UP",  color: "#E5202E" },
  { id: "USAPL", label: "USAPL", prefix: "US",  color: "#0D9488" },
  { id: "UAPL",  label: "UAPL",  prefix: "UA",  color: "#16A34A" },
  { id: "UMPL",  label: "UMPL",  prefix: "UM",  color: "#2563EB" },
];

interface EntityStore {
  selected: EntityId;
  setSelected: (id: EntityId) => void;
}

export const useEntityStore = create<EntityStore>((set) => ({
  selected: "ALL",
  setSelected: (id) => set({ selected: id }),
}));
