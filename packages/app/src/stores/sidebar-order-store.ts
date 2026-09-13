import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  moveProjectToCategory,
  normalizeProjectCategories,
  removeProjectCategory,
  renameProjectCategory,
  reorderCategoryProjectViewKeys,
  shiftProjectCategory,
  type SidebarProjectCategory,
} from "./sidebar-project-categories";

export type { SidebarProjectCategory } from "./sidebar-project-categories";

interface SidebarOrderStoreState {
  projectOrder: string[];
  pinnedWorkspaceOrder: string[];
  workspaceOrderByProject: Record<string, string[]>;
  projectCategories: SidebarProjectCategory[];
  getProjectOrder: () => string[];
  setProjectOrder: (keys: string[]) => void;
  getPinnedWorkspaceOrder: () => string[];
  setPinnedWorkspaceOrder: (keys: string[]) => void;
  getWorkspaceOrder: (projectViewKey: string) => string[];
  setWorkspaceOrder: (projectViewKey: string, keys: string[]) => void;
  createProjectCategory: (name: string) => string | null;
  renameProjectCategory: (categoryId: string, name: string) => void;
  shiftProjectCategory: (categoryId: string, direction: -1 | 1) => void;
  setCategoryProjectOrder: (categoryId: string, projectViewKeys: string[]) => void;
  deleteProjectCategory: (categoryId: string) => void;
  moveProjectToCategory: (projectViewKey: string, categoryId: string | null) => void;
}

interface SidebarOrderPersistedState {
  projectOrder?: string[];
  pinnedWorkspaceOrder?: string[];
  workspaceOrderByProject?: Record<string, string[]>;
  projectCategories?: SidebarProjectCategory[];
  projectOrderByServerId?: Record<string, string[]>;
  workspaceOrderByServerAndProject?: Record<string, string[]>;
}

const StringArrayRecordSchema = z.record(z.string(), z.array(z.string()));
const SidebarProjectCategorySchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  projectViewKeys: z.array(z.string()),
});
const SidebarOrderPersistedStateSchema = z.strictObject({
  projectOrder: z.array(z.string()).optional(),
  pinnedWorkspaceOrder: z.array(z.string()).optional(),
  workspaceOrderByProject: StringArrayRecordSchema.optional(),
  // Optional, because a settings blob written before categories existed has no such key and must
  // still restore the orders it does carry.
  projectCategories: z.array(SidebarProjectCategorySchema).optional(),
  projectOrderByServerId: StringArrayRecordSchema.optional(),
  workspaceOrderByServerAndProject: StringArrayRecordSchema.optional(),
});

interface SidebarWorkspaceOrderScope {
  serverId: string;
  projectViewKey: string;
}

// Trims each key. Only for persisted state read at migration time, where a
// stray space is an artifact of an older format rather than part of the key.
function normalizeKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawKey of keys) {
    const key = rawKey.trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(key);
  }

  return normalized;
}

/**
 * Drops blank keys and duplicates but keeps each key exactly as given. View
 * keys embed a project's path, so a directory whose name ends in a space
 * produces a key that ends in a space. Trimming it stores a key that can never
 * match the one the sidebar looks up, so the caller sees its key as missing,
 * writes it again, and the effect that reconciles the order never settles.
 */
function dedupeKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const key of keys) {
    if (!key.trim() || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(key);
  }

  return deduped;
}

function normalizeWorkspaceOrderByProject(
  workspaceOrderByProject: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const normalized: Record<string, string[]> = {};
  for (const [projectViewKey, order] of Object.entries(workspaceOrderByProject ?? {})) {
    const scope = projectViewKey.trim();
    if (!scope) continue;
    normalized[scope] = normalizeKeys(order);
  }
  return normalized;
}

function extractWorkspaceOrderScope(scopeKey: string): SidebarWorkspaceOrderScope | null {
  const separatorIndex = scopeKey.indexOf("::");
  if (separatorIndex < 0) return null;
  const serverId = scopeKey.slice(0, separatorIndex).trim();
  const projectViewKey = scopeKey.slice(separatorIndex + 2).trim();
  if (!serverId || !projectViewKey) return null;
  return { serverId, projectViewKey };
}

function normalizeLegacyWorkspaceKey(serverId: string, rawWorkspaceKey: string): string | null {
  const workspaceKey = rawWorkspaceKey.trim();
  if (!workspaceKey) return null;
  const serverPrefix = `${serverId}:`;
  return workspaceKey.startsWith(serverPrefix) ? workspaceKey : `${serverPrefix}${workspaceKey}`;
}

export function migrateSidebarOrderState(persistedState: unknown): {
  projectOrder: string[];
  pinnedWorkspaceOrder: string[];
  workspaceOrderByProject: Record<string, string[]>;
  projectCategories: SidebarProjectCategory[];
} {
  const result = SidebarOrderPersistedStateSchema.safeParse(persistedState);
  if (!result.success) {
    return {
      projectOrder: [],
      pinnedWorkspaceOrder: [],
      workspaceOrderByProject: {},
      projectCategories: [],
    };
  }
  const state: SidebarOrderPersistedState = result.data;

  const projectOrder = normalizeKeys(state.projectOrder ?? []);
  const seenProjects = new Set(projectOrder);
  for (const keys of Object.values(state.projectOrderByServerId ?? {})) {
    for (const key of normalizeKeys(keys)) {
      if (seenProjects.has(key)) continue;
      seenProjects.add(key);
      projectOrder.push(key);
    }
  }

  const workspaceOrderByProject = normalizeWorkspaceOrderByProject(state.workspaceOrderByProject);
  for (const [scopeKey, order] of Object.entries(state.workspaceOrderByServerAndProject ?? {})) {
    const scope = extractWorkspaceOrderScope(scopeKey);
    if (!scope) continue;
    const existing = workspaceOrderByProject[scope.projectViewKey] ?? [];
    const merged = [...existing];
    const seen = new Set(merged);
    for (const key of order) {
      const workspaceKey = normalizeLegacyWorkspaceKey(scope.serverId, key);
      if (!workspaceKey || seen.has(workspaceKey)) continue;
      seen.add(workspaceKey);
      merged.push(workspaceKey);
    }
    workspaceOrderByProject[scope.projectViewKey] = merged;
  }

  return {
    projectOrder,
    pinnedWorkspaceOrder: normalizeKeys(state.pinnedWorkspaceOrder ?? []),
    workspaceOrderByProject,
    projectCategories: normalizeProjectCategories(state.projectCategories ?? []),
  };
}

function createCategoryId(): string {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `category_${randomId}`;
}

export const useSidebarOrderStore = create<SidebarOrderStoreState>()(
  persist(
    (set, get) => ({
      projectOrder: [],
      pinnedWorkspaceOrder: [],
      workspaceOrderByProject: {},
      projectCategories: [],
      getProjectOrder: () => get().projectOrder,
      setProjectOrder: (keys) => {
        set({ projectOrder: dedupeKeys(keys) });
      },
      getPinnedWorkspaceOrder: () => get().pinnedWorkspaceOrder,
      setPinnedWorkspaceOrder: (keys) => {
        set({ pinnedWorkspaceOrder: dedupeKeys(keys) });
      },
      getWorkspaceOrder: (projectViewKey) => {
        if (!projectViewKey.trim()) return [];
        return get().workspaceOrderByProject[projectViewKey] ?? [];
      },
      setWorkspaceOrder: (projectViewKey, keys) => {
        if (!projectViewKey.trim()) return;
        set((state) => ({
          workspaceOrderByProject: {
            ...state.workspaceOrderByProject,
            [projectViewKey]: dedupeKeys(keys),
          },
        }));
      },
      // Returns the new id so the caller that created a category can move a project into it in
      // the same gesture, which is how "New category" on a project row works.
      createProjectCategory: (name) => {
        const categoryName = name.trim();
        if (!categoryName) return null;
        const category: SidebarProjectCategory = {
          id: createCategoryId(),
          name: categoryName,
          projectViewKeys: [],
        };
        set((state) => ({
          projectCategories: normalizeProjectCategories([...state.projectCategories, category]),
        }));
        return category.id;
      },
      renameProjectCategory: (categoryId, name) => {
        const categoryName = name.trim();
        if (!categoryName || !categoryId.trim()) return;
        set((state) => ({
          projectCategories: normalizeProjectCategories(
            renameProjectCategory(state.projectCategories, categoryId, categoryName),
          ),
        }));
      },
      shiftProjectCategory: (categoryId, direction) => {
        if (!categoryId.trim()) return;
        set((state) => ({
          projectCategories: normalizeProjectCategories(
            shiftProjectCategory(state.projectCategories, categoryId, direction),
          ),
        }));
      },
      setCategoryProjectOrder: (categoryId, projectViewKeys) => {
        if (!categoryId.trim()) return;
        const orderedKeys = normalizeKeys(projectViewKeys);
        set((state) => ({
          projectCategories: normalizeProjectCategories(
            reorderCategoryProjectViewKeys(state.projectCategories, categoryId, orderedKeys),
          ),
        }));
      },
      deleteProjectCategory: (categoryId) => {
        if (!categoryId.trim()) return;
        set((state) => ({
          projectCategories: normalizeProjectCategories(
            removeProjectCategory(state.projectCategories, categoryId),
          ),
        }));
      },
      moveProjectToCategory: (projectViewKey, categoryId) => {
        const scope = projectViewKey.trim();
        if (!scope) return;
        set((state) => ({
          projectCategories: normalizeProjectCategories(
            moveProjectToCategory(state.projectCategories, scope, categoryId?.trim() || null),
          ),
        }));
      },
    }),
    {
      name: "sidebar-project-workspace-order",
      storage: createValidatedPersistStorage(AsyncStorage, SidebarOrderPersistedStateSchema),
      partialize: (state) => ({
        projectOrder: state.projectOrder,
        pinnedWorkspaceOrder: state.pinnedWorkspaceOrder,
        workspaceOrderByProject: state.workspaceOrderByProject,
        projectCategories: state.projectCategories,
      }),
      version: 1,
      migrate: migrateSidebarOrderState,
    },
  ),
);
