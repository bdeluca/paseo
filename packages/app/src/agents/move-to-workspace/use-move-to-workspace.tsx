import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "@/stores/session-store";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import {
  buildMoveWorkspaceOptions,
  countCarriedSubagents,
  type CarriedSubagentInput,
  type MoveWorkspaceCandidate,
} from "./model";
import { MoveToWorkspaceSheet } from "./move-to-workspace-sheet";

export interface MoveToWorkspaceController {
  /** Absent when the host cannot move agents, so a surface can leave its item out. */
  open: ((agentId: string) => void) | undefined;
  sheet: ReactNode;
}

interface MoveTarget {
  agentId: string;
  label: string;
  workspaceId: string | undefined;
}

interface MoveSelection {
  agentId: string;
  workspaceId: string;
}

function selectWorkspaceCandidates(
  serverId: string,
): (state: SessionState) => MoveWorkspaceCandidate[] {
  return (state) => {
    const workspaces = state.sessions[serverId]?.workspaces;
    if (!workspaces) return [];
    return Array.from(workspaces.values(), (workspace) => ({
      id: workspace.id,
      name: workspace.name,
      title: workspace.title,
      projectDisplayName: workspace.projectDisplayName,
      projectCustomName: workspace.projectCustomName,
      archivingAt: workspace.archivingAt,
    }));
  };
}

function selectSubagentInputs(serverId: string): (state: SessionState) => CarriedSubagentInput[] {
  return (state) => {
    const agents = state.sessions[serverId]?.agents;
    if (!agents) return [];
    return Array.from(agents.values(), (agent) => ({
      id: agent.id,
      parentAgentId: agent.parentAgentId,
      workspaceId: agent.workspaceId,
      archivedAt: agent.archivedAt,
    })).filter((agent) => !agent.archivedAt);
  };
}

type SessionState = ReturnType<typeof useSessionStore.getState>;

/**
 * Owns the "Move to workspace…" surface: the picker, the daemon round-trip, and its
 * pending and failure states. Every surface that offers the action renders the same
 * sheet from this hook, so the picker and the move cannot drift apart.
 */
export function useMoveToWorkspace(serverId: string | null): MoveToWorkspaceController {
  const { t } = useTranslation();
  const toast = useToast();
  const normalizedServerId = serverId?.trim() || null;
  const client = useHostRuntimeClient(normalizedServerId ?? "");
  const supported = useHostFeature(normalizedServerId, "agentWorkspaceMove");
  const [target, setTarget] = useState<MoveTarget | null>(null);

  const workspaceCandidates = useStoreWithEqualityFn(
    useSessionStore,
    selectWorkspaceCandidates(normalizedServerId ?? ""),
    equal,
  );
  const subagentInputs = useStoreWithEqualityFn(
    useSessionStore,
    selectSubagentInputs(normalizedServerId ?? ""),
    equal,
  );

  const mutation = useMutation({
    mutationFn: async ({ agentId, workspaceId }: MoveSelection) => {
      if (!client) {
        throw new Error(t("agents.moveToWorkspace.disconnected"));
      }
      return await client.moveAgentToWorkspace(agentId, workspaceId);
    },
    onSuccess: (_result, variables) => {
      const workspaceLabel =
        workspaceCandidates.find((workspace) => workspace.id === variables.workspaceId)?.title ||
        workspaceCandidates.find((workspace) => workspace.id === variables.workspaceId)?.name ||
        variables.workspaceId;
      toast.show(t("agents.moveToWorkspace.moved", { workspace: workspaceLabel }));
      setTarget(null);
    },
  });

  const { mutate, reset } = mutation;

  const open = useCallback(
    (agentId: string) => {
      const agent = useSessionStore
        .getState()
        .sessions[normalizedServerId ?? ""]?.agents?.get(agentId);
      reset();
      setTarget({
        agentId,
        label: agent?.title?.trim() || agentId.slice(0, 7),
        workspaceId: agent?.workspaceId,
      });
    },
    [normalizedServerId, reset],
  );

  const close = useCallback(() => {
    setTarget(null);
    reset();
  }, [reset]);

  const handleSelect = useCallback(
    (workspaceId: string) => {
      if (!target) return;
      mutate({ agentId: target.agentId, workspaceId });
    },
    [mutate, target],
  );

  const options = useMemo(
    () =>
      buildMoveWorkspaceOptions({
        workspaces: workspaceCandidates,
        currentWorkspaceId: target?.workspaceId ?? null,
      }),
    [target?.workspaceId, workspaceCandidates],
  );

  const carriedSubagentCount = useMemo(
    () =>
      target
        ? countCarriedSubagents({
            agents: subagentInputs,
            agentId: target.agentId,
            sourceWorkspaceId: target.workspaceId,
          })
        : 0,
    [subagentInputs, target],
  );

  const sheet = target ? (
    <MoveToWorkspaceSheet
      visible
      agentLabel={target.label}
      options={options}
      carriedSubagentCount={carriedSubagentCount}
      pendingWorkspaceId={mutation.isPending ? mutation.variables.workspaceId : null}
      error={mutation.error ? mutation.error.message : null}
      onSelect={handleSelect}
      onClose={close}
    />
  ) : null;

  return { open: supported ? open : undefined, sheet };
}
