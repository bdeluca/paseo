# Proposal: moving an agent between workspaces

Review artifact for the `agent-move-workspace` branch. It settles the semantics before the code.
It is not a `docs/` subject doc — the rules that survive review get integrated into
[`docs/agent-lifecycle.md`](docs/agent-lifecycle.md), which already owns archive, parentage and
subagent semantics.

Upstream demand: discussion #3270 (move a live session, 6 upvotes), discussion #3453 (the
workspace→project sibling), issue #2620 (closed by `paseo-bot` because feature requests are not
accepted as issues, not because it was resolved), bug #4707 (the accidental move that exists today).

## The one existing reassignment, and why it is a bug

`workspaceId` is mutable on the record but no user-facing surface writes it. Exactly one code path
reassigns it, as a side effect of something else:

- `packages/server/src/server/agent/import-sessions.ts:230` — the already-registered-archived branch
  calls `unarchiveAgentState(..., { workspaceId })` with the caller's workspace.
- `packages/server/src/server/agent/agent-manager.ts:2192` — `unarchiveSnapshotUnlocked` applies it:
  `...(updates?.workspaceId ? { workspaceId: updates.workspaceId } : {})`.
- `packages/app/src/components/import-session-sheet.tsx:597` sends the currently open workspace via
  `resolveImportTarget`, so on desktop this fires by default.

The re-home is invisible because it can only happen between workspaces that already share a
directory: `runInImportWorkspace`
(`packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.ts:100`)
rejects a requested workspace whose `cwd` does not match the import cwd. So the agent does not move
somewhere obviously wrong — it moves to a sibling workspace on the same folder, which is precisely
the case a user cannot see in the sidebar until their subagent track is empty.

## Q1 — What should importing an already-registered archived session do?

**Restore the record to its own `workspaceId`. Import never re-homes.**

- `docs/data-model.md` calls `workspaceId` "the single source of ownership … Every agent is stamped
  with one at create time". Ownership is a property of the record, not of the client that happened to
  revive it.
- Import is a revival, not an organisational gesture. The caller's `workspaceId` on
  `import_agent_request` expresses _where to place a session Paseo has never seen_; for a record that
  already exists, placement was decided at creation and the request carries no evidence the user
  wants it changed.
- #4707's stated expectation is exactly this ("the agent is unarchived back into workspace A").

What stays: for a session with no matching record, `workspaceId` still selects placement through
`runInImportWorkspace`. That branch is untouched. Per `docs/protocol-compatibility.md` ("A field you
stop sending stays accepted"), the wire field is not removed or narrowed; the archived branch simply
stops writing it.

The desktop's own `crossWorkspace` bookkeeping already knows how to send the user to another
workspace after an import, so the app needs no change to behave correctly once the daemon stops
re-homing: the agent comes back in workspace A and the sheet reports a cross-workspace landing.

## Q2 — What makes a move explicit?

A dedicated RPC that does nothing else.

```
agent.workspace.move.request  { agentId, workspaceId, requestId }
agent.workspace.move.response { payload: { requestId, agentId, accepted, error, ... } }
```

- Dotted namespace with a verb operation segment, per `docs/rpc-namespacing.md`
  (`agent` domain → `workspace` segment → `move` verb → direction). This is also the exact name
  #3270 asked for.
- Gated by `server_info.features.agentWorkspaceMove`, tagged `COMPAT(agentWorkspaceMove)`, per
  `docs/protocol-compatibility.md`: no fallback path, no simulation over `import_agent_request`.
- Surfaces: `paseo agent move <id> --workspace <id>` (CLI). The RPC and the client method are the
  contract; an app menu item can follow without further protocol work.

Distinguishability is then structural rather than a flag: a restore is `unarchive` and cannot change
ownership; a move is `agent.workspace.move` and changes nothing but ownership.

## Q3 — Does the subagent tree move?

**Yes. The move carries every descendant that is not already cross-workspace.**

Membership is the `paseo.parent-agent-id` label (`docs/agent-lifecycle.md`, `PARENT_AGENT_ID_LABEL`),
and the product already branches on exactly the same-workspace/cross-workspace distinction in two
places:

- `shouldDetachFromArchivedParent` (`agent-manager.ts:672`) detaches a cross-workspace child on
  parent archive and cascade-archives a same-workspace one.
- Workspace activity (`docs/agent-lifecycle.md`): "Root agents and cross-workspace subagents
  contribute their normal state bucket to their own workspace. Same-workspace descendants contribute
  `running` to the nearest ancestor in that workspace."

So moving a parent alone silently converts every same-workspace child into a cross-workspace child,
which changes both the archive cascade and status aggregation for the whole tree. That is the loss
#4707 describes ("the parent thread is now stranded in the wrong workspace, separated from its own
subagent tree", 66 subagents). Carrying the same-workspace subtree preserves both invariants; leaving
an already-cross-workspace child alone preserves the third (a child deliberately placed elsewhere
stays elsewhere).

The rule reuses the existing predicate rather than inventing a second one: a child moves iff it is
**not** cross-workspace relative to the parent's pre-move workspace — the same test
`shouldDetachFromArchivedParent` makes. Recursion matches the archive cascade, which recurses through
`archiveAgentUnlocked → cascadeArchiveChildren`.

Archived descendants move too. A parent's same-workspace children are archived _by_ the cascade, so
skipping them would strand the tree the moment the parent is unarchived.

What the data model allows, measured:

- Each child carries its own mutable `workspaceId`; nothing keys storage by workspace. Agent files
  live at `$PASEO_HOME/agents/{sanitized-cwd}/{id}.json` (`docs/data-model.md`), so ownership changes
  move no files.
- `AgentStorage.listByWorkspace` (`agent-storage.ts:142`) filters records at read time, so there is
  no index to keep consistent, and no migration is needed — `docs/data-model.md` states there is no
  migration framework.

## Q4 — Is a move legal when the two workspaces have different `cwd`s?

**Yes, and `cwd` is not touched.**

`agent-manager.ts:377` states the contract in the code: _"cwd answers 'where does it run',
workspaceId answers 'which workspace owns it'."_ `docs/agent-lifecycle.md` adds "Ownership is never
derived from `cwd` — many workspaces may share one directory", and `CreateAgentOptions.workspaceId`
is already chosen independently of `cwd`.

Moving ownership therefore cannot relocate a running process, and the move does not try: the agent
keeps running where it always did. #2620 reaches the same conclusion ("moving ownership shouldn't
relocate where the process runs"). #3270 wants a live session to continue _in a new worktree_, which
is a different operation — changing `cwd` means restarting the provider under a new directory, and
#3270 itself asks for the move to happen "without restarting the provider process". Those two wishes
are incompatible; this proposal implements the one that is coherent, and leaves `cwd` alone.

The `cwd`-match check in `runInImportWorkspace` is **not** adopted as a move guard. It is an import
placement rule (an imported session must land in a workspace for that session's directory), not an
ownership law.

Guards that do apply, matching #3270's "target workspace must exist and be active; clear error
otherwise" and `runInImportWorkspace`'s own validation:

- target workspace exists and is not archived;
- its project exists and is not archived;
- moving to the workspace the agent already owns is a no-op that reports success.

Cross-project moves are permitted. An agent record has no `projectId` — project membership is derived
through the workspace — so nothing in the data model forbids it. A UI picker may scope itself to the
current project (as #2620 suggests) without the RPC needing that restriction.

## Q5 — Running agent versus archived agent

**Both move, and a turn in flight does not block the move.**

- **Live agent.** The in-memory `ManagedAgent.workspaceId` must be updated as well as the record.
  This is forced by the storage projection: `AgentStorage.applySnapshot` (`agent-storage.ts:240`)
  rebuilds the record from the live agent through `toStoredAgentRecord`
  (`agent-projections.ts:63`, which copies `workspaceId: agent.workspaceId`) and preserves only
  `archivedAt` from the existing record. A registry-only write — the shape `unarchiveSnapshot` uses —
  would be silently reverted by the next snapshot flush. `unarchiveSnapshot` gets away with it only
  because it closes the runtime first (`agent-manager.ts:2186`).
- **Turn in flight.** #2620 proposed disallowing it. Reading every `workspaceId` reader in
  `packages/server/src/server/` (31 sites) finds none inside the provider turn loop: they are
  read-time projections — workspace status and placement (`session.ts:5023`, `5073`, `7215`, `7318`,
  `7384`), workspace archive teardown (`workspace-archive-service.ts:470`), the directory listing
  (`workspace-directory.ts:706`), the agent-updates projection
  (`session/agent-updates/agent-updates-service.ts:303`), the plugin lifecycle payload
  (`plugins/lifecycle/index.ts:84`), and the MCP caller-workspace inheritance
  (`agent/tools/paseo-tools.ts:681`). Nothing caches it for the duration of a turn, so a move during
  a turn re-buckets the status on the next emission and nothing else. The move still runs through
  `runLifecycleMutation`, so it cannot interleave with archive, close, or resume.
- **Archived agent.** Moves without unarchiving. `archivedAt` and `workspaceId` are orthogonal
  fields, and keeping them orthogonal is what lets a user repair #4707 damage without reviving the
  agent.

Emission: the move notifies the agent and then emits workspace updates for both the source and the
target workspace, since a workspace's status is an aggregate over its agents. `handleDetachAgentRequest`
(`session.ts:3165`) is the working example of collecting an affected-workspace set and flushing it.

## Open question

None that blocks the work. The one judgement call worth flagging for a reviewer is Q4's refusal of
#3270's `cwd` option: that request wants a live session to continue inside a newly created worktree,
and ownership-only movement does not deliver that. Relocating a live agent's `cwd` is a separate
feature (it requires a provider restart) and should be proposed on its own.

## Shipping

Two changes, two pull requests:

1. **The #4707 fix.** A bug fix against current behaviour, reviewable on its own, with no protocol
   change and no feature gate. It should not wait behind a feature.
2. **The move operation.** Adds protocol, a feature gate, a server handler and a CLI surface.

They are ordered: the fix removes the accidental move, the feature adds the deliberate one. Landing
the feature first would leave the bug live for the length of the second review, and landing only the
fix leaves users with no way to move an agent — which is the state #2620 complains about.
