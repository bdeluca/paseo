# Project categories

A category is a user-named bucket of projects in the app sidebar. It is a client-side arrangement
of rows: it does not change a project's record, root, workspaces, or which daemon owns it.

Call it a **category**. "Grouping" already means projects being the same logical project across
hosts (`projectKey`, see [glossary.md](glossary.md)), and the sidebar's display menu already spends
the word on its project/status **Grouping** decision. A third meaning would make all three
unreadable.

## Scope

One level. A category has a stable local id, a name, and an ordered list of project view keys;
projects in none of them render under Uncategorized, which is always last and cannot be renamed,
moved, or deleted. Create, rename, collapse, reorder, and delete are the whole feature.

Assignment is a menu, not a drag: the **Category** submenu on a project's kebab and context menu
moves it, and creating a category from there drops that project into what it just named. Native
list drag cannot hand a row to another list, so a cross-category drag on desktop would be a
desktop-only path to a thing every platform needs.

Deleting a category returns its projects to Uncategorized. A category never owns a project hard
enough to take it with it.

## What each sidebar mode does

Project mode renders the headings. Status mode groups workspaces and draws no project rows at all,
so it ignores categories and leaves them stored — switching back finds them as they were.

Pinned workspaces keep their own section above everything, including workspaces belonging to a
categorized project. The label filter narrows the projects a category can show; a category it
empties keeps its heading, because the category is an entity and the filter is a view. The project
filter narrows the same way.

## Persistence boundary

Categories live in the sidebar order store (`sidebar-project-categories.ts` for the transitions,
`sidebar-order-store.ts` for persistence) beside `projectOrder`, and their collapse sits with the
other collapse keys in `sidebar-collapsed-sections-store`. Both keys are optional in the persisted
schema, so a settings blob written before categories restores as an uncategorized sidebar.

Do not put a category id on a project record. Project membership is server-owned and stable, while
a category is empty-capable, order-bearing, and one person's opinion of their own sidebar. Making
it replicate across devices needs a revisioned sidebar-layout document and a protocol capability,
not a field fanned out to every client.

Ordering has two owners on purpose. A category holds the order of the projects in it; `projectOrder`
holds the order of everything, and a drag inside a category writes both, so deleting the category
later leaves its projects where the user last put them.

## Verification

Keep the no-category projection identical to today's project view — same rows, same order, same
`sidebar-project-list` test id, no headings. `sidebar-projection.test.ts` holds that line, along
with category order, the collapsed-category shortcut skip, and a category whose projects are not
currently visible. `e2e/browser/sidebar-project-categories.spec.ts` covers create, assignment,
collapse, and reload through the real sidebar.
