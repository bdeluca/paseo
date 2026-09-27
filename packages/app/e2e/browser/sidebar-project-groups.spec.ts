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

/** The only named group on screen; its id is a uuid the client mints, so read it off the DOM. */
async function groupIdFromHeader(page: Page): Promise<string> {
  const testId = await page
    .locator('[data-testid^="sidebar-project-group-kebab-"]')
    .first()
    .getAttribute("data-testid");
  const groupId = testId?.replace("sidebar-project-group-kebab-", "");
  if (!groupId) throw new Error("No project group kebab on screen");
  return groupId;
}

async function openGroupMenu(page: Page, groupId: string) {
  // The kebab is hover-revealed on desktop web, so the heading has to be under the pointer.
  await page.getByTestId(`sidebar-project-group-header-${groupId}`).hover();
  await page.getByTestId(`sidebar-project-group-kebab-${groupId}`).click();
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

  test("renaming keeps the group's projects and deleting returns them to Ungrouped", async ({
    page,
  }) => {
    const grouped = await seedWorkspace({ repoPrefix: "project-groups-c-" });
    const ungrouped = await seedWorkspace({ repoPrefix: "project-groups-d-" });

    try {
      const groupedKey = projectEquivalenceViewKey(grouped.projectKey);
      const ungroupedKey = projectEquivalenceViewKey(ungrouped.projectKey);

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await expect(projectRow(page, groupedKey)).toBeVisible({ timeout: 30_000 });
      await expect(projectRow(page, ungroupedKey)).toBeVisible({ timeout: 30_000 });

      await createGroupFromProject(page, groupedKey, "Products");
      await expect(groupHeader(page, "Products")).toBeVisible({ timeout: 10_000 });
      const groupId = await groupIdFromHeader(page);

      await openGroupMenu(page, groupId);
      await page.getByTestId(`sidebar-project-group-rename-${groupId}`).click();
      const renameDialog = `sidebar-project-group-rename-modal-${groupId}`;
      await renameModalInput(page, renameDialog).fill("Infrastructure");
      await renameModalSubmit(page, renameDialog).click();

      await expect(groupHeader(page, "Infrastructure")).toBeVisible({ timeout: 10_000 });
      await expect(groupHeader(page, "Products")).toHaveCount(0);
      // Renaming is a name change, not a re-bucketing: the project stays where it was.
      await expect(
        page
          .getByTestId(`sidebar-project-group-${groupId}`)
          .getByTestId(`sidebar-project-row-${groupedKey}`),
      ).toBeVisible();

      // Deleting the last group must leave the sidebar in its ungrouped shape, headings and all.
      page.once("dialog", (dialog) => void dialog.accept());
      await openGroupMenu(page, groupId);
      await page.getByTestId(`sidebar-project-group-delete-${groupId}`).click();

      await expect(page.getByTestId("sidebar-project-group-list")).toHaveCount(0, {
        timeout: 10_000,
      });
      // No heading survives the last group, and both projects are back in the plain list.
      await expect(page.locator('[data-testid^="sidebar-project-group-header-"]')).toHaveCount(0);
      await expect(projectRow(page, groupedKey)).toBeVisible();
      await expect(projectRow(page, ungroupedKey)).toBeVisible();

      await page.reload();
      await waitForSidebarHydration(page);
      await expect(projectRow(page, groupedKey)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("sidebar-project-group-list")).toHaveCount(0);
      await expect(page.locator('[data-testid^="sidebar-project-group-header-"]')).toHaveCount(0);
    } finally {
      await grouped.cleanup();
      await ungrouped.cleanup();
    }
  });
});
