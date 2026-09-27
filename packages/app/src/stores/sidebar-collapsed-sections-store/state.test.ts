import { describe, expect, it } from "vitest";
import {
  type CollapsedProjectsState,
  mergePersistedCollapsedProjects,
  serializeCollapsedProjects,
  setProjectCollapsed,
  togglePinnedCollapsed,
  toggleProjectGroupCollapsed,
  toggleProjectCollapsed,
  toggleWorkspaceGroupCollapsed,
} from "@/stores/sidebar-collapsed-sections-store/state";

function emptyState(): CollapsedProjectsState {
  return {
    collapsedProjectKeys: new Set(),
    collapsedWorkspaceGroupKeys: new Set(),
    collapsedProjectGroupKeys: new Set(),
    collapsedPinned: false,
  };
}

describe("sidebar collapsed projects transitions", () => {
  it("tracks collapsed project keys as a Set", () => {
    let state = emptyState();

    state = setProjectCollapsed(state, "project-a", true);
    state = toggleProjectCollapsed(state, "project-b");
    state = toggleProjectCollapsed(state, "project-a");
    state = toggleWorkspaceGroupCollapsed(state, "running");

    expect(Array.from(state.collapsedProjectKeys)).toEqual(["project-b"]);
    expect(Array.from(state.collapsedWorkspaceGroupKeys)).toEqual(["running"]);
  });

  it("serializes collapsed project keys for preference storage", () => {
    const state: CollapsedProjectsState = {
      collapsedProjectKeys: new Set(["project-a", "project-b"]),
      collapsedWorkspaceGroupKeys: new Set(["running"]),
      collapsedProjectGroupKeys: new Set(["group_products"]),
      collapsedPinned: true,
    };

    expect(serializeCollapsedProjects(state)).toEqual({
      collapsedProjectKeys: ["project-a", "project-b"],
      collapsedWorkspaceGroupKeys: ["running"],
      collapsedProjectGroupKeys: ["group_products"],
      collapsedPinned: true,
    });
  });

  it("toggles and restores the pinned section collapse flag", () => {
    const toggled = togglePinnedCollapsed(emptyState());
    expect(toggled.collapsedPinned).toBe(true);

    const restored = mergePersistedCollapsedProjects({ collapsedPinned: true }, emptyState());
    expect(restored.collapsedPinned).toBe(true);
  });

  it("restores collapsed project groups independently from projects", () => {
    const toggled = toggleProjectGroupCollapsed(emptyState(), "group_products");
    expect(Array.from(toggled.collapsedProjectGroupKeys)).toEqual(["group_products"]);
    expect(Array.from(toggled.collapsedProjectKeys)).toEqual([]);

    const restored = mergePersistedCollapsedProjects(
      { collapsedProjectGroupKeys: ["group_products"] },
      emptyState(),
    );
    expect(Array.from(restored.collapsedProjectGroupKeys)).toEqual(["group_products"]);
  });

  it("restores collapse keys written under the old project-category name", () => {
    const restored = mergePersistedCollapsedProjects(
      { collapsedProjectCategoryKeys: ["category_products", "uncategorized"] },
      emptyState(),
    );

    // Group ids carry over untouched; the bucket key is a literal, so it takes the new spelling.
    expect(Array.from(restored.collapsedProjectGroupKeys)).toEqual([
      "category_products",
      "ungrouped",
    ]);
  });

  it("leaves collapsed groups empty for a settings blob written before groups existed", () => {
    const restored = mergePersistedCollapsedProjects(
      { collapsedProjectKeys: ["project-a"], collapsedPinned: true },
      emptyState(),
    );

    expect(Array.from(restored.collapsedProjectGroupKeys)).toEqual([]);
    expect(Array.from(restored.collapsedProjectKeys)).toEqual(["project-a"]);
  });

  it("rejects the complete value when a persisted project key is invalid", () => {
    const restored = mergePersistedCollapsedProjects(
      { collapsedProjectKeys: ["project-a", "project-b", 42] },
      emptyState(),
    );

    expect(Array.from(restored.collapsedProjectKeys)).toEqual([]);
    expect(Array.from(restored.collapsedWorkspaceGroupKeys)).toEqual([]);
  });

  it("keeps the existing state object when persisted preferences do not change collapsed keys", () => {
    const currentState = emptyState();

    expect(mergePersistedCollapsedProjects(undefined, currentState)).toBe(currentState);
    expect(mergePersistedCollapsedProjects({}, currentState)).toBe(currentState);
    expect(mergePersistedCollapsedProjects({ collapsedProjectKeys: [] }, currentState)).toBe(
      currentState,
    );
  });
});
