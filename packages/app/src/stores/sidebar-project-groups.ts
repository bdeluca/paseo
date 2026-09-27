/**
 * Project groups: user-named buckets of projects in the sidebar, device-local.
 *
 * A project group is an entity rather than a field on a project: it survives being emptied, it
 * carries its own order, and it is the user's opinion about their sidebar rather than anything the
 * daemon knows. Membership is by `SidebarProjectEntry.viewKey`, the same key the sidebar orders and
 * collapses projects by, so a project that disappears from one host keeps its placement.
 *
 * Groups form a tree. Each group names its parent (`null` for the top level) and the list order
 * is the sibling order, so a group's children are the groups that name it, in list order. Inside
 * a group its subgroups render before its own projects, the way a file tree puts folders first.
 *
 * Nothing here touches `projectKey`, the persisted equivalence key that groups the same logical
 * project across hosts — see docs/glossary.md. These transitions are pure so the store stays a
 * thin persistence shell over them, and every invariant the tree has — no cycles, no group deeper
 * than `MAX_PROJECT_GROUP_DEPTH`, one group per project — is enforced here rather than in a menu.
 */
export interface SidebarProjectGroup {
  id: string;
  name: string;
  parentId: string | null;
  projectViewKeys: string[];
}

/**
 * How many project groups can nest, counting the top level as 1. Each level indents a group's
 * rows one spine further, and the sidebar can be dragged down to 200px wide; see
 * docs/project-groups.md for the measurement behind the number.
 */
export const MAX_PROJECT_GROUP_DEPTH = 4;

/**
 * A group as storage hands it over. A flat group written before nesting has no `parentId` at all,
 * and loads as a top-level group.
 */
export type StoredProjectGroup = Omit<SidebarProjectGroup, "parentId"> & {
  parentId?: string | null;
};

/** One group in tree order, with its depth from the top level (0). */
interface SidebarProjectGroupTreeEntry {
  group: SidebarProjectGroup;
  depth: number;
}

function normalizeKeys(keys: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawKey of keys) {
    const key = rawKey.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }

  return normalized;
}

/**
 * The shape every write goes through: no blank or duplicate ids and names, one project group per
 * project, and a parent chain that ends at the top level. A project listed by two groups would
 * otherwise render twice; a parent that is missing or loops back would leave its group reachable
 * from nowhere, so that group is lifted to the top level rather than lost.
 */
export function normalizeProjectGroups(
  groups: readonly StoredProjectGroup[],
): SidebarProjectGroup[] {
  const seenGroupIds = new Set<string>();
  const placedProjectViewKeys = new Set<string>();
  const kept: SidebarProjectGroup[] = [];

  for (const group of groups) {
    const id = group.id.trim();
    const name = group.name.trim();
    if (!id || !name || seenGroupIds.has(id)) continue;

    const projectViewKeys = normalizeKeys(group.projectViewKeys).filter((projectViewKey) => {
      if (placedProjectViewKeys.has(projectViewKey)) return false;
      placedProjectViewKeys.add(projectViewKey);
      return true;
    });
    seenGroupIds.add(id);
    kept.push({ id, name, parentId: group.parentId?.trim() || null, projectViewKeys });
  }

  return detachUnrootedGroups(kept);
}

/**
 * Lifts every group whose parent chain does not reach the top level. Groups are visited in list
 * order and fixed as they are visited, so in a loop the first group listed becomes the root and
 * the rest keep their parents.
 */
function detachUnrootedGroups(groups: SidebarProjectGroup[]): SidebarProjectGroup[] {
  const parentById = new Map(groups.map((group) => [group.id, group.parentId]));

  return groups.map((group) => {
    const visited = new Set<string>([group.id]);
    let cursor = group.parentId;
    while (cursor !== null) {
      if (visited.has(cursor) || !parentById.has(cursor)) {
        parentById.set(group.id, null);
        return { ...group, parentId: null };
      }
      visited.add(cursor);
      cursor = parentById.get(cursor) ?? null;
    }
    return group;
  });
}

/** Every group in the order the sidebar draws it: each group, then its subtree. */
export function flattenProjectGroupTree(
  groups: readonly SidebarProjectGroup[],
): SidebarProjectGroupTreeEntry[] {
  const entries: SidebarProjectGroupTreeEntry[] = [];
  function visit(parentId: string | null, depth: number) {
    for (const group of groups) {
      if (group.parentId !== parentId) continue;
      entries.push({ group, depth });
      visit(group.id, depth + 1);
    }
  }
  visit(null, 0);
  return entries;
}

/** 1 for a top-level group, 2 for a group inside it, and so on; 0 for an id that is not a group. */
export function projectGroupLevel(groups: readonly SidebarProjectGroup[], groupId: string): number {
  const parentById = new Map(groups.map((group) => [group.id, group.parentId]));
  if (!parentById.has(groupId)) return 0;
  let level = 1;
  let cursor = parentById.get(groupId) ?? null;
  while (cursor !== null && level <= groups.length) {
    level += 1;
    cursor = parentById.get(cursor) ?? null;
  }
  return level;
}

/** Whether `groupId` is `ancestorId` itself or sits anywhere beneath it. */
export function isProjectGroupWithin(
  groups: readonly SidebarProjectGroup[],
  groupId: string,
  ancestorId: string,
): boolean {
  const parentById = new Map(groups.map((group) => [group.id, group.parentId]));
  let cursor: string | null = groupId;
  let steps = 0;
  while (cursor !== null && steps <= groups.length) {
    if (cursor === ancestorId) return true;
    cursor = parentById.get(cursor) ?? null;
    steps += 1;
  }
  return false;
}

/** Levels in a group's subtree, the group itself included: 1 for a group with no subgroups. */
function subtreeHeight(groups: readonly SidebarProjectGroup[], groupId: string): number {
  let tallestChild = 0;
  for (const group of groups) {
    if (group.parentId !== groupId) continue;
    tallestChild = Math.max(tallestChild, subtreeHeight(groups, group.id));
  }
  return tallestChild + 1;
}

/** Whether a new project group may be created inside `parentId` (`null` is the top level). */
export function canCreateProjectGroupIn(
  groups: readonly SidebarProjectGroup[],
  parentId: string | null,
): boolean {
  if (parentId === null) return true;
  const parentLevel = projectGroupLevel(groups, parentId);
  return parentLevel > 0 && parentLevel < MAX_PROJECT_GROUP_DEPTH;
}

/**
 * Whether `groupId` may move into `parentId`. Never into itself or anything beneath it — that
 * would cut its subtree off the tree — and never so deep that its own subgroups pass the cap.
 */
export function canMoveProjectGroup(
  groups: readonly SidebarProjectGroup[],
  groupId: string,
  parentId: string | null,
): boolean {
  if (!groups.some((group) => group.id === groupId)) return false;
  if (parentId === null) return true;
  if (isProjectGroupWithin(groups, parentId, groupId)) return false;
  const parentLevel = projectGroupLevel(groups, parentId);
  if (parentLevel === 0) return false;
  return parentLevel + subtreeHeight(groups, groupId) <= MAX_PROJECT_GROUP_DEPTH;
}

/** Adds a group as the last child of `group.parentId`; refused when that parent cannot take one. */
export function addProjectGroup(
  groups: readonly SidebarProjectGroup[],
  group: SidebarProjectGroup,
): SidebarProjectGroup[] {
  if (!canCreateProjectGroupIn(groups, group.parentId)) return [...groups];
  return [...groups, group];
}

export function renameProjectGroup(
  groups: readonly SidebarProjectGroup[],
  groupId: string,
  name: string,
): SidebarProjectGroup[] {
  return groups.map((group) => (group.id === groupId ? { ...group, name } : group));
}

/**
 * Moves a group, with its whole subtree, to the end of `parentId`'s subgroups. A move the tree
 * cannot take — see `canMoveProjectGroup` — leaves it where it is.
 */
export function moveProjectGroup(
  groups: readonly SidebarProjectGroup[],
  groupId: string,
  parentId: string | null,
): SidebarProjectGroup[] {
  const group = groups.find((entry) => entry.id === groupId);
  if (!group || group.parentId === parentId) return [...groups];
  if (!canMoveProjectGroup(groups, groupId, parentId)) return [...groups];
  // The list order is the sibling order, so the end of the list is the end of any sibling set.
  return [...groups.filter((entry) => entry.id !== groupId), withParent(group, parentId)];
}

/**
 * Moves one project group one step among its siblings; out-of-range steps leave the order alone.
 * Groups under other parents sit between siblings in the list and keep their places.
 */
export function shiftProjectGroup(
  groups: readonly SidebarProjectGroup[],
  groupId: string,
  direction: -1 | 1,
): SidebarProjectGroup[] {
  const group = groups.find((entry) => entry.id === groupId);
  if (!group) return [...groups];
  const siblingIndexes = groups.flatMap((entry, index) =>
    entry.parentId === group.parentId ? [index] : [],
  );
  const groupIndex = groups.indexOf(group);
  const neighbourIndex = siblingIndexes[siblingIndexes.indexOf(groupIndex) + direction];
  if (neighbourIndex === undefined) return [...groups];
  const reordered = [...groups];
  reordered[neighbourIndex] = group;
  reordered[groupIndex] = groups[neighbourIndex];
  return reordered;
}

export function reorderGroupProjectViewKeys(
  groups: readonly SidebarProjectGroup[],
  groupId: string,
  projectViewKeys: readonly string[],
): SidebarProjectGroup[] {
  return groups.map((group) => {
    if (group.id !== groupId) return group;
    const currentKeys = new Set(group.projectViewKeys);
    const orderedKeys = projectViewKeys.filter((key) => currentKeys.has(key));
    const orderedKeySet = new Set(orderedKeys);
    return {
      ...group,
      projectViewKeys: [
        ...orderedKeys,
        ...group.projectViewKeys.filter((key) => !orderedKeySet.has(key)),
      ],
    };
  });
}

function withParent(group: SidebarProjectGroup, parentId: string | null): SidebarProjectGroup {
  return { ...group, parentId };
}

/**
 * Deleting a project group removes that one level and nothing under it: its subgroups take its
 * place among its siblings, and its projects join its parent's — Ungrouped when it had none. A
 * group never owns a project, or another group, hard enough to take it with it.
 */
export function removeProjectGroup(
  groups: readonly SidebarProjectGroup[],
  groupId: string,
): SidebarProjectGroup[] {
  const removed = groups.find((group) => group.id === groupId);
  if (!removed) return [...groups];

  const children = groups
    .filter((group) => group.parentId === groupId)
    .map((group) => withParent(group, removed.parentId));

  return groups.flatMap((group) => {
    if (group.id === groupId) return children;
    if (group.parentId === groupId) return [];
    if (group.id === removed.parentId) {
      return [
        { ...group, projectViewKeys: [...group.projectViewKeys, ...removed.projectViewKeys] },
      ];
    }
    return [group];
  });
}

export function moveProjectToGroup(
  groups: readonly SidebarProjectGroup[],
  projectViewKey: string,
  groupId: string | null,
): SidebarProjectGroup[] {
  const targetExists = groupId === null || groups.some((group) => group.id === groupId);
  if (!targetExists) return [...groups];
  return groups.map((group) => {
    const remainingKeys = group.projectViewKeys.filter((key) => key !== projectViewKey);
    if (group.id !== groupId) return { ...group, projectViewKeys: remainingKeys };
    return { ...group, projectViewKeys: [...remainingKeys, projectViewKey] };
  });
}

/** The project group a project currently sits in, or `null` for Ungrouped. */
export function findProjectGroupId(
  groups: readonly SidebarProjectGroup[],
  projectViewKey: string,
): string | null {
  const group = groups.find((entry) => entry.projectViewKeys.includes(projectViewKey));
  return group?.id ?? null;
}
