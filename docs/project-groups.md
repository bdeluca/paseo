# Project groups

A project group is a bucket of projects the user defines — they create it, name it, put projects and
other project groups in it, and delete it. It is a client-side arrangement of sidebar rows: it does not change a project's
record, root, workspaces, or which daemon owns it.

The UI label is the compound **"Project group"**, and the remainder is **"Ungrouped"**. A bare
"Group" is ambiguous in this sidebar: `projectKey` already groups one logical project across hosts,
the display menu's **Grouping** row already picks project-vs-status, and status mode already sorts
workspace rows into status groups. [glossary.md](glossary.md) holds the four definitions side by
side; keep the compound in UI copy.

## Scope

Groups form a tree. A group holds subgroups and projects; a project sits in exactly one group or in
Ungrouped, which is always last, top level only, and cannot be renamed, moved, or deleted.
Membership stays exclusive: a project in two groups would be a tag, and whether tags are wanted is
still open.

Each group stores its parent (`parentId`, absent at the top level) and the list order is the sibling
order. A parent reference rather than a child list, because the flat shape is already a valid tree
— every group written before nesting loads as a top-level group with nothing rewritten — and
because one parent per group makes a group's own exclusive membership impossible to break in the
data. What a parent reference can express instead is a loop or a missing parent;
`normalizeProjectGroups` lifts such a group to the top level on every load and write, so nothing
becomes unreachable.

Inside a group, subgroups render before its own projects, the way a file tree puts folders first.
Interleaving would need a third ordering list, and no gesture could produce it: drag never crosses
a heading, and the menus move things between groups, not between rows.

Nesting stops at `MAX_PROJECT_GROUP_DEPTH` (4) levels. Each level indents its rows by 13px — the
spine's margin, rule, and padding — and a project name gets none of that back. Measured through the
real sidebar at the 200px minimum width, a project's title keeps 65px at level 2, 52px at level 3,
and 39px at level 4, where "acme-launch" (84px) already truncates to four characters; a fifth level
would leave 26px. At the default 320px and the compact 390px layout a level-4 title still keeps over
150px. The cap is enforced in the transitions (`canCreateProjectGroupIn`, `canMoveProjectGroup`), so a
move that would push a subtree past it is refused whatever calls it; the Move to page shows such a
target disabled.

A group can never move into itself or anything beneath it. `canMoveProjectGroup` refuses it, so the
guard holds for every caller, and the Move to page does not list those targets at all.

Deleting a group removes that one level: its subgroups take its place among its siblings, and its
projects join its parent's — Ungrouped for a top-level group. Everything the user built underneath
survives, and deleting a top-level group behaves exactly as it did before nesting. The confirmation
names where the contents go.

A collapsed group hides its whole subtree, keyboard shortcuts included. Each subgroup keeps its own
collapse key, so reopening a parent shows its children as they were left. A group's count is every
visible project in its subtree: a collapsed heading is all that is left of what it holds, and a group
holding only subgroups would otherwise read as empty.

Assignment is a menu, not a drag. The **Project group** submenu on a project's kebab and context
menu lists the whole tree, indented by depth (`MenuItem`'s `indentLevel`), then Ungrouped; creating a
group from there makes a top-level group and drops the project in it. A group's own kebab and its
heading's context menu render the same rows — Rename, Move up and Move down among its siblings,
Move to (the top level or another group), New project group inside, Delete — from one hook,
`useProjectGroupActionsMenu`. Native list drag cannot hand a row to another list, so a cross-group
drag on desktop would be a desktop-only path to a thing every platform needs. Web drag between
groups needs one `DndContext` hoisted over every group's list, with an `externalDndContext` escape
like `SortableInlineList` has; that is follow-up work, not part of the tree.

## Telling one from the app's own headings

The sidebar already stacks headings the app derives for itself — the status buckets and Pinned —
and they are all `foregroundMuted` text. A named project group is the one heading a person made,
so it is the one drawn in `foreground`, with a leading glyph that is not a status dot and a count
of the projects under it. Keep that separation: a project group that borrows the muted treatment
reads as a section label and stops being findable.

Its subgroups and projects carry a spine — a rule on `foregroundExtraMuted` down the left of the
block, with the rows indented past it. A subgroup nests the same block, so depth reads as spines
within spines. Membership has to survive scrolling, and a heading does not: once a group is
longer than the viewport the heading is gone and the rule is the only thing left saying which
projects belong to it. `border` was tried first and measured a 16/255 channel step against
`surfaceSidebar` in light and 17/255 in dark — a hairline that close to its background is not a
signal, so the rule uses the passive-chrome foreground token instead.

Ungrouped keeps the muted title, takes no glyph, no count and no spine, and its projects sit flush
on the sidebar's own rail — exactly where every project sat before any group existed. That is what
makes "not in a group" visible as well.

## What each sidebar mode does

Project mode renders the headings. Status mode groups workspaces and draws no project rows at all,
so it ignores project groups and leaves them stored — switching back finds them as they were.

Pinned workspaces keep their own section above everything, including workspaces belonging to a
grouped project. The label filter narrows the projects a group can show; a group it empties keeps
its heading, because the group is an entity and the filter is a view. The project filter narrows
the same way.

## Persistence boundary

Groups live in the sidebar order store (`sidebar-project-groups.ts` for the transitions,
`sidebar-order-store.ts` for persistence) beside `projectOrder`, and their collapse sits with the
other collapse keys in `sidebar-collapsed-sections-store`. Both keys are optional in the persisted
schema, so a settings blob written before project groups restores as an ungrouped sidebar.

Nesting is persist version 3. zustand runs `migrate` only on a version mismatch, so the store also
normalizes in `merge`: a current-version blob goes through the same tree invariants as an old one.
A top-level group is written without `parentId`, which keeps a sidebar that nests nothing in the
exact shape the flat build's strict schema accepts; a nested `parentId` is a key that build does not
know, and its strict schema discards the whole blob, orders included.

The feature briefly shipped as "categories", so both stores read the old key when the new one is
absent: the order store's v2 migration takes `projectCategories`, and the collapse store's merge
takes `collapsedProjectCategoryKeys` and re-spells its one literal key (`uncategorized` →
`ungrouped`). Both shims are `COMPAT(projectGroups)`-tagged with their removal date.

Do not put a group id on a project record. Project membership is server-owned and stable, while a
project group is empty-capable, order-bearing, and one person's opinion of their own sidebar.
Making it replicate across devices needs a revisioned sidebar-layout document and a protocol
capability, not a field fanned out to every client.

Ordering has two owners on purpose. A group holds the order of the projects in it; `projectOrder`
holds the order of everything, and a drag inside a group writes both, so deleting the group later
leaves its projects where the user last put them.

## Verification

Keep the no-group projection identical to the plain project view — same rows, same order, same
`sidebar-project-list` test id, no headings. `sidebar-projection.test.ts` holds that line, along
with group order, subtree counts, inherited collapse for shortcuts, and a group whose projects are
not currently visible. `sidebar-project-groups.test.ts` holds the tree invariants — the cycle guard,
the depth cap, delete reparenting. `sidebar-order-store.rehydrate.test.ts` drives the real persisted
store with flat v2 blobs. `e2e/browser/sidebar-project-groups.spec.ts` covers create, nesting,
assignment, Move to, collapse, delete, and reload through the real sidebar.
