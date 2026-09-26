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

async function createGroupFromHeaderButton(page: Page, name: string) {
  await page.getByTestId("sidebar-new-project-group").click();
  const dialog = "sidebar-project-group-new-modal";
  await renameModalInput(page, dialog).fill(name);
  await renameModalSubmit(page, dialog).click();
}

/** A named group's id, read off its heading; ids are uuids the client mints. */
async function groupIdByName(page: Page, name: string): Promise<string> {
  const testId = await groupHeader(page, name).getAttribute("data-testid");
  const groupId = testId?.replace("sidebar-project-group-header-", "");
  if (!groupId) throw new Error(`No project group heading named ${name}`);
  return groupId;
}

function groupBlock(page: Page, groupId: string) {
  return page.getByTestId(`sidebar-project-group-${groupId}`);
}

async function createGroupInside(page: Page, parentId: string, name: string) {
  await openGroupMenu(page, parentId);
  await page.getByTestId(`sidebar-project-group-new-inside-${parentId}`).click();
  const dialog = `sidebar-project-group-new-modal-${parentId}`;
  await renameModalInput(page, dialog).fill(name);
  await renameModalSubmit(page, dialog).click();
}

async function moveProjectToGroup(page: Page, projectViewKey: string, groupId: string) {
  await projectRow(page, projectViewKey).hover();
  await page.getByTestId(`sidebar-project-kebab-${projectViewKey}`).click();
  await page.getByTestId(`sidebar-project-menu-group-${projectViewKey}`).click();
  await page.getByTestId(`sidebar-project-menu-group-${groupId}-${projectViewKey}`).click();
}

async function openMoveToPage(page: Page, groupId: string) {
  await openGroupMenu(page, groupId);
  await page.getByTestId(`sidebar-project-group-move-to-${groupId}`).click();
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

  test("the header button makes an empty group that projects can then join", async ({ page }) => {
    const project = await seedWorkspace({ repoPrefix: "project-groups-button-" });

    try {
      const projectViewKey = projectEquivalenceViewKey(project.projectKey);

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await expect(projectRow(page, projectViewKey)).toBeVisible({ timeout: 30_000 });

      // The way in that does not start from a project: no group exists to right-click yet.
      await createGroupFromHeaderButton(page, "Clients");

      const header = groupHeader(page, "Clients");
      await expect(header).toBeVisible({ timeout: 10_000 });
      const groupId = await groupIdByName(page, "Clients");
      // Empty: the project it did not name stays in Ungrouped.
      await expect(
        groupBlock(page, groupId).getByTestId(`sidebar-project-row-${projectViewKey}`),
      ).toHaveCount(0);
      await expect(
        page
          .getByTestId("sidebar-project-group-ungrouped")
          .getByTestId(`sidebar-project-row-${projectViewKey}`),
      ).toBeVisible();

      await moveProjectToGroup(page, projectViewKey, groupId);
      await expect(
        groupBlock(page, groupId).getByTestId(`sidebar-project-row-${projectViewKey}`),
      ).toBeVisible({ timeout: 10_000 });

      // An empty group is still a device-local preference, so it survives a reload.
      await page.reload();
      await waitForSidebarHydration(page);
      await expect(groupHeader(page, "Clients")).toBeVisible({ timeout: 30_000 });
    } finally {
      await project.cleanup();
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
  test("groups nest: a subgroup holds projects, moves, collapses on its own, and survives delete", async ({
    page,
  }) => {
    const top = await seedWorkspace({ repoPrefix: "project-groups-e-" });
    const nested = await seedWorkspace({ repoPrefix: "project-groups-f-" });
    const loose = await seedWorkspace({ repoPrefix: "project-groups-g-" });

    try {
      const topKey = projectEquivalenceViewKey(top.projectKey);
      const nestedKey = projectEquivalenceViewKey(nested.projectKey);
      const looseKey = projectEquivalenceViewKey(loose.projectKey);

      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      for (const key of [topKey, nestedKey, looseKey]) {
        await expect(projectRow(page, key)).toBeVisible({ timeout: 30_000 });
      }

      await createGroupFromProject(page, topKey, "Work");
      await expect(groupHeader(page, "Work")).toBeVisible({ timeout: 10_000 });
      const workId = await groupIdByName(page, "Work");

      await createGroupInside(page, workId, "Clients");
      await expect(groupHeader(page, "Clients")).toBeVisible({ timeout: 10_000 });
      const clientsId = await groupIdByName(page, "Clients");
      // The subgroup renders inside its parent's block, behind its spine.
      await expect(
        groupBlock(page, workId).getByTestId(`sidebar-project-group-${clientsId}`),
      ).toBeVisible();

      // The project menu's picker offers the nested group, and picking it files the project there.
      await moveProjectToGroup(page, nestedKey, clientsId);
      await expect(
        groupBlock(page, clientsId).getByTestId(`sidebar-project-row-${nestedKey}`),
      ).toBeVisible({
        timeout: 10_000,
      });
      // A parent counts every project under it, not only its own rows.
      await expect(page.getByTestId(`sidebar-project-group-count-${workId}`)).toHaveText("2");
      await expect(page.getByTestId(`sidebar-project-group-count-${clientsId}`)).toHaveText("1");

      // A group cannot be moved into itself or anything beneath it: those are not offered.
      await openMoveToPage(page, workId);
      await expect(
        page.getByTestId(`sidebar-project-group-move-target-top-level-${workId}`),
      ).toBeVisible();
      await expect(
        page.getByTestId(`sidebar-project-group-move-target-${workId}-${workId}`),
      ).toHaveCount(0);
      await expect(
        page.getByTestId(`sidebar-project-group-move-target-${clientsId}-${workId}`),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      // Collapsing a parent hides its whole subtree; the child keeps its own collapse.
      await page.getByTestId(`sidebar-project-group-header-${clientsId}`).click();
      await expect(projectRow(page, nestedKey)).toHaveCount(0, { timeout: 10_000 });
      await page.getByTestId(`sidebar-project-group-header-${workId}`).click();
      await expect(projectRow(page, topKey)).toHaveCount(0, { timeout: 10_000 });
      await expect(groupHeader(page, "Clients")).toHaveCount(0);
      await page.getByTestId(`sidebar-project-group-header-${workId}`).click();
      await expect(projectRow(page, topKey)).toBeVisible({ timeout: 10_000 });
      await expect(groupHeader(page, "Clients")).toBeVisible();
      await expect(projectRow(page, nestedKey)).toHaveCount(0);
      await page.getByTestId(`sidebar-project-group-header-${clientsId}`).click();
      await expect(projectRow(page, nestedKey)).toBeVisible({ timeout: 10_000 });

      // Move to the top level and back, through the heading's right-click menu this time.
      await page
        .getByTestId(`sidebar-project-group-header-${clientsId}`)
        .click({ button: "right" });
      await expect(
        page.getByTestId(`sidebar-project-group-context-menu-${clientsId}`),
      ).toBeVisible();
      await page.getByTestId(`sidebar-project-group-move-to-${clientsId}`).click();
      await page.getByTestId(`sidebar-project-group-move-target-top-level-${clientsId}`).click();
      await expect(
        groupBlock(page, workId).getByTestId(`sidebar-project-group-${clientsId}`),
      ).toHaveCount(0, {
        timeout: 10_000,
      });
      await expect(
        groupBlock(page, clientsId).getByTestId(`sidebar-project-row-${nestedKey}`),
      ).toBeVisible();
      await openMoveToPage(page, clientsId);
      await page.getByTestId(`sidebar-project-group-move-target-${workId}-${clientsId}`).click();
      await expect(
        groupBlock(page, workId).getByTestId(`sidebar-project-group-${clientsId}`),
      ).toBeVisible({
        timeout: 10_000,
      });

      // The tree is a device-local preference, so it survives a reload intact.
      await page.reload();
      await waitForSidebarHydration(page);
      await expect(groupHeader(page, "Work")).toBeVisible({ timeout: 30_000 });
      await expect(
        groupBlock(page, workId)
          .getByTestId(`sidebar-project-group-${clientsId}`)
          .getByTestId(`sidebar-project-row-${nestedKey}`),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        page
          .getByTestId("sidebar-project-group-ungrouped")
          .getByTestId(`sidebar-project-row-${looseKey}`),
      ).toBeVisible();

      // Deleting the parent removes one level: its subgroup rises to the top level with its
      // project, and its own project falls to Ungrouped.
      page.once("dialog", (dialog) => void dialog.accept());
      await openGroupMenu(page, workId);
      await page.getByTestId(`sidebar-project-group-delete-${workId}`).click();
      await expect(groupHeader(page, "Work")).toHaveCount(0, { timeout: 10_000 });
      await expect(
        groupBlock(page, clientsId).getByTestId(`sidebar-project-row-${nestedKey}`),
      ).toBeVisible();
      await expect(
        page
          .getByTestId("sidebar-project-group-ungrouped")
          .getByTestId(`sidebar-project-row-${topKey}`),
      ).toBeVisible();
    } finally {
      await top.cleanup();
      await nested.cleanup();
      await loose.cleanup();
    }
  });
});
