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
import type { SidebarProjectGroup } from "@/stores/sidebar-project-groups";
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

/** The collapse key the Ungrouped bucket answers to; no group id can take it. */
const UNGROUPED_COLLAPSE_KEY = "ungrouped";

export interface SidebarProjection {
  pinnedGroups: PinnedSidebarGroups;
  workspaceGroups: SidebarWorkspaceGroup[];
  /**
   * Project mode's project rows, in the order they render: one entry per project group the user
   * named, then the Ungrouped remainder. A user with no project groups gets the remainder alone,
   * holding every project in the order it already had. Unrelated to `workspaceGroups`, which is
   * what status mode groups workspace rows into.
   */
  projectGroupViews: SidebarProjectGroupView[];
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

/** One rendered project group. `id` and `name` are null for the Ungrouped remainder. */
export interface SidebarProjectGroupView {
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
  collapsedProjectGroupKeys: ReadonlySet<string>;
  projectGroups: readonly SidebarProjectGroup[];
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
  const projectGroupViews = buildProjectGroupViews({
    projects: pinnedGroups.unpinnedProjects,
    groups: input.projectGroups,
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
    // Shortcuts walk the project groups in render order, so a numbered row is always the row the
    // number lands on. A collapsed group hides every project under it, which is why the collapse
    // is an OR rather than the project's own flag.
    sections.push(
      ...projectGroupViews.flatMap((group) => {
        const groupCollapsed = input.collapsedProjectGroupKeys.has(group.collapseKey);
        return group.projects.map((project) => ({
          workspaces: project.workspaces,
          collapsed: groupCollapsed || input.collapsedProjectKeys.has(project.viewKey),
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
    projectGroupViews,
    projectIconTargets: resolveSidebarProjectIconTargets(input.projects),
    shortcutModel: buildSidebarShortcutSections({ sections }),
  };
}

/**
 * Places each project in the project group that claims it, in that group's order, and leaves the
 * rest in Ungrouped. A group that claims a project the sidebar cannot see right now — a host is
 * offline, a filter narrowed the list — renders empty rather than disappearing, so its membership
 * survives the project coming back.
 */
function buildProjectGroupViews(input: {
  projects: readonly SidebarProjectEntry[];
  groups: readonly SidebarProjectGroup[];
}): SidebarProjectGroupView[] {
  const projectsByViewKey = new Map(input.projects.map((project) => [project.viewKey, project]));
  const claimedProjectViewKeys = new Set<string>();
  const groups = input.groups.map((group) => {
    const projects = group.projectViewKeys.flatMap((projectViewKey) => {
      const project = projectsByViewKey.get(projectViewKey);
      if (!project || claimedProjectViewKeys.has(projectViewKey)) return [];
      claimedProjectViewKeys.add(projectViewKey);
      return [project];
    });
    return { id: group.id, name: group.name, collapseKey: group.id, projects };
  });
  const ungroupedProjects = input.projects.filter(
    (project) => !claimedProjectViewKeys.has(project.viewKey),
  );

  return [
    ...groups,
    {
      id: null,
      name: null,
      collapseKey: UNGROUPED_COLLAPSE_KEY,
      projects: ungroupedProjects,
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
