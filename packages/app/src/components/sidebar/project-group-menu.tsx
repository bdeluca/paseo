import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { FolderPlus } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubTrigger,
  type MenuPageDefinition,
} from "@/components/ui/dropdown-menu";
import { findProjectGroupId } from "@/stores/sidebar-project-groups";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import type { Theme } from "@/styles/theme";

const PROJECT_GROUP_PAGE_ID = "project-group";

/** The project-group submenu's two halves: the page the surface registers, and the row that opens it. */
export interface ProjectGroupMenu {
  pages: MenuPageDefinition[];
  item: ReactElement;
}

const ThemedFolderPlus = withUnistyles(FolderPlus);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const newGroupLeadingIcon = <ThemedFolderPlus size={14} uniProps={foregroundMutedColorMapping} />;

function GroupOptionItem({
  groupId,
  name,
  selected,
  testID,
  onSelect,
}: {
  groupId: string | null;
  name: string;
  selected: boolean;
  testID: string;
  onSelect: (groupId: string | null) => void;
}) {
  const handleSelect = useCallback(() => onSelect(groupId), [groupId, onSelect]);
  return (
    <DropdownMenuItem selected={selected} showSelectedCheck onSelect={handleSelect} testID={testID}>
      {name}
    </DropdownMenuItem>
  );
}

/**
 * The "Project group" row on a project's menu, and the page behind it.
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
  const currentGroupId = findProjectGroupId(groups, projectViewKey);
  const currentGroupName =
    groups.find((group) => group.id === currentGroupId)?.name ??
    t("sidebar.projectGroup.ungrouped");

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
            {groups.map((group) => (
              <GroupOptionItem
                key={group.id}
                groupId={group.id}
                name={group.name}
                selected={group.id === currentGroupId}
                testID={`sidebar-project-menu-group-${group.id}-${projectViewKey}`}
                onSelect={handleSelect}
              />
            ))}
            <GroupOptionItem
              groupId={null}
              name={t("sidebar.projectGroup.ungrouped")}
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
    [groups, currentGroupId, handleSelect, onCreateGroup, projectViewKey, t],
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
