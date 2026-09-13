import { test, expect, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { projectEquivalenceViewKey } from "../support/helpers/project-view-key";
import { renameModalInput, renameModalSubmit } from "../support/helpers/rename";
import { seedWorkspace } from "../support/helpers/seed-client";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

function projectRow(page: Page, projectViewKey: string) {
  return page.getByTestId(`sidebar-project-row-${projectViewKey}`);
}

function categoryHeader(page: Page, name: string) {
  return page
    .locator('[data-testid^="sidebar-project-category-header-"]')
    .filter({ hasText: name })
    .first();
}

async function createCategoryFromProject(page: Page, projectViewKey: string, name: string) {
  await projectRow(page, projectViewKey).hover();
  const kebab = page.getByTestId(`sidebar-project-kebab-${projectViewKey}`);
  await expect(kebab).toBeVisible({ timeout: 10_000 });
  await kebab.click();

  await page.getByTestId(`sidebar-project-menu-category-${projectViewKey}`).click();
  await page.getByTestId(`sidebar-project-menu-new-category-${projectViewKey}`).click();

  const dialog = `sidebar-project-category-new-modal-${projectViewKey}`;
  await renameModalInput(page, dialog).fill(name);
  await renameModalSubmit(page, dialog).click();
}

// Categories are a client-side arrangement of the project rows: the daemon never hears about
// them, so everything here is asserted through what the sidebar draws and what survives a reload.
test.describe("Sidebar project categories", () => {
  test("a category collects its project, keeps the rest uncategorized, and collapses", async ({
    page,
  }) => {
    const categorized = await seedWorkspace({ repoPrefix: "project-categories-a-" });
    const uncategorized = await seedWorkspace({ repoPrefix: "project-categories-b-" });

    try {
      const categorizedKey = projectEquivalenceViewKey(categorized.projectKey);
      const uncategorizedKey = projectEquivalenceViewKey(uncategorized.projectKey);

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await expect(projectRow(page, categorizedKey)).toBeVisible({ timeout: 30_000 });
      await expect(projectRow(page, uncategorizedKey)).toBeVisible({ timeout: 30_000 });
      // Nothing is categorized yet, so the list carries no headings at all.
      await expect(page.getByTestId("sidebar-project-category-list")).toHaveCount(0);

      await createCategoryFromProject(page, categorizedKey, "Products");

      await expect(categoryHeader(page, "Products")).toBeVisible({ timeout: 10_000 });
      const uncategorizedBlock = page.getByTestId("sidebar-project-category-uncategorized");
      await expect(
        uncategorizedBlock.getByTestId(`sidebar-project-row-${uncategorizedKey}`),
      ).toBeVisible();
      await expect(
        uncategorizedBlock.getByTestId(`sidebar-project-row-${categorizedKey}`),
      ).toHaveCount(0);
      await expect(projectRow(page, categorizedKey)).toBeVisible();

      await categoryHeader(page, "Products").click();
      await expect(projectRow(page, categorizedKey)).toHaveCount(0, { timeout: 10_000 });
      await expect(projectRow(page, uncategorizedKey)).toBeVisible();

      // The category and its collapse are device-local preferences, so both survive a reload.
      await page.reload();
      await waitForSidebarHydration(page);
      await expect(categoryHeader(page, "Products")).toBeVisible({ timeout: 30_000 });
      await expect(projectRow(page, categorizedKey)).toHaveCount(0);

      await categoryHeader(page, "Products").click();
      await expect(projectRow(page, categorizedKey)).toBeVisible({ timeout: 10_000 });
    } finally {
      await categorized.cleanup();
      await uncategorized.cleanup();
    }
  });
});
