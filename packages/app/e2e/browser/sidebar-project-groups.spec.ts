import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { projectEquivalenceViewKey } from "../support/helpers/project-view-key";
import { renameModalInput, renameModalSubmit } from "../support/helpers/rename";
import { seedWorkspace } from "../support/helpers/seed-client";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

function projectRow(page: Page, projectViewKey: string) {
  return page.getByTestId(`sidebar-project-row-${projectViewKey}`);
}

function groupHeader(page: Page, name: string) {
  return page
    .locator('[data-testid^="sidebar-project-group-header-"]')
    .filter({ hasText: name })
    .first();
}

async function createGroupFromProject(page: Page, projectViewKey: string, name: string) {
  await projectRow(page, projectViewKey).hover();
  const kebab = page.getByTestId(`sidebar-project-kebab-${projectViewKey}`);
  await expect(kebab).toBeVisible({ timeout: 10_000 });
  await kebab.click();

  await page.getByTestId(`sidebar-project-menu-group-${projectViewKey}`).click();
  await page.getByTestId(`sidebar-project-menu-new-group-${projectViewKey}`).click();

  const dialog = `sidebar-project-group-new-modal-${projectViewKey}`;
  await renameModalInput(page, dialog).fill(name);
  await renameModalSubmit(page, dialog).click();
}

// Groups are a client-side arrangement of the project rows: the daemon never hears about
// them, so everything here is asserted through what the sidebar draws and what survives a reload.
test.describe("Sidebar project groups", () => {
  test("a group collects its project, keeps the rest ungrouped, and collapses", async ({
    page,
  }) => {
    const grouped = await seedWorkspace({ repoPrefix: "project-groups-a-" });
    const ungrouped = await seedWorkspace({ repoPrefix: "project-groups-b-" });

    try {
      const groupedKey = projectEquivalenceViewKey(grouped.projectKey);
      const ungroupedKey = projectEquivalenceViewKey(ungrouped.projectKey);

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await expect(projectRow(page, groupedKey)).toBeVisible({ timeout: 30_000 });
      await expect(projectRow(page, ungroupedKey)).toBeVisible({ timeout: 30_000 });
      // Nothing is grouped yet, so the list carries no headings at all.
      await expect(page.getByTestId("sidebar-project-group-list")).toHaveCount(0);

      await createGroupFromProject(page, groupedKey, "Products");

      await expect(groupHeader(page, "Products")).toBeVisible({ timeout: 10_000 });
      const ungroupedBlock = page.getByTestId("sidebar-project-group-ungrouped");
      await expect(ungroupedBlock.getByTestId(`sidebar-project-row-${ungroupedKey}`)).toBeVisible();
      await expect(ungroupedBlock.getByTestId(`sidebar-project-row-${groupedKey}`)).toHaveCount(0);
      await expect(projectRow(page, groupedKey)).toBeVisible();

      await groupHeader(page, "Products").click();
      await expect(projectRow(page, groupedKey)).toHaveCount(0, { timeout: 10_000 });
      await expect(projectRow(page, ungroupedKey)).toBeVisible();

      // The group and its collapse are device-local preferences, so both survive a reload.
      await page.reload();
      await waitForSidebarHydration(page);
      await expect(groupHeader(page, "Products")).toBeVisible({ timeout: 30_000 });
      await expect(projectRow(page, groupedKey)).toHaveCount(0);

      await groupHeader(page, "Products").click();
      await expect(projectRow(page, groupedKey)).toBeVisible({ timeout: 10_000 });
    } finally {
      await grouped.cleanup();
      await ungrouped.cleanup();
    }
  });
});
