import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { FolderPlus } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubTrigger,
  type MenuPageDefinition,
} from "@/components/ui/dropdown-menu";
import { findProjectCategoryId } from "@/stores/sidebar-project-categories";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import type { Theme } from "@/styles/theme";

const PROJECT_CATEGORY_PAGE_ID = "project-category";

/** The submenu's two halves: the page the surface registers, and the row that opens it. */
export interface ProjectCategoryMenu {
  pages: MenuPageDefinition[];
  item: ReactElement;
}

const ThemedFolderPlus = withUnistyles(FolderPlus);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const newCategoryLeadingIcon = (
  <ThemedFolderPlus size={14} uniProps={foregroundMutedColorMapping} />
);

function CategoryOptionItem({
  categoryId,
  name,
  selected,
  testID,
  onSelect,
}: {
  categoryId: string | null;
  name: string;
  selected: boolean;
  testID: string;
  onSelect: (categoryId: string | null) => void;
}) {
  const handleSelect = useCallback(() => onSelect(categoryId), [categoryId, onSelect]);
  return (
    <DropdownMenuItem selected={selected} showSelectedCheck onSelect={handleSelect} testID={testID}>
      {name}
    </DropdownMenuItem>
  );
}

/**
 * The "Category" row on a project's menu, and the page behind it.
 *
 * One hook so the kebab and the row's context menu cannot drift — both surfaces are the same menu
 * engine, so both take the page as data and render the same trigger. The decision earns a submenu
 * because the current value is the point and a category list grows past what a root menu can hold;
 * see docs/menus.md.
 */
export function useProjectCategoryMenu(input: {
  projectViewKey: string;
  onCreateCategory: () => void;
}): ProjectCategoryMenu {
  const { t } = useTranslation();
  const categories = useSidebarOrderStore((state) => state.projectCategories);
  const moveProjectToCategory = useSidebarOrderStore((state) => state.moveProjectToCategory);
  const { projectViewKey, onCreateCategory } = input;
  const currentCategoryId = findProjectCategoryId(categories, projectViewKey);
  const currentCategoryName =
    categories.find((category) => category.id === currentCategoryId)?.name ??
    t("sidebar.projectCategory.uncategorized");

  const handleSelect = useCallback(
    (categoryId: string | null) => moveProjectToCategory(projectViewKey, categoryId),
    [moveProjectToCategory, projectViewKey],
  );

  const pages = useMemo<MenuPageDefinition[]>(
    () => [
      {
        id: PROJECT_CATEGORY_PAGE_ID,
        title: t("sidebar.projectCategory.label"),
        content: (
          <>
            {categories.map((category) => (
              <CategoryOptionItem
                key={category.id}
                categoryId={category.id}
                name={category.name}
                selected={category.id === currentCategoryId}
                testID={`sidebar-project-menu-category-${category.id}-${projectViewKey}`}
                onSelect={handleSelect}
              />
            ))}
            <CategoryOptionItem
              categoryId={null}
              name={t("sidebar.projectCategory.uncategorized")}
              selected={currentCategoryId === null}
              testID={`sidebar-project-menu-category-uncategorized-${projectViewKey}`}
              onSelect={handleSelect}
            />
            <DropdownMenuSeparator />
            <DropdownMenuItem
              leading={newCategoryLeadingIcon}
              onSelect={onCreateCategory}
              testID={`sidebar-project-menu-new-category-${projectViewKey}`}
            >
              {t("sidebar.projectCategory.actions.create")}
            </DropdownMenuItem>
          </>
        ),
      },
    ],
    [categories, currentCategoryId, handleSelect, onCreateCategory, projectViewKey, t],
  );

  const item = (
    <DropdownMenuSubTrigger
      id={PROJECT_CATEGORY_PAGE_ID}
      value={currentCategoryName}
      testID={`sidebar-project-menu-category-${projectViewKey}`}
    >
      {t("sidebar.projectCategory.label")}
    </DropdownMenuSubTrigger>
  );

  return { pages, item };
}
