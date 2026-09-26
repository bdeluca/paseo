import { useCallback, useEffect, useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import type {
  AgentDragSource,
  AgentDragSourceInput,
  AgentDropTarget,
  AgentDropTargetInput,
} from "@/agents/move-to-workspace/agent-drag";

/**
 * Browser drag, not dnd-kit: a chat tab lives inside SplitContainer's DndContext and the sidebar
 * sits outside it, and a dnd-kit drag can only reach droppables in its own context. HTML5 drag
 * events cross any React tree, which is what carrying a tab to a sidebar row needs. The terminal
 * takes the same route for file drops.
 */
const AGENT_DRAG_MIME = "application/x-paseo-agent";

interface AgentDragPayload {
  agentId: string;
  serverId: string | null;
  workspaceId: string | null;
}

function readPayload(dataTransfer: DataTransfer | null): AgentDragPayload | null {
  if (!dataTransfer) return null;
  const raw = dataTransfer.getData(AGENT_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AgentDragPayload>;
    if (typeof parsed.agentId !== "string" || parsed.agentId.length === 0) return null;
    return {
      agentId: parsed.agentId,
      serverId: typeof parsed.serverId === "string" ? parsed.serverId : null,
      workspaceId: typeof parsed.workspaceId === "string" ? parsed.workspaceId : null,
    };
  } catch {
    return null;
  }
}

/** True while a drag carrying an agent is in flight; `types` is readable before the drop. */
function carriesAgent(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes(AGENT_DRAG_MIME));
}

export function useAgentDragSource({ agentId, serverId }: AgentDragSourceInput): AgentDragSource {
  // State, not a ref: the row re-renders often, and listeners bound to a node React has since
  // replaced would sit on a detached element and never fire.
  const [node, setNode] = useState<HTMLElement | null>(null);
  const dragRef = useCallback((next: HTMLElement | null) => setNode(next), []);

  useEffect(() => {
    if (!node) return () => {};

    const handleDragStart = (event: DragEvent) => {
      if (!event.dataTransfer) return;
      // Read the agent's workspace at drag start rather than holding a prop: a move it made
      // moments ago would otherwise leave the payload naming the workspace it has already left.
      const workspaceId =
        useSessionStore.getState().sessions[serverId ?? ""]?.agents?.get(agentId)?.workspaceId ??
        null;
      const payload: AgentDragPayload = { agentId, serverId, workspaceId };
      event.dataTransfer.setData(AGENT_DRAG_MIME, JSON.stringify(payload));
      event.dataTransfer.effectAllowed = "move";
    };

    // dnd-kit's own tab reorder listens for pointer events, so both gestures can share the node:
    // a reorder inside the strip never reaches the browser's drag machinery.
    node.setAttribute("draggable", "true");
    node.addEventListener("dragstart", handleDragStart);
    return () => {
      node.removeAttribute("draggable");
      node.removeEventListener("dragstart", handleDragStart);
    };
  }, [agentId, node, serverId]);

  return { dragRef: dragRef as unknown as (node: never) => void };
}

export function useAgentDropTarget({
  serverId,
  workspaceId,
  onDropAgent,
}: AgentDropTargetInput): AgentDropTarget {
  const [isOver, setIsOver] = useState(false);
  const [node, setNode] = useState<HTMLElement | null>(null);
  const dropRef = useCallback((next: HTMLElement | null) => setNode(next), []);

  useEffect(() => {
    const debug = window as unknown as { __paseoDropBind?: unknown[] };
    debug.__paseoDropBind = debug.__paseoDropBind ?? [];
    (debug.__paseoDropBind as unknown[]).push({
      hasNode: Boolean(node),
      hasHandler: Boolean(onDropAgent),
      workspaceId,
    });
    if (!node || !onDropAgent || !workspaceId) return () => {};

    const handleDragOver = (event: DragEvent) => {
      if (!carriesAgent(event.dataTransfer)) return;
      // Without preventDefault the browser refuses the drop outright.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      setIsOver(true);
    };
    const handleDragLeave = () => setIsOver(false);
    const handleDrop = (event: DragEvent) => {
      const payload = readPayload(event.dataTransfer);
      setIsOver(false);
      if (!payload) return;
      event.preventDefault();
      // A move across hosts is not a move: the agent's records live on its own daemon.
      if (payload.serverId !== null && serverId !== null && payload.serverId !== serverId) return;
      if (payload.workspaceId === workspaceId) return;
      onDropAgent(payload.agentId);
    };

    node.addEventListener("dragover", handleDragOver);
    node.addEventListener("dragleave", handleDragLeave);
    node.addEventListener("drop", handleDrop);
    return () => {
      node.removeEventListener("dragover", handleDragOver);
      node.removeEventListener("dragleave", handleDragLeave);
      node.removeEventListener("drop", handleDrop);
    };
  }, [node, onDropAgent, serverId, workspaceId]);

  return { dropRef: dropRef as unknown as (node: never) => void, isOver };
}
