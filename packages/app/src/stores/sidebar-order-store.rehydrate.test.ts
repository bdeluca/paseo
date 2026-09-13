/**
 * The v1 -> v2 rename, exercised through the real persisted store rather than the migration
 * function alone. The function is only half the path: a stored blob also has to survive
 * `createValidatedPersistStorage`'s strict schema before zustand ever calls `migrate`, and the
 * store has to write the migrated shape back under the new key.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const backing = vi.hoisted(() => ({ entries: new Map<string, string>() }));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (name: string) => backing.entries.get(name) ?? null),
    setItem: vi.fn(async (name: string, value: string) => {
      backing.entries.set(name, value);
    }),
    removeItem: vi.fn(async (name: string) => {
      backing.entries.delete(name);
    }),
  },
}));

import { useSidebarOrderStore } from "./sidebar-order-store";

const STORAGE_KEY = "sidebar-project-workspace-order";

/**
 * What the first pass actually wrote: persist version 1, the list under `projectCategories`, and
 * ids minted as `category_<uuid>` (see `createCategoryId` in commit d8ca8a371).
 */
function legacyCategoriesBlob() {
  return JSON.stringify({
    version: 1,
    state: {
      projectOrder: ["paseo", "system", "electricty"],
      pinnedWorkspaceOrder: ["host-a:one"],
      workspaceOrderByProject: { paseo: ["host-a:main", "host-a:feature"] },
      projectCategories: [
        {
          id: "category_11111111-1111-4111-8111-111111111111",
          name: "Products",
          projectViewKeys: ["paseo", "electricty"],
        },
        {
          id: "category_22222222-2222-4222-8222-222222222222",
          name: "Infrastructure",
          projectViewKeys: ["system"],
        },
      ],
    },
  });
}

async function rehydrate() {
  await useSidebarOrderStore.persist.rehydrate();
}

function readPersisted(): { version?: number; state: Record<string, unknown> } {
  const raw = backing.entries.get(STORAGE_KEY);
  if (!raw) throw new Error("nothing persisted");
  return JSON.parse(raw);
}

describe("sidebar order store rehydration", () => {
  beforeEach(() => {
    backing.entries.clear();
    useSidebarOrderStore.setState({
      projectOrder: [],
      pinnedWorkspaceOrder: [],
      workspaceOrderByProject: {},
      projectGroups: [],
    });
  });

  it("carries a real v1 categories blob into project groups without dropping anything else", async () => {
    backing.entries.set(STORAGE_KEY, legacyCategoriesBlob());

    await rehydrate();

    const state = useSidebarOrderStore.getState();
    expect(state.projectOrder).toEqual(["paseo", "system", "electricty"]);
    expect(state.pinnedWorkspaceOrder).toEqual(["host-a:one"]);
    expect(state.workspaceOrderByProject).toEqual({
      paseo: ["host-a:main", "host-a:feature"],
    });
    expect(state.projectGroups).toEqual([
      {
        id: "category_11111111-1111-4111-8111-111111111111",
        name: "Products",
        projectViewKeys: ["paseo", "electricty"],
      },
      {
        id: "category_22222222-2222-4222-8222-222222222222",
        name: "Infrastructure",
        projectViewKeys: ["system"],
      },
    ]);
  });

  it("rewrites the migrated blob under the new key at version 2", async () => {
    backing.entries.set(STORAGE_KEY, legacyCategoriesBlob());

    await rehydrate();
    // Any ordinary write after rehydration is what flushes the new shape to storage.
    useSidebarOrderStore.getState().setProjectOrder(["paseo", "system", "electricty"]);
    await Promise.resolve();

    const persisted = readPersisted();
    expect(persisted.version).toBe(2);
    expect(persisted.state.projectCategories).toBeUndefined();
    expect(persisted.state.projectGroups).toHaveLength(2);
  });

  it("leaves a v2 blob alone", async () => {
    backing.entries.set(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        state: {
          projectOrder: ["paseo"],
          projectGroups: [{ id: "group_a", name: "Products", projectViewKeys: ["paseo"] }],
        },
      }),
    );

    await rehydrate();

    expect(useSidebarOrderStore.getState().projectGroups).toEqual([
      { id: "group_a", name: "Products", projectViewKeys: ["paseo"] },
    ]);
    expect(useSidebarOrderStore.getState().projectOrder).toEqual(["paseo"]);
  });

  it("prefers the new key when a v1 blob somehow carries both", async () => {
    backing.entries.set(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          projectGroups: [{ id: "group_a", name: "Kept", projectViewKeys: ["paseo"] }],
          projectCategories: [{ id: "category_a", name: "Dropped", projectViewKeys: ["system"] }],
        },
      }),
    );

    await rehydrate();

    expect(useSidebarOrderStore.getState().projectGroups).toEqual([
      { id: "group_a", name: "Kept", projectViewKeys: ["paseo"] },
    ]);
  });

  it("keeps a group id nothing renders and a membership key no project answers to", async () => {
    backing.entries.set(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          projectOrder: ["paseo"],
          projectCategories: [
            { id: "category_a", name: "Offline hosts", projectViewKeys: ["gone", "never-existed"] },
          ],
        },
      }),
    );

    await rehydrate();

    expect(useSidebarOrderStore.getState().projectGroups).toEqual([
      { id: "category_a", name: "Offline hosts", projectViewKeys: ["gone", "never-existed"] },
    ]);
  });

  /**
   * The strict persisted schema is all-or-nothing: one bad group discards the whole blob, orders
   * included. That predates project groups — the schema has always been strict — but the rename
   * widened what a bad group can be, so the behaviour is pinned here rather than assumed.
   */
  it("discards the whole blob, orders included, when one persisted group is malformed", async () => {
    backing.entries.set(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          projectOrder: ["paseo", "system"],
          projectCategories: [{ id: "category_a", name: "Products" }],
        },
      }),
    );

    await rehydrate();

    const state = useSidebarOrderStore.getState();
    expect(state.projectGroups).toEqual([]);
    expect(state.projectOrder).toEqual([]);
    expect(backing.entries.has(STORAGE_KEY)).toBe(false);
  });

  it("survives a blob whose groups key is not a list", async () => {
    backing.entries.set(
      STORAGE_KEY,
      JSON.stringify({ version: 1, state: { projectGroups: "Products" } }),
    );

    await rehydrate();

    expect(useSidebarOrderStore.getState().projectGroups).toEqual([]);
  });
});
