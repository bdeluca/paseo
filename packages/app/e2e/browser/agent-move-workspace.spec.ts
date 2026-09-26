import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { seedWorkspace, type SeedDaemonClient } from "../support/helpers/seed-client";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

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
 * Carries a chat tab onto a sidebar row with real drag events. Playwright's mouse-driven dragTo
 * does not start Chromium's HTML5 drag, which is the machinery a cross-surface drop rides on, so
 * the three events are dispatched with one DataTransfer the way the browser would.
 */
async function dragTabOntoRow(page: Page, tabTestId: string, rowTestId: string) {
  return await page.evaluate(
    ({ tabTestId: tab, rowTestId: row }) => {
      const source = document.querySelector(`[data-testid="${tab}"]`);
      const target = document.querySelector(`[data-testid="${row}"]`);
      if (!source || !target) throw new Error("drag source or drop target missing");
      const dataTransfer = new DataTransfer();
      source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer }));
      source.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
      return Array.from(dataTransfer.types);
    },
    { tabTestId, rowTestId },
  );
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

  test("moves an agent by dragging its tab onto a sidebar workspace row", async ({ page }) => {
    test.setTimeout(180_000);

    const title = `move-drag-${randomUUID().slice(0, 8)}`;
    const session = await seedMockAgentWorkspace({
      repoPrefix: "workspace-drag-source-",
      title,
    });
    let target: Awaited<ReturnType<typeof seedWorkspace>> | null = null;

    try {
      target = await seedWorkspace({ repoPrefix: "workspace-drag-target-" });

      // The sidebar is the drop target, so the shell has to hydrate before the agent route opens.
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openAgentRoute(page, session);

      const tab = page.getByTestId(`workspace-tab-agent_${session.agentId}`);
      await expect(tab).toBeVisible({ timeout: 60_000 });
      const row = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${target.workspaceId}`);
      await expect(row).toBeVisible({ timeout: 30_000 });

      // The chat is carried to the workspace it should belong to; no menu involved.
      const carriedTypes = await dragTabOntoRow(
        page,
        `workspace-tab-agent_${session.agentId}`,
        `sidebar-workspace-row-${getServerId()}:${target.workspaceId}`,
      );
      // The drag has to carry the agent payload, or a passing move below would prove nothing.
      expect(carriedTypes).toContain("application/x-paseo-agent");

      await expect
        .poll(() => fetchAgentWorkspaceId(session.client, session.agentId), { timeout: 30_000 })
        .toBe(target.workspaceId);
    } finally {
      await target?.cleanup();
      await session.cleanup();
    }
  });
});
