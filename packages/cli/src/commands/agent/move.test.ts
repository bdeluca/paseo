import { describe, expect, it } from "vitest";
import type { WorkspaceDescriptorPayload } from "@getpaseo/protocol/messages";
import { resolveWorkspaceId } from "./move.js";

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

describe("resolveWorkspaceId", () => {
  it("takes an exact workspace id over any name", () => {
    expect(resolveWorkspaceId("wsp_alpha", workspaces).id).toBe("wsp_alpha");
  });

  it("takes a unique name regardless of case", () => {
    expect(resolveWorkspaceId("fix the importer", workspaces).id).toBe("wsp_alpha");
  });

  it("names the candidates when a workspace name is shared", () => {
    expect(() => resolveWorkspaceId("Release prep", workspaces)).toThrowError(
      expect.objectContaining({
        code: "AMBIGUOUS_WORKSPACE",
        message: "Workspace name matches 2 workspaces: Release prep",
        details: "wsp_beta, wsp_gamma",
      }),
    );
  });

  it("reports an unknown workspace with a way to list them", () => {
    expect(() => resolveWorkspaceId("wsp_missing", workspaces)).toThrowError(
      expect.objectContaining({
        code: "WORKSPACE_NOT_FOUND",
        message: "Workspace not found: wsp_missing",
        details: 'Use "paseo workspace ls" to list workspaces',
      }),
    );
  });
});
