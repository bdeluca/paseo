import { useCallback, useEffect, useState } from "react";
import { useSessionStore } from "@/stores/session-store";
import type {
  AgentDragSource,
  AgentDragSourceInput,
  AgentDropTarget,
  AgentDropTargetInput,
} from "@/agents/move-to-workspace/agent-drag";

/**
 * Carrying a chat tab to a sidebar workspace row, tracked on raw pointer events.
 *
 * Neither obvious mechanism works here. dnd-kit cannot span the two surfaces: the tab strip's
 * DndContext lives inside SplitContainer and the sidebar sits outside it, and a drag only reaches
 * droppables registered in its own context. HTML5 drag cannot start at all: the tab strip is a
 * dnd-kit sortable whose pointer sensor calls preventDefault on pointerdown, so the browser never
 * raises `dragstart` — a listener there fires only for synthetically dispatched events, which is
 * how this passed its first test while doing nothing under a real mouse.
 *
 * What is left is the pointer itself. The tab records the agent on pointerdown, the window watches
 * the pointer, and a release over a row marked with `data-paseo-agent-drop` moves the agent there.
 * dnd-kit keeps reordering tabs within the strip; a release outside it is a drop this owns.
 */
const DROP_ATTRIBUTE = "data-paseo-agent-drop";
const DROP_SERVER_ATTRIBUTE = "data-paseo-agent-drop-server";
/** Pointer travel, in px, before a press counts as a drag rather than a click on the tab. */
const DRAG_THRESHOLD = 8;

interface ActiveAgentDrag {
  agentId: string;
  serverId: string | null;
  workspaceId: string | null;
  startX: number;
  startY: number;
  moved: boolean;
}

let activeDrag: ActiveAgentDrag | null = null;
const overListeners = new Set<(workspaceId: string | null) => void>();
let hoveredWorkspaceId: string | null = null;

function setHovered(workspaceId: string | null): void {
  if (hoveredWorkspaceId === workspaceId) return;
  hoveredWorkspaceId = workspaceId;
  for (const listener of overListeners) listener(workspaceId);
}

function dropTargetAt(
  x: number,
  y: number,
): { workspaceId: string; serverId: string | null } | null {
  // elementsFromPoint, not elementFromPoint: the tab being dragged is translated under the cursor
  // by dnd-kit's sortable, so the topmost element at the pointer is the tab itself and the row
  // beneath it would never be found.
  for (const element of document.elementsFromPoint(x, y)) {
    const host = element.closest(`[${DROP_ATTRIBUTE}]`);
    const workspaceId = host?.getAttribute(DROP_ATTRIBUTE);
    if (workspaceId) {
      return { workspaceId, serverId: host?.getAttribute(DROP_SERVER_ATTRIBUTE) ?? null };
    }
  }
  return null;
}

/**
 * One window-level watcher owns the drag for every row.
 *
 * Each row having its own pointerup listener was the first version and it never worked: the
 * listeners share this module's drag record, and whichever row ran first cleared it, so the row
 * the pointer was actually over always found nothing to drop.
 */
const dropHandlers = new Map<string, (agentId: string) => void>();
let windowListenersInstalled = false;

function handleWindowPointerMove(event: PointerEvent): void {
  if (!activeDrag) return;
  if (!activeDrag.moved) {
    const far =
      Math.abs(event.clientX - activeDrag.startX) > DRAG_THRESHOLD ||
      Math.abs(event.clientY - activeDrag.startY) > DRAG_THRESHOLD;
    if (!far) return;
    activeDrag.moved = true;
  }
  const target = dropTargetAt(event.clientX, event.clientY);
  setHovered(target && target.workspaceId !== activeDrag.workspaceId ? target.workspaceId : null);
}

function handleWindowPointerUp(event: PointerEvent): void {
  const drag = activeDrag;
  activeDrag = null;
  setHovered(null);
  if (!drag?.moved) return;
  const target = dropTargetAt(event.clientX, event.clientY);
  if (!target || target.workspaceId === drag.workspaceId) return;
  // A move across hosts is not a move: the agent's records live on its own daemon.
  if (drag.serverId && target.serverId && drag.serverId !== target.serverId) return;
  dropHandlers.get(target.workspaceId)?.(drag.agentId);
}

function installWindowListeners(): void {
  if (windowListenersInstalled) return;
  windowListenersInstalled = true;
  window.addEventListener("pointermove", handleWindowPointerMove);
  window.addEventListener("pointerup", handleWindowPointerUp);
}

function removeWindowListeners(): void {
  if (!windowListenersInstalled || dropHandlers.size > 0) return;
  windowListenersInstalled = false;
  window.removeEventListener("pointermove", handleWindowPointerMove);
  window.removeEventListener("pointerup", handleWindowPointerUp);
}

function registerDropHandler(workspaceId: string, handler: (agentId: string) => void): void {
  dropHandlers.set(workspaceId, handler);
  installWindowListeners();
}

function unregisterDropHandler(workspaceId: string, handler: (agentId: string) => void): void {
  if (dropHandlers.get(workspaceId) === handler) dropHandlers.delete(workspaceId);
  removeWindowListeners();
}

export function useAgentDragSource({ agentId, serverId }: AgentDragSourceInput): AgentDragSource {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const dragRef = useCallback((next: HTMLElement | null) => setNode(next), []);

  useEffect(() => {
    if (!node || !agentId) return () => {};

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      // Read the workspace now rather than holding a prop: a move made moments ago would leave a
      // stale value naming the workspace this chat has already left.
      const workspaceId =
        useSessionStore.getState().sessions[serverId ?? ""]?.agents?.get(agentId)?.workspaceId ??
        null;
      (window as unknown as { __agentDrag?: unknown }).__agentDrag = {
        phase: "down",
        agentId,
        serverId,
      };
      activeDrag = {
        agentId,
        serverId,
        workspaceId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
    };

    node.addEventListener("pointerdown", handlePointerDown);
    return () => node.removeEventListener("pointerdown", handlePointerDown);
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

  // The attribute is what a drop looks for; marking the node keeps the lookup independent of React,
  // because the drag is resolved from the window rather than from this component's tree.
  useEffect(() => {
    if (!node || !workspaceId || !onDropAgent) return () => {};
    node.setAttribute(DROP_ATTRIBUTE, workspaceId);
    if (serverId) node.setAttribute(DROP_SERVER_ATTRIBUTE, serverId);
    return () => {
      node.removeAttribute(DROP_ATTRIBUTE);
      node.removeAttribute(DROP_SERVER_ATTRIBUTE);
    };
  }, [node, onDropAgent, serverId, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !onDropAgent) return () => {};
    const listener = (hovered: string | null) => setIsOver(hovered === workspaceId);
    overListeners.add(listener);
    registerDropHandler(workspaceId, onDropAgent);
    return () => {
      overListeners.delete(listener);
      unregisterDropHandler(workspaceId, onDropAgent);
    };
  }, [onDropAgent, workspaceId]);

  return { dropRef: dropRef as unknown as (node: never) => void, isOver };
}
