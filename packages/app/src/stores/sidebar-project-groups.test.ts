import { describe, expect, it } from "vitest";
import {
  addProjectGroup,
  canCreateProjectGroupIn,
  canMoveProjectGroup,
  findProjectGroupId,
  flattenProjectGroupTree,
  MAX_PROJECT_GROUP_DEPTH,
  moveProjectGroup,
  moveProjectToGroup,
  normalizeProjectGroups,
  projectGroupLevel,
  removeProjectGroup,
  renameProjectGroup,
  reorderGroupProjectViewKeys,
  shiftProjectGroup,
  type SidebarProjectGroup,
} from "./sidebar-project-groups";

function group(
  id: string,
  parentId: string | null = null,
  projectViewKeys: string[] = [],
): SidebarProjectGroup {
  return { id, name: id, parentId, projectViewKeys };
}

/**
 * work
 *   clients
 *     acme      [acme-web]
 *   internal    [tools]
 * personal      [dotfiles]
 */
function workTree(): SidebarProjectGroup[] {
  return [
    group("work"),
    group("clients", "work"),
    group("acme", "clients", ["acme-web"]),
    group("internal", "work", ["tools"]),
    group("personal", null, ["dotfiles"]),
  ];
}

function treeShape(groups: readonly SidebarProjectGroup[]): string[] {
  return flattenProjectGroupTree(groups).map(
    (entry) => `${"  ".repeat(entry.depth)}${entry.group.id}`,
  );
}

describe("project groups", () => {
  it("normalizes names, ids, and project placement", () => {
    expect(
      normalizeProjectGroups([
        { id: " products ", name: " Products ", projectViewKeys: ["paseo", "paseo", ""] },
        { id: "infra", name: "Infrastructure", projectViewKeys: ["paseo", "headscale"] },
        { id: "infra", name: "Duplicate", projectViewKeys: ["ignored"] },
        { id: "unnamed", name: "  ", projectViewKeys: ["dropped"] },
      ]),
    ).toEqual([
      { id: "products", name: "Products", parentId: null, projectViewKeys: ["paseo"] },
      { id: "infra", name: "Infrastructure", parentId: null, projectViewKeys: ["headscale"] },
    ]);
  });

  it("loads a flat group written before nesting as a top-level group", () => {
    expect(
      normalizeProjectGroups([{ id: "products", name: "Products", projectViewKeys: ["paseo"] }]),
    ).toEqual([{ id: "products", name: "Products", parentId: null, projectViewKeys: ["paseo"] }]);
  });

  it("lifts a group whose parent is gone or loops back to the top level", () => {
    const normalized = normalizeProjectGroups([
      group("a", "b"),
      group("b", "a"),
      group("self", "self"),
      group("orphan", "deleted"),
      group("child", "a"),
    ]);

    expect(normalized.map((entry) => [entry.id, entry.parentId])).toEqual([
      ["a", null],
      ["b", "a"],
      ["self", null],
      ["orphan", null],
      ["child", "a"],
    ]);
    expect(treeShape(normalized)).toEqual(["a", "  b", "  child", "self", "orphan"]);
  });

  it("walks the tree parent first, siblings in list order", () => {
    expect(treeShape(workTree())).toEqual([
      "work",
      "  clients",
      "    acme",
      "  internal",
      "personal",
    ]);
    expect(projectGroupLevel(workTree(), "acme")).toBe(3);
    expect(projectGroupLevel(workTree(), "work")).toBe(1);
    expect(projectGroupLevel(workTree(), "missing")).toBe(0);
  });

  it("moves a group with its subtree to the end of another group's subgroups", () => {
    const moved = moveProjectGroup(workTree(), "clients", "personal");

    expect(treeShape(moved)).toEqual(["work", "  internal", "personal", "  clients", "    acme"]);
    // The projects travel with the group that holds them.
    expect(findProjectGroupId(moved, "acme-web")).toBe("acme");
  });

  it("moves a group to the top level", () => {
    expect(treeShape(moveProjectGroup(workTree(), "acme", null))).toEqual([
      "work",
      "  clients",
      "  internal",
      "personal",
      "acme",
    ]);
  });

  it("never moves a group into itself or anything beneath it", () => {
    const groups = workTree();

    expect(canMoveProjectGroup(groups, "work", "work")).toBe(false);
    expect(canMoveProjectGroup(groups, "work", "clients")).toBe(false);
    expect(canMoveProjectGroup(groups, "work", "acme")).toBe(false);
    expect(moveProjectGroup(groups, "work", "work")).toEqual(groups);
    expect(moveProjectGroup(groups, "work", "acme")).toEqual(groups);
    expect(moveProjectGroup(groups, "clients", "acme")).toEqual(groups);
    expect(moveProjectGroup(groups, "acme", "acme")).toEqual(groups);
  });

  it("refuses a move to a group that does not exist", () => {
    const groups = workTree();

    expect(moveProjectGroup(groups, "personal", "deleted")).toEqual(groups);
    expect(moveProjectGroup(groups, "deleted", "personal")).toEqual(groups);
  });

  it(`caps nesting at ${MAX_PROJECT_GROUP_DEPTH} levels, subtree included`, () => {
    const groups = [...workTree(), group("deepest", "acme")];

    // acme is level 3, deepest is level 4: nothing more fits under it.
    expect(canCreateProjectGroupIn(groups, "acme")).toBe(true);
    expect(canCreateProjectGroupIn(groups, "deepest")).toBe(false);
    expect(addProjectGroup(groups, group("too-deep", "deepest"))).toEqual(groups);
    // clients carries two levels below it, so it fits under a top-level group but not under a
    // level-2 one.
    expect(canMoveProjectGroup(groups, "clients", "personal")).toBe(true);
    expect(canMoveProjectGroup(groups, "clients", "internal")).toBe(false);
    expect(moveProjectGroup(groups, "clients", "internal")).toEqual(groups);
  });

  it("adds a group as the last subgroup of its parent", () => {
    expect(treeShape(addProjectGroup(workTree(), group("new", "work")))).toEqual([
      "work",
      "  clients",
      "    acme",
      "  internal",
      "  new",
      "personal",
    ]);
  });

  it("refuses to create a group inside a group that does not exist", () => {
    expect(canCreateProjectGroupIn(workTree(), "deleted")).toBe(false);
  });

  it("moves a project between groups and back to Ungrouped", () => {
    const groups = [group("products", null, ["paseo"]), group("infra", "products", ["headscale"])];

    const moved = moveProjectToGroup(groups, "paseo", "infra");
    expect(moved).toEqual([
      group("products", null, []),
      group("infra", "products", ["headscale", "paseo"]),
    ]);
    expect(findProjectGroupId(moved, "paseo")).toBe("infra");

    const ungrouped = moveProjectToGroup(moved, "paseo", null);
    expect(ungrouped[1]?.projectViewKeys).toEqual(["headscale"]);
    expect(findProjectGroupId(ungrouped, "paseo")).toBeNull();
  });

  it("ignores a move to a group that no longer exists", () => {
    const groups = [group("products", null, ["paseo"])];

    expect(moveProjectToGroup(groups, "paseo", "deleted")).toEqual(groups);
  });

  it("returns a top-level group's projects to Ungrouped and its subgroups to the top level", () => {
    const remaining = removeProjectGroup(workTree(), "work");

    expect(treeShape(remaining)).toEqual(["clients", "  acme", "internal", "personal"]);
    expect(findProjectGroupId(remaining, "tools")).toBe("internal");
    expect(findProjectGroupId(remaining, "acme-web")).toBe("acme");
  });

  it("hands a nested group's projects and subgroups to its parent, in its place", () => {
    const groups = [...workTree().slice(0, 3), group("partners", "clients", ["partner-api"])];
    const withProjects = moveProjectToGroup(groups, "clients-site", "clients");

    const remaining = removeProjectGroup(withProjects, "clients");

    expect(treeShape(remaining)).toEqual(["work", "  acme", "  partners"]);
    expect(remaining.find((entry) => entry.id === "work")?.projectViewKeys).toEqual([
      "clients-site",
    ]);
    expect(findProjectGroupId(remaining, "partner-api")).toBe("partners");
  });

  it("shifts a group among its siblings only", () => {
    const groups = workTree();

    expect(treeShape(shiftProjectGroup(groups, "internal", -1))).toEqual([
      "work",
      "  internal",
      "  clients",
      "    acme",
      "personal",
    ]);
    expect(treeShape(shiftProjectGroup(groups, "personal", -1))).toEqual([
      "personal",
      "work",
      "  clients",
      "    acme",
      "  internal",
    ]);
    // First and last among siblings stay put, whatever else sits around them in the list.
    expect(shiftProjectGroup(groups, "clients", -1)).toEqual(groups);
    expect(shiftProjectGroup(groups, "internal", 1)).toEqual(groups);
    expect(shiftProjectGroup(groups, "acme", 1)).toEqual(groups);
  });

  it("renames a group without moving it", () => {
    expect(renameProjectGroup(workTree(), "clients", "Customers")[1]).toEqual({
      id: "clients",
      name: "Customers",
      parentId: "work",
      projectViewKeys: [],
    });
  });

  it("ignores project keys a group does not hold when reordering it", () => {
    const groups = [
      group("products", null, ["paseo", "relay"]),
      group("infra", null, ["headscale"]),
    ];

    expect(
      reorderGroupProjectViewKeys(groups, "products", ["relay", "headscale"])[0]?.projectViewKeys,
    ).toEqual(["relay", "paseo"]);
  });
});
