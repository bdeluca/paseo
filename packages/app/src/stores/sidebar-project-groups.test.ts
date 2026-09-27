import { describe, expect, it } from "vitest";
import {
  findProjectGroupId,
  moveProjectToGroup,
  normalizeProjectGroups,
  removeProjectGroup,
  renameProjectGroup,
  reorderGroupProjectViewKeys,
  shiftProjectGroup,
} from "./sidebar-project-groups";

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
      { id: "products", name: "Products", projectViewKeys: ["paseo"] },
      { id: "infra", name: "Infrastructure", projectViewKeys: ["headscale"] },
    ]);
  });

  it("moves a project between groups and back to Ungrouped", () => {
    const groups = [
      { id: "products", name: "Products", projectViewKeys: ["paseo"] },
      { id: "infra", name: "Infrastructure", projectViewKeys: ["headscale"] },
    ];

    const moved = moveProjectToGroup(groups, "paseo", "infra");
    expect(moved).toEqual([
      { id: "products", name: "Products", projectViewKeys: [] },
      { id: "infra", name: "Infrastructure", projectViewKeys: ["headscale", "paseo"] },
    ]);
    expect(findProjectGroupId(moved, "paseo")).toBe("infra");

    const ungrouped = moveProjectToGroup(moved, "paseo", null);
    expect(ungrouped[1]?.projectViewKeys).toEqual(["headscale"]);
    expect(findProjectGroupId(ungrouped, "paseo")).toBeNull();
  });

  it("ignores a move to a group that no longer exists", () => {
    const groups = [{ id: "products", name: "Products", projectViewKeys: ["paseo"] }];

    expect(moveProjectToGroup(groups, "paseo", "deleted")).toEqual(groups);
  });

  it("returns projects to Ungrouped when their group is deleted", () => {
    const groups = [
      { id: "products", name: "Products", projectViewKeys: ["paseo", "relay"] },
      { id: "infra", name: "Infrastructure", projectViewKeys: ["headscale"] },
    ];

    const remaining = removeProjectGroup(groups, "products");
    expect(remaining).toEqual([
      { id: "infra", name: "Infrastructure", projectViewKeys: ["headscale"] },
    ]);
    expect(findProjectGroupId(remaining, "paseo")).toBeNull();
  });

  it("renames and shifts groups that hold no projects", () => {
    const groups = [
      { id: "products", name: "Products", projectViewKeys: [] },
      { id: "infra", name: "Infrastructure", projectViewKeys: [] },
    ];

    expect(renameProjectGroup(groups, "products", "Research")).toEqual([
      { id: "products", name: "Research", projectViewKeys: [] },
      { id: "infra", name: "Infrastructure", projectViewKeys: [] },
    ]);

    expect(shiftProjectGroup(groups, "infra", -1).map((group) => group.id)).toEqual([
      "infra",
      "products",
    ]);
    expect(shiftProjectGroup(groups, "products", -1).map((group) => group.id)).toEqual([
      "products",
      "infra",
    ]);
    expect(shiftProjectGroup(groups, "infra", 1).map((group) => group.id)).toEqual([
      "products",
      "infra",
    ]);
  });

  it("ignores project keys a group does not hold when reordering it", () => {
    const groups = [
      { id: "products", name: "Products", projectViewKeys: ["paseo", "relay"] },
      { id: "infra", name: "Infrastructure", projectViewKeys: ["headscale"] },
    ];

    expect(
      reorderGroupProjectViewKeys(groups, "products", ["relay", "headscale"])[0]?.projectViewKeys,
    ).toEqual(["relay", "paseo"]);
  });
});
