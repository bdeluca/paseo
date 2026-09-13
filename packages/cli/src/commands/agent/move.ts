import type { Command } from "commander";
import type { WorkspaceDescriptorPayload } from "@getpaseo/protocol/messages";
import { connectToDaemon, resolveAgentId } from "../../utils/client.js";
import type { CommandError, CommandOptions, ListResult, OutputSchema } from "../../output/index.js";

/** One moved agent. Subagents carried with it are counted, not listed. */
export interface AgentMoveResult {
  agentId: string;
  fromWorkspaceId: string | null;
  toWorkspaceId: string;
  subagentsMoved: number;
}

export const moveSchema: OutputSchema<AgentMoveResult> = {
  idField: "agentId",
  columns: [
    { header: "AGENT ID", field: "agentId" },
    { header: "FROM", field: "fromWorkspaceId" },
    { header: "TO", field: "toWorkspaceId" },
    { header: "SUBAGENTS", field: "subagentsMoved", align: "right" },
  ],
};

export interface AgentMoveOptions extends CommandOptions {
  workspace?: string;
}

export function addMoveOptions(cmd: Command): Command {
  return cmd
    .description("Move agents to another workspace")
    .argument("<id...>", "Agent ID, prefix, or name")
    .requiredOption("--workspace <id>", "Target workspace ID or name");
}

export function resolveWorkspace(
  query: string,
  workspaces: WorkspaceDescriptorPayload[],
): WorkspaceDescriptorPayload {
  const exact = workspaces.find((workspace) => workspace.id === query);
  if (exact) {
    return exact;
  }

  const normalized = query.toLowerCase();
  const byName = workspaces.filter((workspace) => workspace.name.toLowerCase() === normalized);
  if (byName.length === 1 && byName[0]) {
    return byName[0];
  }
  if (byName.length > 1) {
    throw {
      code: "AMBIGUOUS_WORKSPACE",
      message: `Workspace name matches ${byName.length} workspaces: ${query}`,
      details: `Use one of these IDs: ${byName.map((workspace) => workspace.id).join(", ")}`,
    } satisfies CommandError;
  }

  throw {
    code: "WORKSPACE_NOT_FOUND",
    message: `Workspace not found: ${query}`,
    details: 'Use "paseo workspace ls" to list workspaces',
  } satisfies CommandError;
}

interface AgentLike {
  id: string;
  title?: string | null;
}

/**
 * Every ID is resolved before the first move so a typo in the last argument
 * cannot leave the earlier agents moved and the rest behind.
 */
export function resolveMoveTargets(idArgs: string[], agents: AgentLike[]): string[] {
  const resolved: string[] = [];
  for (const idArg of idArgs) {
    const agentId = resolveAgentId(idArg, agents);
    if (!agentId) {
      throw {
        code: "AGENT_NOT_FOUND",
        message: `Agent not found: ${idArg}`,
        details: 'Use "paseo ls" to list available agents',
      } satisfies CommandError;
    }
    if (!resolved.includes(agentId)) {
      resolved.push(agentId);
    }
  }
  return resolved;
}

async function listWorkspaces(
  client: Awaited<ReturnType<typeof connectToDaemon>>,
): Promise<WorkspaceDescriptorPayload[]> {
  const workspaces: WorkspaceDescriptorPayload[] = [];
  let cursor: string | undefined;
  do {
    const payload = await client.fetchWorkspaces({
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    workspaces.push(...payload.entries);
    cursor = payload.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return workspaces;
}

export async function runMoveCommand(
  idArgs: string[],
  options: AgentMoveOptions,
  _command: Command,
): Promise<ListResult<AgentMoveResult>> {
  const workspaceQuery = options.workspace?.trim();
  if (!workspaceQuery) {
    throw {
      code: "MISSING_WORKSPACE",
      message: "Target workspace is required",
      details: "Usage: paseo agent move <id...> --workspace <id-or-name>",
    } satisfies CommandError;
  }

  const client = await connectToDaemon({ target: options.daemonTarget });
  const moved: AgentMoveResult[] = [];

  try {
    // COMPAT(agentWorkspaceMove): added in v0.8.1, remove gate after 2027-03-13.
    if (client.getLastServerInfoMessage()?.features?.agentWorkspaceMove !== true) {
      throw {
        code: "DAEMON_UPDATE_REQUIRED",
        message: "Update the host to move agents between workspaces.",
      } satisfies CommandError;
    }

    const payload = await client.fetchAgents({ filter: { includeArchived: true } });
    const agentIds = resolveMoveTargets(
      idArgs,
      payload.entries.map((entry) => entry.agent),
    );
    const workspace = resolveWorkspace(workspaceQuery, await listWorkspaces(client));

    for (const agentId of agentIds) {
      const result = await client.moveAgentToWorkspace(agentId, workspace.id);
      moved.push({
        agentId,
        fromWorkspaceId: result.previousWorkspaceId,
        toWorkspaceId: workspace.id,
        subagentsMoved: Math.max(result.movedAgentIds.length - 1, 0),
      });
    }

    return { type: "list", data: moved, schema: moveSchema };
  } catch (err) {
    if (err && typeof err === "object" && "code" in err) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw {
      code: "MOVE_FAILED",
      message: `Failed to move agent: ${message}`,
      ...(moved.length > 0
        ? { details: `Already moved: ${moved.map((entry) => entry.agentId).join(", ")}` }
        : {}),
    } satisfies CommandError;
  } finally {
    await client.close().catch(() => undefined);
  }
}
