import { randomUUID } from "node:crypto";
import { test, expect } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { seedWorkspace, type SeedDaemonClient } from "../support/helpers/seed-client";

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";

async function fetchAgentWorkspaceId(
  client: SeedDaemonClient,
  agentId: string,
): Promise<string | undefined> {
  const result = await client.fetchAgents({ scope: "active" });
  return result.entries.find((entry) => entry.agent.id === agentId)?.agent.workspaceId;
}

/**
 * The tab menu's "Move to workspace…" path end to end: the item opens the picker,
 * the picker discloses the subagents the move will carry, and choosing a target
 * reassigns the agent and its subagent in the daemon.
 */
test.describe("Move agent to another workspace", () => {
  test("moves an agent and its subagent from the tab menu", async ({ page }) => {
    test.setTimeout(180_000);

    await page.setViewportSize(MOBILE_VIEWPORT);
    const title = `move-agent-${randomUUID().slice(0, 8)}`;
    const session = await seedMockAgentWorkspace({
      repoPrefix: "workspace-move-source-",
      title,
    });
    let target: Awaited<ReturnType<typeof seedWorkspace>> | null = null;

    try {
      target = await seedWorkspace({ repoPrefix: "workspace-move-target-" });
      const child = await session.client.createAgent({
        provider: "mock",
        cwd: session.cwd,
        workspaceId: session.workspaceId,
        title: `${title}-child`,
        modeId: "load-test",
        model: "e2e-fast-stream",
        labels: { [PARENT_AGENT_ID_LABEL]: session.agentId },
      });

      await openAgentRoute(page, session);
      await expect(page.getByTestId("workspace-tab-switcher-trigger")).toBeVisible({
        timeout: 60_000,
      });

      await page.getByRole("button", { name: /Switch tabs/ }).click();
      await expect(page.getByRole("button", { name: "Bottom sheet backdrop" }).first()).toBeVisible(
        {
          timeout: 15_000,
        },
      );

      const menuBase = `workspace-tab-menu-agent_${session.agentId}`;
      const actionsTrigger = page.getByTestId(`${menuBase}-trigger`);
      await expect(actionsTrigger).toBeVisible({ timeout: 20_000 });
      await actionsTrigger.click();

      const moveItem = page.getByTestId(`${menuBase}-move-to-workspace`);
      await expect(moveItem).toBeVisible({ timeout: 15_000 });
      await moveItem.click();

      const sheet = page.getByTestId("move-to-workspace-sheet");
      await expect(sheet).toBeVisible({ timeout: 15_000 });
      // Disclosure before the choice: the one subagent that shares the workspace.
      await expect(sheet).toContainText("1 subagent", { timeout: 15_000 });

      const option = page.getByTestId(`move-to-workspace-option-${target.workspaceId}`);
      await expect(option).toBeVisible({ timeout: 15_000 });
      await option.click();

      await expect
        .poll(() => fetchAgentWorkspaceId(session.client, session.agentId), { timeout: 30_000 })
        .toBe(target.workspaceId);
      await expect
        .poll(() => fetchAgentWorkspaceId(session.client, child.id), { timeout: 30_000 })
        .toBe(target.workspaceId);
      await expect(page.getByTestId("move-to-workspace-sheet")).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await target?.cleanup();
      await session.cleanup();
    }
  });
});
