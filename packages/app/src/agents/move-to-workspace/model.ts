/**
 * The picker's data, kept free of the session store so both the option list and the
 * carried-subagent count can be tested against plain records.
 */

export interface MoveWorkspaceCandidate {
  id: string;
  name: string;
  title?: string | null;
  projectDisplayName: string;
  projectCustomName?: string | null;
  archivingAt?: string | null;
}

export interface MoveWorkspaceOption {
  workspaceId: string;
  label: string;
  projectName: string;
}

export interface CarriedSubagentInput {
  id: string;
  parentAgentId: string | null;
  workspaceId?: string;
  archivedAt?: Date | null;
}

function resolveWorkspaceLabel(workspace: MoveWorkspaceCandidate): string {
  return workspace.title?.trim() || workspace.name;
}

function resolveProjectName(workspace: MoveWorkspaceCandidate): string {
  return workspace.projectCustomName?.trim() || workspace.projectDisplayName;
}

/**
 * Workspaces the agent can be moved to: everything except the one that already owns
 * it and anything being archived, since the daemon refuses an archived target.
 * Ordered by project so the list reads the way the sidebar does.
 */
export function buildMoveWorkspaceOptions(input: {
  workspaces: readonly MoveWorkspaceCandidate[];
  currentWorkspaceId: string | null;
}): MoveWorkspaceOption[] {
  const options: MoveWorkspaceOption[] = [];
  for (const workspace of input.workspaces) {
    if (workspace.id === input.currentWorkspaceId) continue;
    if (workspace.archivingAt) continue;
    options.push({
      workspaceId: workspace.id,
      label: resolveWorkspaceLabel(workspace),
      projectName: resolveProjectName(workspace),
    });
  }

  options.sort((left, right) => {
    const byProject = left.projectName.localeCompare(right.projectName);
    return byProject !== 0 ? byProject : left.label.localeCompare(right.label);
  });
  return options;
}

/**
 * How many subagents the move will carry, by the daemon's rule: every descendant that
 * shares the moved agent's workspace, judged against that one source workspace.
 * Mirrors `cascadeMoveChildren` in packages/server/src/server/agent/agent-manager.ts —
 * the count is shown before the user commits, so it has to agree with what the daemon
 * will actually do.
 */
export function countCarriedSubagents(input: {
  agents: readonly CarriedSubagentInput[];
  agentId: string;
  sourceWorkspaceId: string | undefined;
}): number {
  const childrenByParent = new Map<string, CarriedSubagentInput[]>();
  for (const agent of input.agents) {
    if (!agent.parentAgentId) continue;
    const siblings = childrenByParent.get(agent.parentAgentId);
    if (siblings) {
      siblings.push(agent);
    } else {
      childrenByParent.set(agent.parentAgentId, [agent]);
    }
  }

  const visited = new Set<string>([input.agentId]);
  const queue = [input.agentId];
  let carried = 0;

  while (queue.length > 0) {
    const parentId = queue.shift();
    if (!parentId) break;
    for (const child of childrenByParent.get(parentId) ?? []) {
      if (visited.has(child.id)) continue;
      if (isCrossWorkspaceChild(input.sourceWorkspaceId, child.workspaceId)) continue;
      visited.add(child.id);
      carried += 1;
      queue.push(child.id);
    }
  }

  return carried;
}

function isCrossWorkspaceChild(
  sourceWorkspaceId: string | undefined,
  childWorkspaceId: string | undefined,
): boolean {
  return (
    sourceWorkspaceId !== undefined &&
    childWorkspaceId !== undefined &&
    sourceWorkspaceId !== childWorkspaceId
  );
}
