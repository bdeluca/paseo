/**
 * @vitest-environment jsdom
 */
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MoveToWorkspaceSheet } from "./move-to-workspace-sheet";
import type { MoveWorkspaceOption } from "./model";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
    borderRadius: { md: 6 },
    fontSize: { sm: 13, base: 15 },
    colors: { foreground: "#fff", foregroundMuted: "#aaa" },
  },
}));

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  withUnistyles:
    (Component: React.ComponentType<Record<string, unknown>>) => (props: Record<string, unknown>) =>
      React.createElement(Component, props),
}));

vi.mock("@/components/ui/loading-spinner", () => ({
  LoadingSpinner: () => React.createElement("span", { "data-testid": "move-pending-spinner" }),
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: ({
    title,
    description,
    testID,
  }: {
    title?: string;
    description?: ReactNode;
    testID?: string;
  }) =>
    React.createElement("div", { "data-testid": testID }, [
      React.createElement("strong", { key: "title" }, title),
      React.createElement("span", { key: "description" }, description),
    ]),
}));

function SheetSearchInput({
  search,
}: {
  search: { onChange: (value: string) => void; placeholder?: string; testID?: string };
}) {
  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => search.onChange(event.target.value),
    [search],
  );
  return (
    <input data-testid={search.testID} placeholder={search.placeholder} onChange={handleChange} />
  );
}

vi.mock("@/components/adaptive-modal-sheet", () => ({
  AdaptiveModalSheet: ({
    visible,
    header,
    children,
    testID,
  }: {
    visible: boolean;
    header?: {
      title: string;
      subtitle?: ReactNode;
      search?: { onChange: (value: string) => void; placeholder?: string; testID?: string };
    };
    children: ReactNode;
    testID?: string;
  }) =>
    visible ? (
      <section data-testid={testID}>
        <h1>{header?.title}</h1>
        {header?.subtitle}
        {header?.search ? <SheetSearchInput search={header.search} /> : null}
        {children}
      </section>
    ) : null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  return actual;
});

afterEach(cleanup);

const OPTIONS: MoveWorkspaceOption[] = [
  { workspaceId: "ws-1", label: "Fix the importer", projectName: "paseo" },
  { workspaceId: "ws-2", label: "Release prep", projectName: "paseo" },
];

function renderSheet(overrides: Partial<React.ComponentProps<typeof MoveToWorkspaceSheet>> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <MoveToWorkspaceSheet
      visible
      agentLabel="Importer agent"
      options={OPTIONS}
      carriedSubagentCount={0}
      pendingWorkspaceId={null}
      error={null}
      onSelect={onSelect}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onSelect, onClose };
}

describe("MoveToWorkspaceSheet", () => {
  it("reports the chosen workspace to the caller", () => {
    const { onSelect } = renderSheet();
    fireEvent.click(screen.getByTestId("move-to-workspace-option-ws-2"));
    expect(onSelect).toHaveBeenCalledWith("ws-2");
  });

  it("states how many subagents come along before a target is chosen", () => {
    renderSheet({ carriedSubagentCount: 66 });
    expect(
      screen.getByText('agents.moveToWorkspace.carriesMany:{"name":"Importer agent","count":66}'),
    ).toBeTruthy();
  });

  it("uses the singular wording for one subagent", () => {
    renderSheet({ carriedSubagentCount: 1 });
    expect(
      screen.getByText('agents.moveToWorkspace.carriesOne:{"name":"Importer agent"}'),
    ).toBeTruthy();
  });

  it("marks the chosen row pending and stops taking presses while the move is in flight", () => {
    const { onSelect } = renderSheet({ pendingWorkspaceId: "ws-1" });
    expect(screen.getByTestId("move-pending-spinner")).toBeTruthy();
    fireEvent.click(screen.getByTestId("move-to-workspace-option-ws-2"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps a failure on screen with the target still choosable", () => {
    const { onSelect } = renderSheet({ error: "Workspace not found: ws-2" });
    const alert = screen.getByTestId("move-to-workspace-error");
    expect(alert.textContent).toContain("Workspace not found: ws-2");
    fireEvent.click(screen.getByTestId("move-to-workspace-option-ws-1"));
    expect(onSelect).toHaveBeenCalledWith("ws-1");
  });

  it("filters the list by workspace or project name", () => {
    renderSheet();
    fireEvent.change(screen.getByTestId("move-to-workspace-search"), {
      target: { value: "release" },
    });
    expect(screen.queryByTestId("move-to-workspace-option-ws-1")).toBeNull();
    expect(screen.getByTestId("move-to-workspace-option-ws-2")).toBeTruthy();
  });

  it("says so when a search matches nothing", () => {
    renderSheet();
    fireEvent.change(screen.getByTestId("move-to-workspace-search"), {
      target: { value: "nothing" },
    });
    expect(screen.getByTestId("move-to-workspace-empty").textContent).toBe(
      "agents.moveToWorkspace.noMatches",
    );
  });

  it("says so when the host has no other workspace", () => {
    renderSheet({ options: [] });
    expect(screen.getByTestId("move-to-workspace-empty").textContent).toBe(
      "agents.moveToWorkspace.empty",
    );
  });
});
