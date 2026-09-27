/**
 * Project groups: user-named buckets of projects in the sidebar, device-local.
 *
 * A project group is an entity rather than a field on a project: it survives being emptied, it
 * carries its own order, and it is the user's opinion about their sidebar rather than anything the
 * daemon knows. Membership is by `SidebarProjectEntry.viewKey`, the same key the sidebar orders and
 * collapses projects by, so a project that disappears from one host keeps its placement.
 *
 * Nothing here touches `projectKey`, the persisted equivalence key that groups the same logical
 * project across hosts — see docs/glossary.md. These transitions are pure so the store stays a
 * thin persistence shell over them.
 */
export interface SidebarProjectGroup {
  id: string;
  name: string;
  projectViewKeys: string[];
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
 * The shape every write goes through: no blank or duplicate ids and names, and one project group
 * per project. A project listed by two groups would otherwise render twice.
 */
export function normalizeProjectGroups(
  groups: readonly SidebarProjectGroup[],
): SidebarProjectGroup[] {
  const seenGroupIds = new Set<string>();
  const placedProjectViewKeys = new Set<string>();
  const normalized: SidebarProjectGroup[] = [];

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
    normalized.push({ id, name, projectViewKeys });
  }

  return normalized;
}

export function renameProjectGroup(
  groups: readonly SidebarProjectGroup[],
  groupId: string,
  name: string,
): SidebarProjectGroup[] {
  return groups.map((group) => (group.id === groupId ? { ...group, name } : group));
}

/** Moves one project group one step through the list; out-of-range steps leave the order alone. */
export function shiftProjectGroup(
  groups: readonly SidebarProjectGroup[],
  groupId: string,
  direction: -1 | 1,
): SidebarProjectGroup[] {
  const index = groups.findIndex((group) => group.id === groupId);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= groups.length) return [...groups];
  const reordered = [...groups];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(destination, 0, moved);
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

/** Deleting a project group returns its projects to Ungrouped; it never removes a project. */
export function removeProjectGroup(
  groups: readonly SidebarProjectGroup[],
  groupId: string,
): SidebarProjectGroup[] {
  return groups.filter((group) => group.id !== groupId);
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
