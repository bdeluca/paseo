import { buildStatusGroups } from "@/hooks/sidebar-status-view-model";
import {
  splitPinnedSidebarGroups,
  type PinnedSidebarGroups,
  type PinnedSidebarKeys,
} from "@/hooks/use-sidebar-pins";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarGroupMode } from "@/stores/sidebar-view-store";
import type { SidebarProjectCategory } from "@/stores/sidebar-project-categories";
import {
  resolveSidebarProjectIconTargets,
  type SidebarProjectIconTarget,
} from "@/utils/sidebar-project-row-model";
import {
  buildSidebarShortcutSections,
  type SidebarShortcutModel,
  type SidebarShortcutSection,
} from "@/utils/sidebar-shortcuts";
import { statusWorkspaceGroups, type SidebarWorkspaceGroup } from "./sidebar-labels";

/** The collapse key the Uncategorized bucket answers to; no category id can take it. */
const UNCATEGORIZED_COLLAPSE_KEY = "uncategorized";

export interface SidebarProjection {
  pinnedGroups: PinnedSidebarGroups;
  workspaceGroups: SidebarWorkspaceGroup[];
  /**
   * Project mode's project rows, in the order they render: one entry per category the user named,
   * then the Uncategorized remainder. A user with no categories gets the remainder alone, holding
   * every project in the order it already had.
   */
  projectCategoryViews: SidebarProjectCategoryView[];
  /**
   * The project icons this projection needs fetched, keyed by `projectViewKey` — one per project,
   * whatever the mode groups by. It sits here rather than beside `useProjectIcons` in the list
   * because it is the same `projects` the rows above are projected from: a mode that renders a
   * row can only ever ask for an icon this list already covers. It used to be derived in the
   * list, under a `groupMode === "status"` gate written when status was the only mode that put
   * icons on rows.
   */
  projectIconTargets: SidebarProjectIconTarget[];
  shortcutModel: SidebarShortcutModel;
}

/** One rendered category. `id` and `name` are null for the Uncategorized remainder. */
export interface SidebarProjectCategoryView {
  id: string | null;
  name: string | null;
  collapseKey: string;
  projects: SidebarProjectEntry[];
}

export interface SidebarProjectionInput {
  projects: SidebarProjectEntry[];
  pinnedKeys: PinnedSidebarKeys;
  pinnedWorkspaceOrder: string[];
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectNamesByViewKey: Map<string, string>;
  groupMode: SidebarGroupMode;
  pinnedCollapsed: boolean;
  collapsedProjectKeys: ReadonlySet<string>;
  collapsedWorkspaceGroupKeys: ReadonlySet<string>;
  collapsedProjectCategoryKeys: ReadonlySet<string>;
  projectCategories: readonly SidebarProjectCategory[];
}

export function buildSidebarProjection(input: SidebarProjectionInput): SidebarProjection {
  const pinnedGroups = splitPinnedSidebarGroups({
    projects: input.projects,
    keys: input.pinnedKeys,
    pinnedWorkspaceOrder: input.pinnedWorkspaceOrder,
  });
  const pinnedWorkspaceKeys = new Set(input.pinnedKeys.pinnedWorkspaceKeys);
  const unpinnedWorkspaces = Array.from(input.workspaceEntriesByKey.values()).filter(
    (workspace) => !pinnedWorkspaceKeys.has(workspace.workspaceKey),
  );
  const projectCategoryViews = buildProjectCategoryViews({
    projects: pinnedGroups.unpinnedProjects,
    categories: input.projectCategories,
  });
  // One switch decides both what the list groups by and what the keyboard shortcuts walk, so the
  // two cannot disagree and a new grouping mode is a compile error here rather than a silent
  // fall-through to the project rows.
  const workspaceGroups = buildWorkspaceGroups(input, unpinnedWorkspaces);

  const sections: SidebarShortcutSection[] = [];
  if (!input.pinnedCollapsed) {
    sections.push({ workspaces: pinnedGroups.pinnedChats });
  }
  if (input.groupMode === "project") {
    // Shortcuts walk the categories in render order, so a numbered row is always the row the
    // number lands on. A collapsed category hides every project under it, which is why the
    // collapse is an OR rather than the project's own flag.
    sections.push(
      ...projectCategoryViews.flatMap((category) => {
        const categoryCollapsed = input.collapsedProjectCategoryKeys.has(category.collapseKey);
        return category.projects.map((project) => ({
          workspaces: project.workspaces,
          collapsed: categoryCollapsed || input.collapsedProjectKeys.has(project.viewKey),
        }));
      }),
    );
  } else {
    sections.push(
      ...workspaceGroups.map((group) => ({
        workspaces: group.rows,
        collapsed: input.collapsedWorkspaceGroupKeys.has(group.key),
      })),
    );
  }

  return {
    pinnedGroups,
    workspaceGroups,
    projectCategoryViews,
    projectIconTargets: resolveSidebarProjectIconTargets(input.projects),
    shortcutModel: buildSidebarShortcutSections({ sections }),
  };
}

/**
 * Places each project in the category that claims it, in that category's order, and leaves the
 * rest in Uncategorized. A category that claims a project the sidebar cannot see right now — a
 * host is offline, a filter narrowed the list — renders empty rather than disappearing, so its
 * membership survives the project coming back.
 */
function buildProjectCategoryViews(input: {
  projects: readonly SidebarProjectEntry[];
  categories: readonly SidebarProjectCategory[];
}): SidebarProjectCategoryView[] {
  const projectsByViewKey = new Map(input.projects.map((project) => [project.viewKey, project]));
  const claimedProjectViewKeys = new Set<string>();
  const categories = input.categories.map((category) => {
    const projects = category.projectViewKeys.flatMap((projectViewKey) => {
      const project = projectsByViewKey.get(projectViewKey);
      if (!project || claimedProjectViewKeys.has(projectViewKey)) return [];
      claimedProjectViewKeys.add(projectViewKey);
      return [project];
    });
    return { id: category.id, name: category.name, collapseKey: category.id, projects };
  });
  const uncategorizedProjects = input.projects.filter(
    (project) => !claimedProjectViewKeys.has(project.viewKey),
  );

  return [
    ...categories,
    {
      id: null,
      name: null,
      collapseKey: UNCATEGORIZED_COLLAPSE_KEY,
      projects: uncategorizedProjects,
    },
  ];
}

/** Project mode keeps its project headers and groups nothing; status mode groups the rows. */
function buildWorkspaceGroups(
  input: SidebarProjectionInput,
  unpinnedWorkspaces: SidebarWorkspaceEntry[],
): SidebarWorkspaceGroup[] {
  switch (input.groupMode) {
    case "project":
      return [];
    case "status":
      return statusWorkspaceGroups(
        buildStatusGroups(unpinnedWorkspaces, input.projectNamesByViewKey),
      );
  }
}
