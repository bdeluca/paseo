/**
 * The v1 -> v2 rename and the v2 -> v3 move to nested groups, exercised through the real
 * persisted store rather than the migration function alone. The function is only half the path:
 * a stored blob also has to survive `createValidatedPersistStorage`'s strict schema before zustand
 * ever calls `migrate`, and the store has to write the migrated shape back.
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

/**
 * What the flat project-group build (`c6c780344`) writes for a sidebar with three groups: persist
 * version 2, `group_<uuid>` ids, no `parentId`, one group holding nothing, and a project
 * (`electricty`) left in Ungrouped. The keys are the shapes on the live install's projects and
 * workspaces.
 */
function flatV2Blob() {
  return JSON.stringify({
    version: 2,
    state: {
      projectOrder: [
        "host:srv_YCMtpwqBasnf:/home/bdeluca/src/paseo",
        "host:srv_YCMtpwqBasnf:/home/bdeluca/system",
        "host:srv_YCMtpwqBasnf:/home/bdeluca/src/electricty",
        "host:srv_YCMtpwqBasnf:/home/bdeluca/src/blackprint-local",
        "remote:github.com/hydralab-cph/vortexweb",
      ],
      pinnedWorkspaceOrder: ["srv_YCMtpwqBasnf:wks_a2cac9ccde517c67"],
      workspaceOrderByProject: {
        "host:srv_YCMtpwqBasnf:/home/bdeluca/src/paseo": [
          "srv_YCMtpwqBasnf:wks_a2cac9ccde517c67",
          "srv_YCMtpwqBasnf:wks_eadb666f02c67a94",
        ],
      },
      projectGroups: [
        {
          id: "group_3f1c2b7e-0d7a-4c52-9a0e-6b1f7f9e2d11",
          name: "Paseo",
          projectViewKeys: [
            "host:srv_YCMtpwqBasnf:/home/bdeluca/src/paseo",
            "host:srv_YCMtpwqBasnf:/home/bdeluca/system",
          ],
        },
        {
          id: "group_8a6d4e21-5b3c-4f9e-8d27-1c0b9a7e6f55",
          name: "Vortex",
          projectViewKeys: [
            "remote:github.com/hydralab-cph/vortexweb",
            "host:srv_YCMtpwqBasnf:/home/bdeluca/src/blackprint-local",
          ],
        },
        {
          id: "group_c0ffee00-1234-4abc-8def-000000000001",
          name: "Empty for now",
          projectViewKeys: [],
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
        parentId: null,
        projectViewKeys: ["paseo", "electricty"],
      },
      {
        id: "category_22222222-2222-4222-8222-222222222222",
        name: "Infrastructure",
        parentId: null,
        projectViewKeys: ["system"],
      },
    ]);
  });

  it("rewrites the migrated blob under the new key at the current version", async () => {
    backing.entries.set(STORAGE_KEY, legacyCategoriesBlob());

    await rehydrate();
    // Any ordinary write after rehydration is what flushes the new shape to storage.
    useSidebarOrderStore.getState().setProjectOrder(["paseo", "system", "electricty"]);
    await Promise.resolve();

    const persisted = readPersisted();
    expect(persisted.version).toBe(3);
    expect(persisted.state.projectCategories).toBeUndefined();
    expect(persisted.state.projectGroups).toHaveLength(2);
  });

  it("loads every flat v2 group as a top-level group and drops nothing", async () => {
    backing.entries.set(STORAGE_KEY, flatV2Blob());

    await rehydrate();

    const state = useSidebarOrderStore.getState();
    expect(state.projectOrder).toEqual([
      "host:srv_YCMtpwqBasnf:/home/bdeluca/src/paseo",
      "host:srv_YCMtpwqBasnf:/home/bdeluca/system",
      "host:srv_YCMtpwqBasnf:/home/bdeluca/src/electricty",
      "host:srv_YCMtpwqBasnf:/home/bdeluca/src/blackprint-local",
      "remote:github.com/hydralab-cph/vortexweb",
    ]);
    expect(state.pinnedWorkspaceOrder).toEqual(["srv_YCMtpwqBasnf:wks_a2cac9ccde517c67"]);
    expect(state.workspaceOrderByProject).toEqual({
      "host:srv_YCMtpwqBasnf:/home/bdeluca/src/paseo": [
        "srv_YCMtpwqBasnf:wks_a2cac9ccde517c67",
        "srv_YCMtpwqBasnf:wks_eadb666f02c67a94",
      ],
    });
    expect(state.projectGroups).toEqual([
      {
        id: "group_3f1c2b7e-0d7a-4c52-9a0e-6b1f7f9e2d11",
        name: "Paseo",
        parentId: null,
        projectViewKeys: [
          "host:srv_YCMtpwqBasnf:/home/bdeluca/src/paseo",
          "host:srv_YCMtpwqBasnf:/home/bdeluca/system",
        ],
      },
      {
        id: "group_8a6d4e21-5b3c-4f9e-8d27-1c0b9a7e6f55",
        name: "Vortex",
        parentId: null,
        projectViewKeys: [
          "remote:github.com/hydralab-cph/vortexweb",
          "host:srv_YCMtpwqBasnf:/home/bdeluca/src/blackprint-local",
        ],
      },
      {
        id: "group_c0ffee00-1234-4abc-8def-000000000001",
        name: "Empty for now",
        parentId: null,
        projectViewKeys: [],
      },
    ]);
  });

  it("writes a flat sidebar back in the flat build's exact group shape", async () => {
    backing.entries.set(STORAGE_KEY, flatV2Blob());

    await rehydrate();
    useSidebarOrderStore.getState().setProjectOrder(useSidebarOrderStore.getState().projectOrder);
    await Promise.resolve();

    const persisted = readPersisted();
    expect(persisted.version).toBe(3);
    // No `parentId: null` on a top-level group: the flat build's strict schema would reject the
    // whole blob, orders included, over a key it does not know.
    expect(persisted.state.projectGroups).toEqual(JSON.parse(flatV2Blob()).state.projectGroups);
  });

  it("round-trips a nested tree through storage", async () => {
    backing.entries.set(STORAGE_KEY, flatV2Blob());
    await rehydrate();
    const store = useSidebarOrderStore.getState();
    const paseoId = "group_3f1c2b7e-0d7a-4c52-9a0e-6b1f7f9e2d11";
    const vortexId = "group_8a6d4e21-5b3c-4f9e-8d27-1c0b9a7e6f55";
    store.moveProjectGroup(vortexId, paseoId);
    const toolsId = store.createProjectGroup("Tools", vortexId);
    if (!toolsId) throw new Error("Tools was not created");
    store.moveProjectToGroup("host:srv_YCMtpwqBasnf:/home/bdeluca/src/electricty", toolsId);
    await Promise.resolve();
    const written = useSidebarOrderStore.getState().projectGroups;
    const stored = backing.entries.get(STORAGE_KEY);
    if (!stored) throw new Error("nothing persisted");

    // Clearing the store persists the clear, so put the written blob back before reading it.
    useSidebarOrderStore.setState({ projectGroups: [] });
    backing.entries.set(STORAGE_KEY, stored);
    await rehydrate();

    expect(useSidebarOrderStore.getState().projectGroups).toEqual(written);
    expect(
      useSidebarOrderStore
        .getState()
        .projectGroups.map((group) => [group.name, group.parentId, group.projectViewKeys.length]),
    ).toEqual([
      ["Paseo", null, 2],
      ["Empty for now", null, 0],
      ["Vortex", paseoId, 2],
      ["Tools", vortexId, 1],
    ]);
  });

  it("lifts a stored group whose parent is gone to the top level", async () => {
    backing.entries.set(
      STORAGE_KEY,
      JSON.stringify({
        version: 3,
        state: {
          projectGroups: [
            { id: "group_a", name: "Kept", parentId: "group_deleted", projectViewKeys: ["paseo"] },
          ],
        },
      }),
    );

    await rehydrate();

    expect(useSidebarOrderStore.getState().projectGroups).toEqual([
      { id: "group_a", name: "Kept", parentId: null, projectViewKeys: ["paseo"] },
    ]);
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
      { id: "group_a", name: "Kept", parentId: null, projectViewKeys: ["paseo"] },
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
      {
        id: "category_a",
        name: "Offline hosts",
        parentId: null,
        projectViewKeys: ["gone", "never-existed"],
      },
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
