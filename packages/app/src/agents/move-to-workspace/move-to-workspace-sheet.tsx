import React, { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Alert } from "@/components/ui/alert";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { Theme } from "@/styles/theme";
import type { MoveWorkspaceOption } from "./model";

export interface MoveToWorkspaceSheetProps {
  visible: boolean;
  /** The agent's title, or its short id when it has none. */
  agentLabel: string;
  options: MoveWorkspaceOption[];
  carriedSubagentCount: number;
  pendingWorkspaceId: string | null;
  error: string | null;
  onSelect: (workspaceId: string) => void;
  onClose: () => void;
}

const SHEET_SNAP_POINTS = ["60%", "90%"];

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));

function PendingSpinner() {
  return <ThemedLoadingSpinner size="small" />;
}

function matchesQuery(option: MoveWorkspaceOption, query: string): boolean {
  if (!query) return true;
  return (
    option.label.toLowerCase().includes(query) || option.projectName.toLowerCase().includes(query)
  );
}

export function MoveToWorkspaceSheet({
  visible,
  agentLabel,
  options,
  carriedSubagentCount,
  pendingWorkspaceId,
  error,
  onSelect,
  onClose,
}: MoveToWorkspaceSheetProps) {
  const { t } = useTranslation();
  const [searchInput, setSearchInput] = useState("");
  const query = searchInput.trim().toLowerCase();
  const visibleOptions = useMemo(
    () => options.filter((option) => matchesQuery(option, query)),
    [options, query],
  );

  // The carried count is the confirmation. It is stated before the choice rather
  // than in a dialog after it, so the number is visible while the target is picked.
  const subtitle = useMemo(() => {
    if (carriedSubagentCount === 0) {
      return t("agents.moveToWorkspace.subtitle", { name: agentLabel });
    }
    return carriedSubagentCount === 1
      ? t("agents.moveToWorkspace.carriesOne", { name: agentLabel })
      : t("agents.moveToWorkspace.carriesMany", {
          name: agentLabel,
          count: carriedSubagentCount,
        });
  }, [agentLabel, carriedSubagentCount, t]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("agents.moveToWorkspace.title"),
      subtitle: <Text style={styles.subtitle}>{subtitle}</Text>,
      search: {
        onChange: setSearchInput,
        placeholder: t("agents.moveToWorkspace.searchPlaceholder"),
        // The compact sheet stays mounted while hidden, so the field has to be
        // told to drop text the state already dropped.
        resetKey: visible ? "open" : "closed",
        testID: "move-to-workspace-search",
      },
    }),
    [subtitle, t, visible],
  );

  const handleClose = useCallback(() => {
    setSearchInput("");
    onClose();
  }, [onClose]);

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={handleClose}
      header={header}
      testID="move-to-workspace-sheet"
      desktopMaxWidth={480}
      snapPoints={SHEET_SNAP_POINTS}
    >
      {error ? (
        <View style={styles.alertWrap}>
          <Alert
            variant="error"
            title={t("agents.moveToWorkspace.error")}
            description={error}
            testID="move-to-workspace-error"
          />
        </View>
      ) : null}
      {visibleOptions.length === 0 ? (
        <Text style={styles.empty} testID="move-to-workspace-empty">
          {options.length === 0
            ? t("agents.moveToWorkspace.empty")
            : t("agents.moveToWorkspace.noMatches")}
        </Text>
      ) : (
        visibleOptions.map((option) => (
          <WorkspaceOptionRow
            key={option.workspaceId}
            option={option}
            pending={pendingWorkspaceId === option.workspaceId}
            disabled={pendingWorkspaceId !== null}
            onSelect={onSelect}
          />
        ))
      )}
    </AdaptiveModalSheet>
  );
}

function WorkspaceOptionRow({
  option,
  pending,
  disabled,
  onSelect,
}: {
  option: MoveWorkspaceOption;
  pending: boolean;
  disabled: boolean;
  onSelect: (workspaceId: string) => void;
}) {
  const handlePress = useCallback(
    () => onSelect(option.workspaceId),
    [onSelect, option.workspaceId],
  );
  const accessibilityState = useMemo(() => ({ disabled }), [disabled]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      disabled={disabled}
      onPress={handlePress}
      style={styles.row}
      testID={`move-to-workspace-option-${option.workspaceId}`}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {option.label}
        </Text>
        <Text style={styles.rowProject} numberOfLines={1}>
          {option.projectName}
        </Text>
      </View>
      {pending ? <PendingSpinner /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  alertWrap: {
    paddingBottom: theme.spacing[3],
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[4],
    textAlign: "center",
  },
  row: {
    alignItems: "center",
    borderRadius: theme.borderRadius.md,
    flexDirection: "row",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  rowText: {
    flex: 1,
    gap: theme.spacing[1],
  },
  rowLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowProject: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
