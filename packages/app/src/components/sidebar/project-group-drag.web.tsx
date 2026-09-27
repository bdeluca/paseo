import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarProjectGroupView } from "@/components/sidebar/sidebar-projection";
import type {
  ProjectGroupDragProviderProps,
  ProjectGroupDropTarget,
} from "@/components/sidebar/project-group-drag";
import type { ProjectGroupDragPreview } from "@/components/sidebar/sidebar-projection";

const DragPreviewContext = createContext<ProjectGroupDragPreview | null>(null);

export function useProjectGroupDragPreview(): ProjectGroupDragPreview | null {
  return useContext(DragPreviewContext);
}

// A heading's droppable id. Project rows are sortable under their own view key, so the prefix is
// what tells the two apart when a drag ends over one or the other.
const DROP_PREFIX = "project-group-drop:";
const UNGROUPED_DROP_ID = `${DROP_PREFIX}ungrouped`;

function dropId(groupId: string | null): string {
  return groupId === null ? UNGROUPED_DROP_ID : `${DROP_PREFIX}${groupId}`;
}

/** The group a drop landed in, or undefined when the id is not a heading at all. */
function groupIdFromDropId(id: string): string | null | undefined {
  if (!id.startsWith(DROP_PREFIX)) return undefined;
  const suffix = id.slice(DROP_PREFIX.length);
  return suffix === "ungrouped" ? null : suffix;
}

function groupHoldingProject(
  groups: readonly SidebarProjectGroupView[],
  projectViewKey: string,
): SidebarProjectGroupView | undefined {
  return groups.find((group) =>
    group.projects.some((project: SidebarProjectEntry) => project.viewKey === projectViewKey),
  );
}

/**
 * One DndContext over every group's list, so a project row can leave the list it started in.
 *
 * Each list keeps its own SortableContext for ordering and passes `externalDndContext`, because a
 * drag can only reach droppables registered in the context that owns the sensors.
 *
 * Collision is `pointerWithin`, not `closestCenter`: headings and rows are droppables of very
 * different sizes, and the rows shift as the sortable reorders under the cursor, so nearest-centre
 * resolves a drop on a heading to whatever row happens to sit closest — usually one in the group the
 * project already belongs to, which reads as the drag doing nothing. Dropping on a
 * heading moves the project to that group; dropping on a row in another group moves it there too,
 * which is the gesture people try first; dropping on a row in its own group reorders.
 */
export function ProjectGroupDragProvider({
  groups,
  onMoveProject,
  onReorder,
  children,
}: ProjectGroupDragProviderProps) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [preview, setPreview] = useState<ProjectGroupDragPreview | null>(null);

  // The group a drag is currently over: a heading directly, or the group holding the row under the
  // pointer. Undefined means the pointer is over nothing this owns.
  const previewGroupIdFor = useCallback(
    (overId: string): string | null | undefined => {
      const headingGroupId = groupIdFromDropId(overId);
      if (headingGroupId !== undefined) return headingGroupId;
      return groupHoldingProject(groups, overId)?.id;
    },
    [groups],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const projectViewKey = String(event.active.id);
      const sourceGroup = groupHoldingProject(groups, projectViewKey);
      if (!sourceGroup) return;
      setPreview({ projectViewKey, groupId: sourceGroup.id });
    },
    [groups],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      if (!over) return;
      const groupId = previewGroupIdFor(String(over.id));
      if (groupId === undefined) return;
      setPreview({ projectViewKey: String(active.id), groupId });
    },
    [previewGroupIdFor],
  );

  const handleDragCancel = useCallback(() => setPreview(null), []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setPreview(null);
      if (!over) return;
      const projectViewKey = String(active.id);
      const overId = String(over.id);
      const sourceGroup = groupHoldingProject(groups, projectViewKey);
      if (!sourceGroup) return;

      const headingGroupId = groupIdFromDropId(overId);
      if (headingGroupId !== undefined) {
        if (headingGroupId !== sourceGroup.id) onMoveProject(projectViewKey, headingGroupId);
        return;
      }

      const targetGroup = groupHoldingProject(groups, overId);
      if (!targetGroup) return;
      if (targetGroup.id !== sourceGroup.id) {
        onMoveProject(projectViewKey, targetGroup.id);
        return;
      }
      if (overId === projectViewKey) return;

      const from = targetGroup.projects.findIndex((project) => project.viewKey === projectViewKey);
      const to = targetGroup.projects.findIndex((project) => project.viewKey === overId);
      if (from < 0 || to < 0) return;
      onReorder(targetGroup, arrayMove([...targetGroup.projects], from, to));
    },
    [groups, onMoveProject, onReorder],
  );

  const previewValue = useMemo(() => preview, [preview]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      <DragPreviewContext.Provider value={previewValue}>{children}</DragPreviewContext.Provider>
    </DndContext>
  );
}

export function useProjectGroupDropTarget(groupId: string | null): ProjectGroupDropTarget {
  const { setNodeRef, isOver } = useDroppable({ id: dropId(groupId) });
  return { dropRef: setNodeRef, isOver };
}
