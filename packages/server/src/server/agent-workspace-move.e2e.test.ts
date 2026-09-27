import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DaemonClient } from "./test-utils/index.js";
import { createTestPaseoDaemon } from "./test-utils/paseo-daemon.js";
import { getFullAccessConfig } from "./daemon-e2e/agent-configs.js";

// The move contract against a real daemon: ownership is the only thing that
// changes, the subagent tree that shared the source workspace comes along, and a
// subagent placed in a third workspace is left where it was put.

async function mintLocalWorkspace(client: DaemonClient, cwd: string): Promise<string> {
  const result = await client.createWorkspace({ source: { kind: "directory", path: cwd } });
  if (!result.workspace) {
    throw new Error(result.error ?? "Failed to create workspace");
  }
  return result.workspace.id;
}

async function workspaceIdOf(client: DaemonClient, agentId: string): Promise<string | undefined> {
  const fetched = await client.fetchAgent({ agentId });
  return fetched?.agent.workspaceId;
}

test("moving an agent carries its same-workspace subagents and keeps every cwd", async () => {
  const daemon = await createTestPaseoDaemon();
  const sourceCwd = mkdtempSync(path.join(tmpdir(), "paseo-move-source-"));
  const targetCwd = mkdtempSync(path.join(tmpdir(), "paseo-move-target-"));
  const otherCwd = mkdtempSync(path.join(tmpdir(), "paseo-move-other-"));
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.1.82",
  });

  try {
    await client.connect();
    await client.fetchAgents({ subscribe: {} });

    const sourceWorkspaceId = await mintLocalWorkspace(client, sourceCwd);
    const targetWorkspaceId = await mintLocalWorkspace(client, targetCwd);
    const otherWorkspaceId = await mintLocalWorkspace(client, otherCwd);

    const parent = await client.createAgent({
      ...getFullAccessConfig("codex"),
      cwd: sourceCwd,
      workspaceId: sourceWorkspaceId,
      title: "Parent",
    });
    const child = await client.createAgent({
      ...getFullAccessConfig("codex"),
      cwd: sourceCwd,
      callerAgentId: parent.id,
      title: "Child",
    });
    const grandchild = await client.createAgent({
      ...getFullAccessConfig("codex"),
      cwd: sourceCwd,
      callerAgentId: child.id,
      title: "Grandchild",
    });
    const elsewhere = await client.createAgent({
      ...getFullAccessConfig("codex"),
      cwd: otherCwd,
      workspaceId: otherWorkspaceId,
      callerAgentId: parent.id,
      title: "Elsewhere",
    });

    const result = await client.moveAgentToWorkspace(parent.id, targetWorkspaceId);

    expect(result.previousWorkspaceId).toBe(sourceWorkspaceId);
    expect(new Set(result.movedAgentIds)).toEqual(new Set([parent.id, child.id, grandchild.id]));

    expect(await workspaceIdOf(client, parent.id)).toBe(targetWorkspaceId);
    expect(await workspaceIdOf(client, child.id)).toBe(targetWorkspaceId);
    expect(await workspaceIdOf(client, grandchild.id)).toBe(targetWorkspaceId);
    expect(await workspaceIdOf(client, elsewhere.id)).toBe(otherWorkspaceId);

    // Ownership moved; the agents still run where they always did.
    const movedParent = await client.fetchAgent({ agentId: parent.id });
    expect(movedParent?.agent.cwd).toBe(sourceCwd);
    expect(movedParent?.agent.id).toBe(parent.id);

    await expect(client.moveAgentToWorkspace(parent.id, "wks_missing")).rejects.toThrow(
      "Workspace not found: wks_missing",
    );
    expect(await workspaceIdOf(client, parent.id)).toBe(targetWorkspaceId);
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
    rmSync(sourceCwd, { recursive: true, force: true });
    rmSync(targetCwd, { recursive: true, force: true });
    rmSync(otherCwd, { recursive: true, force: true });
  }
}, 180000);
