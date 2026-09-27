import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

export interface AgentWorkspaceMove {
  /** Absent when the host cannot move agents, so a surface can leave its affordance out. */
  move: ((agentId: string, workspaceId: string) => void) | undefined;
  /** The workspace a move is in flight to, for a per-option pending state. */
  pendingWorkspaceId: string | null;
  errorMessage: string | null;
  reset: () => void;
}

/**
 * The daemon round-trip behind every "move this agent to that workspace" surface — the picker
 * sheet and a drop on a sidebar workspace row. Both call this, so the toast a move announces and
 * the failure it reports cannot drift between them.
 */
export function useAgentWorkspaceMove(
  serverId: string | null,
  options?: { onMoved?: () => void },
): AgentWorkspaceMove {
  const { t } = useTranslation();
  const toast = useToast();
  const normalizedServerId = serverId?.trim() || null;
  const client = useHostRuntimeClient(normalizedServerId ?? "");
  const supported = useHostFeature(normalizedServerId, "agentWorkspaceMove");
  const onMoved = options?.onMoved;

  const mutation = useMutation({
    mutationFn: async ({ agentId, workspaceId }: { agentId: string; workspaceId: string }) => {
      if (!client) {
        throw new Error(t("agents.moveToWorkspace.disconnected"));
      }
      return await client.moveAgentToWorkspace(agentId, workspaceId);
    },
    onSuccess: (_result, variables) => {
      const workspace = useSessionStore
        .getState()
        .sessions[normalizedServerId ?? ""]?.workspaces?.get(variables.workspaceId);
      const workspaceLabel = workspace?.title || workspace?.name || variables.workspaceId;
      toast.show(t("agents.moveToWorkspace.moved", { workspace: workspaceLabel }));
      onMoved?.();
    },
  });

  const { mutate, reset } = mutation;
  const move = useCallback(
    (agentId: string, workspaceId: string) => mutate({ agentId, workspaceId }),
    [mutate],
  );

  return {
    move: supported ? move : undefined,
    pendingWorkspaceId: mutation.isPending ? mutation.variables.workspaceId : null,
    errorMessage: mutation.error ? mutation.error.message : null,
    reset,
  };
}
