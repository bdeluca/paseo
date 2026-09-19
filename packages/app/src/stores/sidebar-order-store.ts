import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  addProjectGroup,
  canCreateProjectGroupIn,
  moveProjectGroup,
  moveProjectToGroup,
  normalizeProjectGroups,
  removeProjectGroup,
  renameProjectGroup,
  reorderGroupProjectViewKeys,
  shiftProjectGroup,
  type SidebarProjectGroup,
  type StoredProjectGroup,
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
  createProjectGroup: (name: string, parentId: string | null) => string | null;
  renameProjectGroup: (groupId: string, name: string) => void;
  shiftProjectGroup: (groupId: string, direction: -1 | 1) => void;
  setGroupProjectOrder: (groupId: string, projectViewKeys: string[]) => void;
  deleteProjectGroup: (groupId: string) => void;
  moveProjectGroup: (groupId: string, parentId: string | null) => void;
  moveProjectToGroup: (projectViewKey: string, groupId: string | null) => void;
}

interface SidebarOrderPersistedState {
  projectOrder?: string[];
  pinnedWorkspaceOrder?: string[];
  workspaceOrderByProject?: Record<string, string[]>;
  projectGroups?: StoredProjectGroup[];
  projectCategories?: StoredProjectGroup[];
  projectOrderByServerId?: Record<string, string[]>;
  workspaceOrderByServerAndProject?: Record<string, string[]>;
}

const StringArrayRecordSchema = z.record(z.string(), z.array(z.string()));
const SidebarProjectGroupSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  // Optional, because a group written before project groups nested has none; it loads as a
  // top-level group. A top-level group is also written without it, so a sidebar that nests
  // nothing keeps the exact shape the flat build reads. `null` is the in-memory spelling of the
  // top level, which `merge` hands back through this schema after `migrate` has run.
  parentId: z.string().nullable().optional(),
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

function toStoredProjectGroup(group: SidebarProjectGroup): StoredProjectGroup {
  const { parentId, ...rest } = group;
  return parentId === null ? rest : group;
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
      createProjectGroup: (name, parentId) => {
        const groupName = name.trim();
        if (!groupName) return null;
        const group: SidebarProjectGroup = {
          id: createGroupId(),
          name: groupName,
          parentId,
          projectViewKeys: [],
        };
        const { projectGroups } = get();
        if (!canCreateProjectGroupIn(projectGroups, parentId)) return null;
        set({ projectGroups: normalizeProjectGroups(addProjectGroup(projectGroups, group)) });
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
      moveProjectGroup: (groupId, parentId) => {
        if (!groupId.trim()) return;
        set((state) => ({
          projectGroups: normalizeProjectGroups(
            moveProjectGroup(state.projectGroups, groupId, parentId),
          ),
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
        projectGroups: state.projectGroups.map(toStoredProjectGroup),
      }),
      // v2 is the rename from `projectCategories`; v3 adds `parentId` so groups can nest. Both
      // bumps exist to make zustand run the migration, which normalizes the list: a flat v2 group
      // comes through as a top-level group with its projects and order intact.
      version: 3,
      migrate: migrateSidebarOrderState,
      // zustand only migrates on a version mismatch, so a current-version blob would otherwise
      // load as stored. Every load goes through the same normalization instead: a group tree read
      // from storage is held to the invariants the transitions keep (no loops, no missing parent).
      merge: (persistedState, currentState) =>
        persistedState === undefined
          ? currentState
          : { ...currentState, ...migrateSidebarOrderState(persistedState) },
    },
  ),
);
