import { describe, expect, it } from "vitest";
import type { WorkspaceDescriptorPayload } from "@getpaseo/protocol/messages";
import { resolveMoveTargets, resolveWorkspace } from "./move.js";

function workspace(
  id: string,
  name: string,
): Pick<WorkspaceDescriptorPayload, "id" | "name"> & Partial<WorkspaceDescriptorPayload> {
  return { id, name };
}

const workspaces = [
  workspace("wsp_alpha", "Fix the importer"),
  workspace("wsp_beta", "Release prep"),
  workspace("wsp_gamma", "Release prep"),
] as WorkspaceDescriptorPayload[];

describe("resolveWorkspace", () => {
  it("takes an exact workspace id over any name", () => {
    expect(resolveWorkspace("wsp_alpha", workspaces).id).toBe("wsp_alpha");
  });

  it("takes a unique name regardless of case", () => {
    expect(resolveWorkspace("fix the importer", workspaces).id).toBe("wsp_alpha");
  });

  it("names the candidates when a workspace name is shared", () => {
    expect(() => resolveWorkspace("Release prep", workspaces)).toThrowError(
      expect.objectContaining({
        code: "AMBIGUOUS_WORKSPACE",
        message: "Workspace name matches 2 workspaces: Release prep",
        details: "Use one of these IDs: wsp_beta, wsp_gamma",
      }),
    );
  });

  it("reports an unknown workspace with a way to list them", () => {
    expect(() => resolveWorkspace("wsp_missing", workspaces)).toThrowError(
      expect.objectContaining({
        code: "WORKSPACE_NOT_FOUND",
        message: "Workspace not found: wsp_missing",
        details: 'Use "paseo workspace ls" to list workspaces',
      }),
    );
  });
});

describe("resolveMoveTargets", () => {
  const agents = [
    { id: "aaaa1111", title: "Importer" },
    { id: "bbbb2222", title: "Release" },
  ];

  it("resolves every argument by prefix before any agent is moved", () => {
    expect(resolveMoveTargets(["aaaa", "bbbb"], agents)).toEqual(["aaaa1111", "bbbb2222"]);
  });

  it("collapses an agent named twice into one move", () => {
    expect(resolveMoveTargets(["aaaa", "Importer"], agents)).toEqual(["aaaa1111"]);
  });

  it("rejects the whole batch when one argument matches nothing", () => {
    expect(() => resolveMoveTargets(["aaaa", "nope"], agents)).toThrowError(
      expect.objectContaining({
        code: "AGENT_NOT_FOUND",
        message: "Agent not found: nope",
      }),
    );
  });
});
