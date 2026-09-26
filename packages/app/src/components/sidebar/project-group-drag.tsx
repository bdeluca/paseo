import type { ReactNode } from "react";
import type { SidebarProjectEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarProjectGroupView } from "@/components/sidebar/sidebar-projection";

export interface ProjectGroupDragProviderProps {
  /** Every group on screen, flattened, so a drop can name the group it landed in. */
  groups: SidebarProjectGroupView[];
  onMoveProject: (projectViewKey: string, groupId: string | null) => void;
  onReorder: (group: SidebarProjectGroupView, projects: SidebarProjectEntry[]) => void;
  children: ReactNode;
}

export interface ProjectGroupDropTarget {
  /**
   * Web: the dnd-kit droppable node ref, which react-native-web hands the DOM node. Native has
   * nothing to attach, so the field is absent rather than a no-op function.
   */
  dropRef?: (node: never) => void;
  isOver: boolean;
}

/**
 * Native has no cross-list drag: a long-press drag belongs to the list that started it, so
 * assignment stays the Project group submenu. The provider is the identity here, and headings
 * register no drop target.
 */
export function ProjectGroupDragProvider({ children }: ProjectGroupDragProviderProps): ReactNode {
  return children;
}

export function useProjectGroupDropTarget(_groupId: string | null): ProjectGroupDropTarget {
  return { isOver: false };
}
