import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  moveProjectToGroup,
  normalizeProjectGroups,
  removeProjectGroup,
  renameProjectGroup,
  reorderGroupProjectViewKeys,
  shiftProjectGroup,
  type SidebarProjectGroup,
} from "./sidebar-project-groups";

export type { SidebarProjectGroup } from "./sidebar-project-groups";

interface SidebarOrderStoreState {
  projectOrder: string[];
  pinnedWorkspaceOrder: string[];
  workspaceOrderByProject: Record<string, string[]>;
  projectGroups: SidebarProjectGroup[];
  getProjectOrder: () => string[];
  setProjectOrder: (keys: string[]) => void;
  getPinnedWorkspaceOrder: () => string[];
  setPinnedWorkspaceOrder: (keys: string[]) => void;
  getWorkspaceOrder: (projectViewKey: string) => string[];
  setWorkspaceOrder: (projectViewKey: string, keys: string[]) => void;
  createProjectGroup: (name: string) => string | null;
  renameProjectGroup: (groupId: string, name: string) => void;
  shiftProjectGroup: (groupId: string, direction: -1 | 1) => void;
  setGroupProjectOrder: (groupId: string, projectViewKeys: string[]) => void;
  deleteProjectGroup: (groupId: string) => void;
  moveProjectToGroup: (projectViewKey: string, groupId: string | null) => void;
}

interface SidebarOrderPersistedState {
  projectOrder?: string[];
  pinnedWorkspaceOrder?: string[];
  workspaceOrderByProject?: Record<string, string[]>;
  projectGroups?: SidebarProjectGroup[];
  projectCategories?: SidebarProjectGroup[];
  projectOrderByServerId?: Record<string, string[]>;
  workspaceOrderByServerAndProject?: Record<string, string[]>;
}

const StringArrayRecordSchema = z.record(z.string(), z.array(z.string()));
const SidebarProjectGroupSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  projectViewKeys: z.array(z.string()),
});
const SidebarOrderPersistedStateSchema = z.strictObject({
  projectOrder: z.array(z.string()).optional(),
  pinnedWorkspaceOrder: z.array(z.string()).optional(),
  workspaceOrderByProject: StringArrayRecordSchema.optional(),
  // Optional, because a settings blob written before project groups existed has no such key and
  // must still restore the orders it does carry.
  projectGroups: z.array(SidebarProjectGroupSchema).optional(),
  // COMPAT(projectGroups): the same list shipped as `projectCategories` in v0.8.1 before the
  // feature took the user's own word. Read by the v2 migration below; remove after 2027-03-13.
  projectCategories: z.array(SidebarProjectGroupSchema).optional(),
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
  projectGroups: SidebarProjectGroup[];
} {
  const result = SidebarOrderPersistedStateSchema.safeParse(persistedState);
  if (!result.success) {
    return {
      projectOrder: [],
      pinnedWorkspaceOrder: [],
      workspaceOrderByProject: {},
      projectGroups: [],
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
    projectGroups: normalizeProjectGroups(state.projectGroups ?? state.projectCategories ?? []),
  };
}

function createGroupId(): string {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `group_${randomId}`;
}

export const useSidebarOrderStore = create<SidebarOrderStoreState>()(
  persist(
    (set, get) => ({
      projectOrder: [],
      pinnedWorkspaceOrder: [],
      workspaceOrderByProject: {},
      projectGroups: [],
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
      // Returns the new id so the caller that created a group can move a project into it in
      // the same gesture, which is how "New group" on a project row works.
      createProjectGroup: (name) => {
        const groupName = name.trim();
        if (!groupName) return null;
        const group: SidebarProjectGroup = {
          id: createGroupId(),
          name: groupName,
          projectViewKeys: [],
        };
        set((state) => ({
          projectGroups: normalizeProjectGroups([...state.projectGroups, group]),
        }));
        return group.id;
      },
      renameProjectGroup: (groupId, name) => {
        const groupName = name.trim();
        if (!groupName || !groupId.trim()) return;
        set((state) => ({
          projectGroups: normalizeProjectGroups(
            renameProjectGroup(state.projectGroups, groupId, groupName),
          ),
        }));
      },
      shiftProjectGroup: (groupId, direction) => {
        if (!groupId.trim()) return;
        set((state) => ({
          projectGroups: normalizeProjectGroups(
            shiftProjectGroup(state.projectGroups, groupId, direction),
          ),
        }));
      },
      setGroupProjectOrder: (groupId, projectViewKeys) => {
        if (!groupId.trim()) return;
        const orderedKeys = normalizeKeys(projectViewKeys);
        set((state) => ({
          projectGroups: normalizeProjectGroups(
            reorderGroupProjectViewKeys(state.projectGroups, groupId, orderedKeys),
          ),
        }));
      },
      deleteProjectGroup: (groupId) => {
        if (!groupId.trim()) return;
        set((state) => ({
          projectGroups: normalizeProjectGroups(removeProjectGroup(state.projectGroups, groupId)),
        }));
      },
      moveProjectToGroup: (projectViewKey, groupId) => {
        const scope = projectViewKey.trim();
        if (!scope) return;
        set((state) => ({
          projectGroups: normalizeProjectGroups(
            moveProjectToGroup(state.projectGroups, scope, groupId?.trim() || null),
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
        projectGroups: state.projectGroups,
      }),
      // v2 is the rename from `projectCategories`. The persisted shape is otherwise unchanged, so
      // the bump exists only to make zustand run the migration that carries the old key over.
      version: 2,
      migrate: migrateSidebarOrderState,
    },
  ),
);
