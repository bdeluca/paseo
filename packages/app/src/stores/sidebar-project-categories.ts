/**
 * User-named buckets of projects in the sidebar, device-local.
 *
 * A category is an entity rather than a field on a project: it survives being emptied, it carries
 * its own order, and it is the user's opinion about their sidebar rather than anything the daemon
 * knows. Membership is by `SidebarProjectEntry.viewKey`, the same key the sidebar orders and
 * collapses projects by, so a project that disappears from one host keeps its placement.
 *
 * Nothing here touches `projectKey`, the persisted equivalence key that groups the same logical
 * project across hosts — see docs/glossary.md. These transitions are pure so the store stays a
 * thin persistence shell over them.
 */
export interface SidebarProjectCategory {
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
 * The shape every write goes through: no blank or duplicate ids and names, and one category per
 * project. A project listed by two categories would otherwise render twice.
 */
export function normalizeProjectCategories(
  categories: readonly SidebarProjectCategory[],
): SidebarProjectCategory[] {
  const seenCategoryIds = new Set<string>();
  const placedProjectViewKeys = new Set<string>();
  const normalized: SidebarProjectCategory[] = [];

  for (const category of categories) {
    const id = category.id.trim();
    const name = category.name.trim();
    if (!id || !name || seenCategoryIds.has(id)) continue;

    const projectViewKeys = normalizeKeys(category.projectViewKeys).filter((projectViewKey) => {
      if (placedProjectViewKeys.has(projectViewKey)) return false;
      placedProjectViewKeys.add(projectViewKey);
      return true;
    });
    seenCategoryIds.add(id);
    normalized.push({ id, name, projectViewKeys });
  }

  return normalized;
}

export function renameProjectCategory(
  categories: readonly SidebarProjectCategory[],
  categoryId: string,
  name: string,
): SidebarProjectCategory[] {
  return categories.map((category) =>
    category.id === categoryId ? { ...category, name } : category,
  );
}

/** Moves one category one step through the list; out-of-range steps leave the order alone. */
export function shiftProjectCategory(
  categories: readonly SidebarProjectCategory[],
  categoryId: string,
  direction: -1 | 1,
): SidebarProjectCategory[] {
  const index = categories.findIndex((category) => category.id === categoryId);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= categories.length) return [...categories];
  const reordered = [...categories];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(destination, 0, moved);
  return reordered;
}

export function reorderCategoryProjectViewKeys(
  categories: readonly SidebarProjectCategory[],
  categoryId: string,
  projectViewKeys: readonly string[],
): SidebarProjectCategory[] {
  return categories.map((category) => {
    if (category.id !== categoryId) return category;
    const currentKeys = new Set(category.projectViewKeys);
    const orderedKeys = projectViewKeys.filter((key) => currentKeys.has(key));
    const orderedKeySet = new Set(orderedKeys);
    return {
      ...category,
      projectViewKeys: [
        ...orderedKeys,
        ...category.projectViewKeys.filter((key) => !orderedKeySet.has(key)),
      ],
    };
  });
}

/** Deleting a category returns its projects to Uncategorized; it never removes a project. */
export function removeProjectCategory(
  categories: readonly SidebarProjectCategory[],
  categoryId: string,
): SidebarProjectCategory[] {
  return categories.filter((category) => category.id !== categoryId);
}

export function moveProjectToCategory(
  categories: readonly SidebarProjectCategory[],
  projectViewKey: string,
  categoryId: string | null,
): SidebarProjectCategory[] {
  const targetExists =
    categoryId === null || categories.some((category) => category.id === categoryId);
  if (!targetExists) return [...categories];
  return categories.map((category) => {
    const remainingKeys = category.projectViewKeys.filter((key) => key !== projectViewKey);
    if (category.id !== categoryId) return { ...category, projectViewKeys: remainingKeys };
    return { ...category, projectViewKeys: [...remainingKeys, projectViewKey] };
  });
}

/** The category a project currently sits in, or `null` for Uncategorized. */
export function findProjectCategoryId(
  categories: readonly SidebarProjectCategory[],
  projectViewKey: string,
): string | null {
  const category = categories.find((entry) => entry.projectViewKeys.includes(projectViewKey));
  return category?.id ?? null;
}
