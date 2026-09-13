import type { Command } from "commander";
import type { WorkspaceDescriptorPayload } from "@getpaseo/protocol/messages";
import { connectToDaemon, resolveAgentId } from "../../utils/client.js";
import type {
  CommandError,
  CommandOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";

interface AgentMoveResult {
  agentId: string;
  workspaceId: string;
  previousWorkspaceId: string | null;
  /** The moved agent plus the descendants carried with it. */
  movedAgents: number;
}

const moveSchema: OutputSchema<AgentMoveResult> = {
  idField: "agentId",
  columns: [
    { header: "AGENT ID", field: "agentId" },
    { header: "WORKSPACE ID", field: "workspaceId" },
    { header: "FROM", field: "previousWorkspaceId" },
    { header: "MOVED", field: "movedAgents" },
  ],
};

export interface AgentMoveOptions extends CommandOptions {
  workspace?: string;
}

export function addMoveOptions(command: Command): Command {
  return command
    .description("Move an agent and its subagents to another workspace")
    .argument("<id>", "Agent ID (or prefix)")
    .requiredOption("--workspace <id>", "Target workspace ID or name");
}

export function resolveWorkspaceId(
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
      details: byName.map((workspace) => workspace.id).join(", "),
    } satisfies CommandError;
  }

  throw {
    code: "WORKSPACE_NOT_FOUND",
    message: `Workspace not found: ${query}`,
    details: 'Use "paseo workspace ls" to list workspaces',
  } satisfies CommandError;
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
  agentIdArg: string,
  options: AgentMoveOptions,
  _command: Command,
): Promise<SingleResult<AgentMoveResult>> {
  const workspaceQuery = options.workspace?.trim();
  if (!workspaceQuery) {
    throw {
      code: "MISSING_WORKSPACE",
      message: "Target workspace is required",
      details: "Usage: paseo agent move <id> --workspace <id>",
    } satisfies CommandError;
  }

  const client = await connectToDaemon({ target: options.daemonTarget });

  try {
    // COMPAT(agentWorkspaceMove): added in v0.8.1, remove gate after 2027-03-13.
    if (client.getLastServerInfoMessage()?.features?.agentWorkspaceMove !== true) {
      throw {
        code: "DAEMON_UPDATE_REQUIRED",
        message: "Update the host to move agents between workspaces.",
      } satisfies CommandError;
    }

    const payload = await client.fetchAgents({ filter: { includeArchived: true } });
    const agentId = resolveAgentId(
      agentIdArg,
      payload.entries.map((entry) => entry.agent),
    );
    if (!agentId) {
      throw {
        code: "AGENT_NOT_FOUND",
        message: `Agent not found: ${agentIdArg}`,
      } satisfies CommandError;
    }

    const workspace = resolveWorkspaceId(workspaceQuery, await listWorkspaces(client));
    const result = await client.moveAgentToWorkspace(agentId, workspace.id);

    return {
      type: "single",
      data: {
        agentId,
        workspaceId: workspace.id,
        previousWorkspaceId: result.previousWorkspaceId,
        movedAgents: result.movedAgentIds.length,
      },
      schema: moveSchema,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
