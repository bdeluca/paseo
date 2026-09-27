import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import { buildSidebarProjection, type SidebarProjectGroupView } from "./sidebar-projection";

function makeWorkspace(
  id: string,
  statusBucket: SidebarWorkspaceEntry["statusBucket"] = "done",
  labels: string[] = [],
  projectViewKey = "project",
) {
  const placement: SidebarWorkspacePlacement = {
    workspaceKey: `srv:${id}`,
    serverId: "srv",
    workspaceId: id,
    projectViewKey,
    projectName: "Project",
    projectKind: "git",
    workspaceKind: "worktree",
    name: id,
  };
  const entry: SidebarWorkspaceEntry = {
    ...placement,
    workspaceDirectory: "",
    workspaceDirectoryLabel: "",
    title: null,
    currentBranch: null,
    statusBucket,
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    labels,
  };
  return { placement, entry };
}

function makeProject(
  workspaces: SidebarWorkspacePlacement[],
  viewKey = "project",
): SidebarProjectEntry {
  return {
    viewKey,
    projectName: "Project",
    projectKind: "git",
    iconWorkingDir: `/repo/${viewKey}`,
    hosts: [
      {
        serverId: "srv",
        projectId: viewKey,
        iconWorkingDir: `/repo/${viewKey}`,
        worktreeSupport: "supported" as const,
      },
    ],
    workspaces,
  };
}

function projectionInput(options?: {
  groupMode?: "project" | "status";
  pinnedCollapsed?: boolean;
}) {
  const pinned = makeWorkspace("pinned", "running");
  const unpinned = makeWorkspace("unpinned", "needs_input");
  return {
    projects: [makeProject([pinned.placement, unpinned.placement])],
    pinnedKeys: {
      pinnedWorkspaceKeys: [pinned.placement.workspaceKey],
      pinnedAtByKey: { [pinned.placement.workspaceKey]: "2026-07-12T12:00:00.000Z" },
    },
    pinnedWorkspaceOrder: [],
    workspaceEntriesByKey: new Map([
      [pinned.entry.workspaceKey, pinned.entry],
      [unpinned.entry.workspaceKey, unpinned.entry],
    ]),
    projectNamesByViewKey: new Map([["project", "Project"]]),
    groupMode: options?.groupMode ?? ("project" as const),
    pinnedCollapsed: options?.pinnedCollapsed ?? false,
    collapsedProjectKeys: new Set<string>(),
    collapsedWorkspaceGroupKeys: new Set<string>(),
    collapsedProjectGroupKeys: new Set<string>(),
    projectGroups: [],
  };
}

/**
 * Two projects, one workspace each, both labelled — so every grouping mode puts rows from more
 * than one project on screen, and a mode that asked for fewer icons than it renders would show it.
 */
function twoProjectInput(groupMode: "project" | "status") {
  const first = makeWorkspace("first", "running", ["Urgent"], "project");
  const second = makeWorkspace("second", "needs_input", ["Backend"], "other-project");
  return {
    ...projectionInput({ groupMode }),
    projects: [makeProject([first.placement]), makeProject([second.placement], "other-project")],
    pinnedKeys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
    workspaceEntriesByKey: new Map([
      [first.entry.workspaceKey, first.entry],
      [second.entry.workspaceKey, second.entry],
    ]),
    projectNamesByViewKey: new Map([
      ["project", "Project"],
      ["other-project", "Other project"],
    ]),
  };
}

function toProjectViewKey(project: SidebarProjectEntry): string {
  return project.viewKey;
}

/**
 * Four projects under a three-level tree, one workspace each (named after its project):
 *
 * work        [a]
 *   clients   [b]
 *     acme    [c]
 * Ungrouped   [d]
 */
function nestedInput(collapsedProjectGroupKeys: string[] = []) {
  const workspaces = ["a", "b", "c", "d"].map((key) => makeWorkspace(key, "done", [], key));
  return {
    ...projectionInput({ groupMode: "project" }),
    projects: workspaces.map((workspace) =>
      makeProject([workspace.placement], workspace.placement.projectViewKey),
    ),
    pinnedKeys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
    workspaceEntriesByKey: new Map(
      workspaces.map((workspace) => [workspace.entry.workspaceKey, workspace.entry]),
    ),
    projectNamesByViewKey: new Map(
      workspaces.map((workspace) => [workspace.placement.projectViewKey, "P"]),
    ),
    projectGroups: [
      { id: "work", name: "Work", parentId: null, projectViewKeys: ["a"] },
      { id: "clients", name: "Clients", parentId: "work", projectViewKeys: ["b"] },
      { id: "acme", name: "Acme", parentId: "clients", projectViewKeys: ["c"] },
    ],
    collapsedProjectGroupKeys: new Set(collapsedProjectGroupKeys),
  };
}

interface GroupViewShape {
  name: string | null;
  projectCount: number;
  projects: string[];
  groups: GroupViewShape[];
}

function groupViewShape(group: SidebarProjectGroupView): GroupViewShape {
  return {
    name: group.name,
    projectCount: group.projectCount,
    projects: group.projects.map(toProjectViewKey),
    groups: group.groups.map(groupViewShape),
  };
}

function shortcutWorkspaceIds(projection: ReturnType<typeof buildSidebarProjection>): string[] {
  return projection.shortcutModel.shortcutTargets.map((target) => target.workspaceId);
}

describe("buildSidebarProjection", () => {
  // The rule that outlived the bug it was written for: a project icon is fetched per project, so
  // whatever a mode groups by, the rows it produces can only reference projects already covered.
  for (const groupMode of ["project", "status"] as const) {
    it(`covers every row ${groupMode} grouping renders with a project icon target`, () => {
      const projection = buildSidebarProjection(twoProjectInput(groupMode));
      const covered = new Set(projection.projectIconTargets.map((target) => target.projectViewKey));

      // Every leading visual the sidebar can paint from this projection: pinned rows, grouped
      // rows, project headers and the rows under them.
      const renderedProjectViewKeys = new Set<string>();
      for (const entry of projection.pinnedGroups.pinnedChats) {
        renderedProjectViewKeys.add(entry.projectViewKey);
      }
      for (const group of projection.workspaceGroups) {
        for (const entry of group.rows) renderedProjectViewKeys.add(entry.projectViewKey);
      }
      for (const project of projection.pinnedGroups.unpinnedProjects) {
        renderedProjectViewKeys.add(project.viewKey);
        for (const entry of project.workspaces) renderedProjectViewKeys.add(entry.projectViewKey);
      }

      expect([...renderedProjectViewKeys].sort()).toEqual(["other-project", "project"]);
      expect([...renderedProjectViewKeys].filter((viewKey) => !covered.has(viewKey))).toEqual([]);
    });
  }

  it("uses one pin-aware projection for project rows and shortcut order", () => {
    const projection = buildSidebarProjection(projectionInput());

    expect(projection.pinnedGroups.pinnedChats.map((entry) => entry.workspaceId)).toEqual([
      "pinned",
    ]);
    const remainingProject = projection.pinnedGroups.unpinnedProjects[0];
    expect(remainingProject?.workspaces.map((entry) => entry.workspaceId)).toEqual(["unpinned"]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("keeps pinned chats above status groups and removes them from those groups", () => {
    const projection = buildSidebarProjection(projectionInput({ groupMode: "status" }));

    expect(projection.workspaceGroups.map((group) => group.key)).toEqual(["needs_input"]);
    expect(projection.workspaceGroups[0]?.rows.map((entry) => entry.workspaceId)).toEqual([
      "unpinned",
    ]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("leaves every project in Ungrouped when no group exists", () => {
    const projection = buildSidebarProjection(twoProjectInput("project"));

    expect(projection.projectGroupViews).toHaveLength(1);
    expect(projection.projectGroupViews[0]?.id).toBeNull();
    expect(projection.projectGroupViews[0]?.projects.map((project) => project.viewKey)).toEqual([
      "project",
      "other-project",
    ]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "first" },
      { serverId: "srv", workspaceId: "second" },
    ]);
  });

  it("orders project rows and shortcuts by group, remainder last", () => {
    const projection = buildSidebarProjection({
      ...twoProjectInput("project"),
      projectGroups: [
        { id: "infra", name: "Infrastructure", parentId: null, projectViewKeys: ["other-project"] },
        { id: "products", name: "Products", parentId: null, projectViewKeys: [] },
      ],
    });

    const renderedGroups = projection.projectGroupViews.map((group) => ({
      name: group.name,
      projectViewKeys: group.projects.map(toProjectViewKey),
    }));
    expect(renderedGroups).toEqual([
      { name: "Infrastructure", projectViewKeys: ["other-project"] },
      { name: "Products", projectViewKeys: [] },
      { name: null, projectViewKeys: ["project"] },
    ]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "second" },
      { serverId: "srv", workspaceId: "first" },
    ]);
  });

  it("does not number the rows inside a collapsed group", () => {
    const projection = buildSidebarProjection({
      ...twoProjectInput("project"),
      projectGroups: [
        { id: "infra", name: "Infrastructure", parentId: null, projectViewKeys: ["other-project"] },
      ],
      collapsedProjectGroupKeys: new Set(["infra"]),
    });

    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "first" },
    ]);
  });

  it("keeps a group that claims a project the sidebar cannot see", () => {
    const projection = buildSidebarProjection({
      ...twoProjectInput("project"),
      projectGroups: [
        { id: "infra", name: "Infrastructure", parentId: null, projectViewKeys: ["offline"] },
      ],
    });

    expect(projection.projectGroupViews[0]).toEqual({
      id: "infra",
      name: "Infrastructure",
      collapseKey: "infra",
      groups: [],
      projects: [],
      projectCount: 0,
    });
    expect(projection.projectGroupViews[1]?.projects.map((project) => project.viewKey)).toEqual([
      "project",
      "other-project",
    ]);
  });

  it("nests subgroups before a group's own projects and counts the whole subtree", () => {
    const projection = buildSidebarProjection(nestedInput());

    expect(projection.projectGroupViews.map(groupViewShape)).toEqual([
      {
        name: "Work",
        projectCount: 3,
        projects: ["a"],
        groups: [
          {
            name: "Clients",
            projectCount: 2,
            projects: ["b"],
            groups: [{ name: "Acme", projectCount: 1, projects: ["c"], groups: [] }],
          },
        ],
      },
      { name: null, projectCount: 1, projects: ["d"], groups: [] },
    ]);
    // Shortcuts number rows in the order they render: deepest subgroup first, Ungrouped last.
    expect(shortcutWorkspaceIds(projection)).toEqual(["c", "b", "a", "d"]);
  });

  it("hides a collapsed group's whole subtree from shortcuts", () => {
    expect(shortcutWorkspaceIds(buildSidebarProjection(nestedInput(["clients"])))).toEqual([
      "a",
      "d",
    ]);
  });

  it("keeps a subgroup's own collapse when its parent reopens", () => {
    // Both collapsed, then the parent opened again: acme stays shut, clients' own row returns.
    expect(shortcutWorkspaceIds(buildSidebarProjection(nestedInput(["acme"])))).toEqual([
      "b",
      "a",
      "d",
    ]);
    expect(shortcutWorkspaceIds(buildSidebarProjection(nestedInput(["clients", "acme"])))).toEqual([
      "a",
      "d",
    ]);
  });

  it("does not number pinned chats while the pinned section is collapsed", () => {
    const projection = buildSidebarProjection(
      projectionInput({ groupMode: "status", pinnedCollapsed: true }),
    );

    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });
});
