import { describe, expect, it } from "vitest";
import {
  findProjectCategoryId,
  moveProjectToCategory,
  normalizeProjectCategories,
  removeProjectCategory,
  renameProjectCategory,
  reorderCategoryProjectViewKeys,
  shiftProjectCategory,
} from "./sidebar-project-categories";

describe("project categories", () => {
  it("normalizes names, ids, and project placement", () => {
    expect(
      normalizeProjectCategories([
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

  it("moves a project between categories and back to Uncategorized", () => {
    const categories = [
      { id: "products", name: "Products", projectViewKeys: ["paseo"] },
      { id: "infra", name: "Infrastructure", projectViewKeys: ["headscale"] },
    ];

    const moved = moveProjectToCategory(categories, "paseo", "infra");
    expect(moved).toEqual([
      { id: "products", name: "Products", projectViewKeys: [] },
      { id: "infra", name: "Infrastructure", projectViewKeys: ["headscale", "paseo"] },
    ]);
    expect(findProjectCategoryId(moved, "paseo")).toBe("infra");

    const uncategorized = moveProjectToCategory(moved, "paseo", null);
    expect(uncategorized[1]?.projectViewKeys).toEqual(["headscale"]);
    expect(findProjectCategoryId(uncategorized, "paseo")).toBeNull();
  });

  it("ignores a move to a category that no longer exists", () => {
    const categories = [{ id: "products", name: "Products", projectViewKeys: ["paseo"] }];

    expect(moveProjectToCategory(categories, "paseo", "deleted")).toEqual(categories);
  });

  it("returns projects to Uncategorized when their category is deleted", () => {
    const categories = [
      { id: "products", name: "Products", projectViewKeys: ["paseo", "relay"] },
      { id: "infra", name: "Infrastructure", projectViewKeys: ["headscale"] },
    ];

    const remaining = removeProjectCategory(categories, "products");
    expect(remaining).toEqual([
      { id: "infra", name: "Infrastructure", projectViewKeys: ["headscale"] },
    ]);
    expect(findProjectCategoryId(remaining, "paseo")).toBeNull();
  });

  it("renames and shifts categories that hold no projects", () => {
    const categories = [
      { id: "products", name: "Products", projectViewKeys: [] },
      { id: "infra", name: "Infrastructure", projectViewKeys: [] },
    ];

    expect(renameProjectCategory(categories, "products", "Research")).toEqual([
      { id: "products", name: "Research", projectViewKeys: [] },
      { id: "infra", name: "Infrastructure", projectViewKeys: [] },
    ]);

    expect(shiftProjectCategory(categories, "infra", -1).map((category) => category.id)).toEqual([
      "infra",
      "products",
    ]);
    expect(shiftProjectCategory(categories, "products", -1).map((category) => category.id)).toEqual(
      ["products", "infra"],
    );
    expect(shiftProjectCategory(categories, "infra", 1).map((category) => category.id)).toEqual([
      "products",
      "infra",
    ]);
  });

  it("ignores project keys a category does not hold when reordering it", () => {
    const categories = [
      { id: "products", name: "Products", projectViewKeys: ["paseo", "relay"] },
      { id: "infra", name: "Infrastructure", projectViewKeys: ["headscale"] },
    ];

    expect(
      reorderCategoryProjectViewKeys(categories, "products", ["relay", "headscale"])[0]
        ?.projectViewKeys,
    ).toEqual(["relay", "paseo"]);
  });
});
