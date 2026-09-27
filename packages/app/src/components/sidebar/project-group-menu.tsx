import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  FolderInput,
  FolderPlus,
  Layers,
  Pencil,
  Trash2,
} from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubTrigger,
  type MenuPageDefinition,
} from "@/components/ui/dropdown-menu";
import {
  canCreateProjectGroupIn,
  canMoveProjectGroup,
  findProjectGroupId,
  flattenProjectGroupTree,
  isProjectGroupWithin,
  type SidebarProjectGroup,
} from "@/stores/sidebar-project-groups";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import type { Theme } from "@/styles/theme";

const PROJECT_GROUP_PAGE_ID = "project-group";
const MOVE_GROUP_PAGE_ID = "project-group-move";

/** A submenu's two halves: the pages the surface registers, and the rows that open them. */
export interface ProjectGroupMenu {
  pages: MenuPageDefinition[];
  item: ReactElement;
}

const ThemedFolderPlus = withUnistyles(FolderPlus);
const ThemedFolderInput = withUnistyles(FolderInput);
const ThemedLayers = withUnistyles(Layers);
const ThemedPencil = withUnistyles(Pencil);
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedArrowDown = withUnistyles(ArrowDown);
const ThemedTrash2 = withUnistyles(Trash2);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const newGroupLeadingIcon = <ThemedFolderPlus size={14} uniProps={foregroundMutedColorMapping} />;
const moveToLeadingIcon = <ThemedFolderInput size={14} uniProps={foregroundMutedColorMapping} />;
// The sidebar heading's own glyph, so a group in a picker reads as the heading it names.
const groupOptionIcon = <ThemedLayers size={14} uniProps={foregroundMutedColorMapping} />;
const renameLeadingIcon = <ThemedPencil size={14} uniProps={foregroundMutedColorMapping} />;
const moveUpLeadingIcon = <ThemedArrowUp size={14} uniProps={foregroundMutedColorMapping} />;
const moveDownLeadingIcon = <ThemedArrowDown size={14} uniProps={foregroundMutedColorMapping} />;
const deleteLeadingIcon = <ThemedTrash2 size={14} uniProps={foregroundMutedColorMapping} />;

/** One destination in a group picker; `targetId` is `null` for Ungrouped or the top level. */
function GroupOptionItem({
  targetId,
  label,
  depth,
  selected,
  disabled = false,
  testID,
  onSelect,
}: {
  targetId: string | null;
  label: string;
  depth: number;
  selected: boolean;
  disabled?: boolean;
  testID: string;
  onSelect: (targetId: string | null) => void;
}) {
  const handleSelect = useCallback(() => onSelect(targetId), [targetId, onSelect]);
  return (
    <DropdownMenuItem
      selected={selected}
      showSelectedCheck
      disabled={disabled}
      leading={targetId === null ? null : groupOptionIcon}
      indentLevel={depth}
      onSelect={handleSelect}
      testID={testID}
    >
      {label}
    </DropdownMenuItem>
  );
}

function groupName(groups: readonly SidebarProjectGroup[], groupId: string | null): string | null {
  if (groupId === null) return null;
  return groups.find((group) => group.id === groupId)?.name ?? null;
}

/**
 * The "Project group" row on a project's menu, and the page behind it: every project group as the
 * tree it is, indented by depth, then Ungrouped.
 *
 * One hook so the kebab and the row's context menu cannot drift — both surfaces are the same menu
 * engine, so both take the page as data and render the same trigger. The decision earns a submenu
 * because the current value is the point and a group list grows past what a root menu can hold;
 * see docs/menus.md.
 */
export function useProjectGroupMenu(input: {
  projectViewKey: string;
  onCreateGroup: () => void;
}): ProjectGroupMenu {
  const { t } = useTranslation();
  const groups = useSidebarOrderStore((state) => state.projectGroups);
  const moveProjectToGroup = useSidebarOrderStore((state) => state.moveProjectToGroup);
  const { projectViewKey, onCreateGroup } = input;
  const tree = useMemo(() => flattenProjectGroupTree(groups), [groups]);
  const currentGroupId = findProjectGroupId(groups, projectViewKey);
  const currentGroupName = groupName(groups, currentGroupId) ?? t("sidebar.projectGroup.ungrouped");

  const handleSelect = useCallback(
    (groupId: string | null) => moveProjectToGroup(projectViewKey, groupId),
    [moveProjectToGroup, projectViewKey],
  );

  const pages = useMemo<MenuPageDefinition[]>(
    () => [
      {
        id: PROJECT_GROUP_PAGE_ID,
        title: t("sidebar.projectGroup.label"),
        content: (
          <>
            {tree.map(({ group, depth }) => (
              <GroupOptionItem
                key={group.id}
                targetId={group.id}
                label={group.name}
                depth={depth}
                selected={group.id === currentGroupId}
                testID={`sidebar-project-menu-group-${group.id}-${projectViewKey}`}
                onSelect={handleSelect}
              />
            ))}
            <GroupOptionItem
              targetId={null}
              label={t("sidebar.projectGroup.ungrouped")}
              depth={0}
              selected={currentGroupId === null}
              testID={`sidebar-project-menu-group-ungrouped-${projectViewKey}`}
              onSelect={handleSelect}
            />
            <DropdownMenuSeparator />
            <DropdownMenuItem
              leading={newGroupLeadingIcon}
              onSelect={onCreateGroup}
              testID={`sidebar-project-menu-new-group-${projectViewKey}`}
            >
              {t("sidebar.projectGroup.actions.create")}
            </DropdownMenuItem>
          </>
        ),
      },
    ],
    [tree, currentGroupId, handleSelect, onCreateGroup, projectViewKey, t],
  );

  const item = (
    <DropdownMenuSubTrigger
      id={PROJECT_GROUP_PAGE_ID}
      value={currentGroupName}
      testID={`sidebar-project-menu-group-${projectViewKey}`}
    >
      {t("sidebar.projectGroup.label")}
    </DropdownMenuSubTrigger>
  );

  return { pages, item };
}

interface ProjectGroupActionsInput {
  groupId: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRename: () => void;
  onCreateInside: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveTo: (parentId: string | null) => void;
  onDelete: () => void;
}

/**
 * A project group's own menu, for its kebab and its heading's context menu alike. The "Move to"
 * page lists the top level and every group this one may move into: never itself or anything under
 * it, and a group its subtree would push past the depth cap is shown but disabled, so the tree
 * keeps its shape.
 */
export function useProjectGroupActionsMenu(input: ProjectGroupActionsInput): ProjectGroupMenu {
  const { t } = useTranslation();
  const groups = useSidebarOrderStore((state) => state.projectGroups);
  const { groupId, onMoveTo } = input;
  const tree = useMemo(() => flattenProjectGroupTree(groups), [groups]);
  const parentId = groups.find((group) => group.id === groupId)?.parentId ?? null;
  const parentLabel = groupName(groups, parentId) ?? t("sidebar.projectGroup.topLevel");
  const canCreateInside = canCreateProjectGroupIn(groups, groupId);

  const pages = useMemo<MenuPageDefinition[]>(
    () => [
      {
        id: MOVE_GROUP_PAGE_ID,
        title: t("sidebar.projectGroup.actions.moveTo"),
        content: (
          <>
            <GroupOptionItem
              targetId={null}
              label={t("sidebar.projectGroup.topLevel")}
              depth={0}
              selected={parentId === null}
              testID={`sidebar-project-group-move-target-top-level-${groupId}`}
              onSelect={onMoveTo}
            />
            {tree
              .filter((entry) => !isProjectGroupWithin(groups, entry.group.id, groupId))
              .map(({ group, depth }) => (
                <GroupOptionItem
                  key={group.id}
                  targetId={group.id}
                  label={group.name}
                  depth={depth}
                  selected={group.id === parentId}
                  disabled={
                    group.id !== parentId && !canMoveProjectGroup(groups, groupId, group.id)
                  }
                  testID={`sidebar-project-group-move-target-${group.id}-${groupId}`}
                  onSelect={onMoveTo}
                />
              ))}
          </>
        ),
      },
    ],
    [groups, tree, groupId, parentId, onMoveTo, t],
  );

  const item = (
    <>
      <DropdownMenuItem
        leading={renameLeadingIcon}
        onSelect={input.onRename}
        testID={`sidebar-project-group-rename-${groupId}`}
      >
        {t("sidebar.projectGroup.actions.rename")}
      </DropdownMenuItem>
      <DropdownMenuItem
        leading={moveUpLeadingIcon}
        disabled={!input.canMoveUp}
        onSelect={input.onMoveUp}
        testID={`sidebar-project-group-move-up-${groupId}`}
      >
        {t("sidebar.projectGroup.actions.moveUp")}
      </DropdownMenuItem>
      <DropdownMenuItem
        leading={moveDownLeadingIcon}
        disabled={!input.canMoveDown}
        onSelect={input.onMoveDown}
        testID={`sidebar-project-group-move-down-${groupId}`}
      >
        {t("sidebar.projectGroup.actions.moveDown")}
      </DropdownMenuItem>
      <DropdownMenuSubTrigger
        id={MOVE_GROUP_PAGE_ID}
        value={parentLabel}
        leading={moveToLeadingIcon}
        testID={`sidebar-project-group-move-to-${groupId}`}
      >
        {t("sidebar.projectGroup.actions.moveTo")}
      </DropdownMenuSubTrigger>
      <DropdownMenuItem
        leading={newGroupLeadingIcon}
        disabled={!canCreateInside}
        onSelect={input.onCreateInside}
        testID={`sidebar-project-group-new-inside-${groupId}`}
      >
        {t("sidebar.projectGroup.actions.createInside")}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        leading={deleteLeadingIcon}
        onSelect={input.onDelete}
        testID={`sidebar-project-group-delete-${groupId}`}
      >
        {t("sidebar.projectGroup.actions.delete")}
      </DropdownMenuItem>
    </>
  );

  return { pages, item };
}
