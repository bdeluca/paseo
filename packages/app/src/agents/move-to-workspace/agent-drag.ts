export interface AgentDragSource {
  /** Web: the tab's DOM node ref. Native has no cross-surface drag, so nothing to attach. */
  dragRef?: (node: never) => void;
}

export interface AgentDropTarget {
  dropRef?: (node: never) => void;
  isOver: boolean;
}

export interface AgentDragSourceInput {
  agentId: string;
  serverId: string | null;
}

export interface AgentDropTargetInput {
  serverId: string | null;
  workspaceId: string | null;
  onDropAgent: ((agentId: string) => void) | undefined;
}

/**
 * Native keeps the "Move to workspace…" menu. A chat tab and the sidebar live in different
 * gesture hosts there, and a long-press drag belongs to the list that started it.
 */
export function useAgentDragSource(_input: AgentDragSourceInput): AgentDragSource {
  return {};
}

export function useAgentDropTarget(_input: AgentDropTargetInput): AgentDropTarget {
  return { isOver: false };
}
