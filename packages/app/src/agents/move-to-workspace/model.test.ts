import { describe, expect, it } from "vitest";
import {
  buildMoveWorkspaceOptions,
  countCarriedSubagents,
  type CarriedSubagentInput,
  type MoveWorkspaceCandidate,
} from "./model";

function workspace(overrides: Partial<MoveWorkspaceCandidate> = {}): MoveWorkspaceCandidate {
  return {
    id: "ws-1",
    name: "workspace",
    projectDisplayName: "paseo",
    ...overrides,
  };
}

function agent(overrides: Partial<CarriedSubagentInput> = {}): CarriedSubagentInput {
  return { id: "agent", parentAgentId: null, workspaceId: "ws-source", ...overrides };
}

describe("buildMoveWorkspaceOptions", () => {
  it("drops the workspace that already owns the agent", () => {
    const options = buildMoveWorkspaceOptions({
      workspaces: [workspace({ id: "ws-1" }), workspace({ id: "ws-2" })],
      currentWorkspaceId: "ws-1",
    });
    expect(options.map((option) => option.workspaceId)).toEqual(["ws-2"]);
  });

  it("drops a workspace that is being archived, which the daemon would refuse", () => {
    const options = buildMoveWorkspaceOptions({
      workspaces: [workspace({ id: "ws-1", archivingAt: "2026-09-13T00:00:00.000Z" })],
      currentWorkspaceId: null,
    });
    expect(options).toEqual([]);
  });

  it("prefers the workspace title and the project's custom name", () => {
    const options = buildMoveWorkspaceOptions({
      workspaces: [
        workspace({
          id: "ws-1",
          name: "fallback",
          title: "  Fix the importer  ",
          projectDisplayName: "paseo",
          projectCustomName: "Paseo fork",
        }),
      ],
      currentWorkspaceId: null,
    });
    expect(options).toEqual([
      { workspaceId: "ws-1", label: "Fix the importer", projectName: "Paseo fork" },
    ]);
  });

  it("falls back to the workspace name when the title is blank", () => {
    const options = buildMoveWorkspaceOptions({
      workspaces: [workspace({ id: "ws-1", name: "fallback", title: "   " })],
      currentWorkspaceId: null,
    });
    expect(options[0]?.label).toBe("fallback");
  });

  it("orders by project, then by workspace label", () => {
    const options = buildMoveWorkspaceOptions({
      workspaces: [
        workspace({ id: "ws-1", name: "zebra", projectDisplayName: "beta" }),
        workspace({ id: "ws-2", name: "alpha", projectDisplayName: "beta" }),
        workspace({ id: "ws-3", name: "solo", projectDisplayName: "alpha" }),
      ],
      currentWorkspaceId: null,
    });
    expect(options.map((option) => option.workspaceId)).toEqual(["ws-3", "ws-2", "ws-1"]);
  });
});

describe("countCarriedSubagents", () => {
  it("counts every descendant that shares the source workspace", () => {
    const carried = countCarriedSubagents({
      agents: [
        agent({ id: "parent" }),
        agent({ id: "child", parentAgentId: "parent" }),
        agent({ id: "grandchild", parentAgentId: "child" }),
      ],
      agentId: "parent",
      sourceWorkspaceId: "ws-source",
    });
    expect(carried).toBe(2);
  });

  it("leaves out a subagent placed in another workspace, and its descendants", () => {
    const carried = countCarriedSubagents({
      agents: [
        agent({ id: "parent" }),
        agent({ id: "elsewhere", parentAgentId: "parent", workspaceId: "ws-other" }),
        agent({ id: "under-elsewhere", parentAgentId: "elsewhere", workspaceId: "ws-other" }),
      ],
      agentId: "parent",
      sourceWorkspaceId: "ws-source",
    });
    expect(carried).toBe(0);
  });

  it("counts an unstamped subagent, which the daemon cannot call cross-workspace", () => {
    const carried = countCarriedSubagents({
      agents: [
        agent({ id: "parent" }),
        agent({ id: "legacy", parentAgentId: "parent", workspaceId: undefined }),
      ],
      agentId: "parent",
      sourceWorkspaceId: "ws-source",
    });
    expect(carried).toBe(1);
  });

  it("counts nothing for an agent with no subagents", () => {
    expect(
      countCarriedSubagents({
        agents: [agent({ id: "parent" })],
        agentId: "parent",
        sourceWorkspaceId: "ws-source",
      }),
    ).toBe(0);
  });

  it("terminates on a parent-label cycle", () => {
    const carried = countCarriedSubagents({
      agents: [
        agent({ id: "parent", parentAgentId: "child" }),
        agent({ id: "child", parentAgentId: "parent" }),
      ],
      agentId: "parent",
      sourceWorkspaceId: "ws-source",
    });
    expect(carried).toBe(1);
  });
});
