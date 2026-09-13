import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react-native";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { Theme } from "@/styles/theme";
import { useOpenKebabMenuVisibility } from "./use-open-kebab-menu-visibility";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedPencil = withUnistyles(Pencil);
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedArrowDown = withUnistyles(ArrowDown);
const ThemedTrash2 = withUnistyles(Trash2);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const renameLeadingIcon = <ThemedPencil size={14} uniProps={foregroundMutedColorMapping} />;
const moveUpLeadingIcon = <ThemedArrowUp size={14} uniProps={foregroundMutedColorMapping} />;
const moveDownLeadingIcon = <ThemedArrowDown size={14} uniProps={foregroundMutedColorMapping} />;
const deleteLeadingIcon = <ThemedTrash2 size={14} uniProps={foregroundMutedColorMapping} />;

function kebabTriggerStyle({
  hovered = false,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.menuTrigger, hovered && styles.menuTriggerHovered];
}

function renderKebabTriggerIcon({ hovered }: { hovered?: boolean }) {
  return (
    <ThemedMoreVertical
      size={14}
      uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
    />
  );
}

/**
 * The heading over one project group's projects, and over the Ungrouped remainder.
 *
 * Ungrouped has no id, so it carries no menu: there is nothing to rename, move or delete, and it
 * is the heading that is always on screen once any project group exists. Collapsing is the one
 * thing both kinds share, which is why it is the press on the title rather than a menu item.
 */
export function ProjectGroupHeader({
  groupId,
  name,
  collapsed,
  canMoveUp,
  canMoveDown,
  onToggle,
  onRename,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  groupId: string | null;
  name: string | null;
  collapsed: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const kebab = useOpenKebabMenuVisibility(isHovered || isNative || isCompact);
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  const Chevron = collapsed ? ThemedChevronRight : ThemedChevronDown;
  const title = name ?? t("sidebar.projectGroup.ungrouped");
  const testKey = groupId ?? "ungrouped";

  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const openRename = useCallback(() => setIsRenaming(true), []);
  const closeRename = useCallback(() => setIsRenaming(false), []);
  const handleDelete = useCallback(() => {
    void confirmDialog({
      title: t("sidebar.projectGroup.confirmations.deleteTitle"),
      message: t("sidebar.projectGroup.confirmations.deleteMessage", { groupName: title }),
      confirmLabel: t("sidebar.projectGroup.confirmations.deleteConfirm"),
      cancelLabel: t("sidebar.projectGroup.confirmations.cancel"),
      destructive: true,
    }).then((confirmed) => {
      if (confirmed) onDelete();
      return null;
    });
  }, [onDelete, t, title]);

  return (
    <View
      style={styles.header}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        onPress={onToggle}
        style={styles.titleButton}
        testID={`sidebar-project-group-header-${testKey}`}
      >
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Chevron size={12} uniProps={foregroundMutedColorMapping} />
      </Pressable>
      {groupId ? (
        <View
          style={!kebab.showKebab && styles.menuHidden}
          pointerEvents={kebab.showKebab ? "auto" : "none"}
        >
          <DropdownMenu compactMode="sheet" {...kebab.menuProps}>
            <DropdownMenuTrigger
              hitSlop={8}
              style={kebabTriggerStyle}
              accessibilityRole={isWeb ? undefined : "button"}
              accessibilityLabel={t("sidebar.projectGroup.actions.menu")}
              testID={`sidebar-project-group-kebab-${groupId}`}
            >
              {renderKebabTriggerIcon}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" width={200} sheetTitle={title}>
              <DropdownMenuItem
                leading={renameLeadingIcon}
                onSelect={openRename}
                testID={`sidebar-project-group-rename-${groupId}`}
              >
                {t("sidebar.projectGroup.actions.rename")}
              </DropdownMenuItem>
              <DropdownMenuItem
                leading={moveUpLeadingIcon}
                disabled={!canMoveUp}
                onSelect={onMoveUp}
                testID={`sidebar-project-group-move-up-${groupId}`}
              >
                {t("sidebar.projectGroup.actions.moveUp")}
              </DropdownMenuItem>
              <DropdownMenuItem
                leading={moveDownLeadingIcon}
                disabled={!canMoveDown}
                onSelect={onMoveDown}
                testID={`sidebar-project-group-move-down-${groupId}`}
              >
                {t("sidebar.projectGroup.actions.moveDown")}
              </DropdownMenuItem>
              <DropdownMenuItem
                leading={deleteLeadingIcon}
                onSelect={handleDelete}
                testID={`sidebar-project-group-delete-${groupId}`}
              >
                {t("sidebar.projectGroup.actions.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </View>
      ) : null}
      <AdaptiveRenameModal
        visible={isRenaming}
        title={t("sidebar.projectGroup.rename.title")}
        initialValue={name ?? ""}
        placeholder={t("sidebar.projectGroup.namePlaceholder")}
        submitLabel={t("sidebar.projectGroup.rename.submit")}
        onClose={closeRename}
        onSubmit={onRename}
        testID={`sidebar-project-group-rename-modal-${testKey}`}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    userSelect: "none",
  },
  titleButton: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 1,
  },
  menuTrigger: {
    width: 24,
    height: 24,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  menuTriggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  menuHidden: {
    opacity: 0,
  },
}));
