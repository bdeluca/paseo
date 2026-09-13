# Project groups

A project group is a bucket of projects the user defines — they create it, name it, put projects in
it, and delete it. It is a client-side arrangement of sidebar rows: it does not change a project's
record, root, workspaces, or which daemon owns it.

The UI label is the compound **"Project group"**, and the remainder is **"Ungrouped"**. A bare
"Group" is ambiguous in this sidebar: `projectKey` already groups one logical project across hosts,
the display menu's **Grouping** row already picks project-vs-status, and status mode already sorts
workspace rows into status groups. [glossary.md](glossary.md) holds the four definitions side by
side; keep the compound in UI copy.

## Scope

One level. A group has a stable local id, a name, and an ordered list of project view keys;
projects in no group render under Ungrouped, which is always last and cannot be renamed, moved, or
deleted. Create, rename, collapse, reorder, and delete are the whole feature.

Assignment is a menu, not a drag: the **Project group** submenu on a project's kebab and context
menu moves it, and creating a group from there drops that project into what it just named. Native
list drag cannot hand a row to another list, so a cross-group drag on desktop would be a
desktop-only path to a thing every platform needs.

Deleting a group returns its projects to Ungrouped. A group never owns a project hard enough to
take it with it.

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
with group order, the collapsed-group shortcut skip, and a group whose projects are not currently
visible. `e2e/browser/sidebar-project-groups.spec.ts` covers create, assignment, collapse, and
reload through the real sidebar.
