import { useCallback, useEffect, useMemo, useState } from "react";
import { OperatorQuestionDock } from "@/components/OperatorQuestionDock";
import { ActivityRail, ActivityView } from "../features/activity/ActivityView";
import { DatabaseRail, DatabaseView } from "../features/database/DatabaseView";
import { GoalsContext, GoalsRail, GoalsView } from "../features/goals/GoalsView";
import { SettingsRail, SettingsView } from "../features/settings/SettingsView";
import { getDefaultZoraiSettingsTab, type ZoraiSettingsTabId } from "../features/settings/settingsTabs";
import { ThreadsContext } from "../features/threads/ThreadsContextPanel";
import { ThreadFilePreviewProvider } from "../features/threads/ThreadFilePreviewProvider";
import { ThreadsView } from "../features/threads/ThreadsView";
import { ThreadsRail } from "../features/threads/ThreadsRail";
import { CodeAgentPane, CodeRail, CodeView } from "../features/code/CodeView";
import { ToolsContext, ToolsRail, ToolsView } from "../features/tools/ToolsView";
import { getDefaultZoraiTool, type ZoraiToolId } from "../features/tools/tools";
import { WorkspacesRail, WorkspacesView } from "../features/workspaces/WorkspacesView";
import { contextPanelLabels, getDefaultZoraiView, normalizeZoraiToolNavigation, zoraiNavItems, type ZoraiViewId } from "./navigation";
import { ZoraiContextPanel } from "./ZoraiContextPanel";
import { ZoraiBrandMark, ZoraiHamburgerIcon, ZoraiNavIcon } from "./ZoraiIcons";
import { ZORAI_NAVIGATE_EVENT, type ZoraiNavigateDetail, type ZoraiReturnTarget } from "./zoraiNavigationEvents";

type GoalOpenRequest = {
  id: string;
  nonce: number;
};

export function ZoraiShell() {
  const [activeView, setActiveView] = useState<ZoraiViewId>(getDefaultZoraiView);
  const [activeTool, setActiveTool] = useState<ZoraiToolId>(getDefaultZoraiTool);
  const [activeSettingsTab, setActiveSettingsTab] = useState<ZoraiSettingsTabId>(getDefaultZoraiSettingsTab);
  const [activeDatabaseTable, setActiveDatabaseTable] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [contextOpen, setContextOpen] = useState(false);
  const [returnTarget, setReturnTarget] = useState<ZoraiReturnTarget | null>(null);
  const [goalOpenRequest, setGoalOpenRequest] = useState<GoalOpenRequest | null>(null);
  const activeItem = useMemo(
    () => zoraiNavItems.find((item) => item.id === activeView) ?? zoraiNavItems[0],
    [activeView],
  );
  const contextLabels = contextPanelLabels(activeView);

  useEffect(() => {
    const onNavigate = (event: Event) => {
      const detail = (event as CustomEvent<ZoraiNavigateDetail>).detail;
      const normalized = normalizeZoraiToolNavigation(detail);
      if (normalized.view) setActiveView(normalized.view);
      if (normalized.tool) setActiveTool(normalized.tool);
      if (detail.settingsTab) {
        setActiveSettingsTab(detail.settingsTab);
        if (!normalized.view) setActiveView("settings");
      }
      if (detail.toggleContext) setContextOpen((current) => !current);
      if (detail.returnTarget !== undefined) setReturnTarget(detail.returnTarget);
      if (detail.goalRunId) {
        setGoalOpenRequest((current) => ({ id: detail.goalRunId ?? "", nonce: (current?.nonce ?? 0) + 1 }));
      }
    };
    window.addEventListener(ZORAI_NAVIGATE_EVENT, onNavigate);
    return () => window.removeEventListener(ZORAI_NAVIGATE_EVENT, onNavigate);
  }, []);

  const selectView = (view: ZoraiViewId) => {
    setActiveView(view);
    setReturnTarget(null);
  };
  const returnToTarget = () => {
    if (!returnTarget) return;
    if (returnTarget.goalRunId) {
      setGoalOpenRequest((current) => ({ id: returnTarget.goalRunId ?? "", nonce: (current?.nonce ?? 0) + 1 }));
    }
    setActiveView(returnTarget.view);
    setReturnTarget(null);
  };
  const selectDatabaseTable = useCallback((tableName: string) => {
    setActiveDatabaseTable(tableName);
  }, []);

  return (
    <ThreadFilePreviewProvider>
      <div className={["zorai-shell", railOpen ? "" : "zorai-shell--rail-collapsed"].filter(Boolean).join(" ")}>
        <nav className="zorai-global-rail" aria-label="Zorai navigation">
          <div className="zorai-brand" title="Zorai">
            <ZoraiBrandMark />
          </div>
          <div className="zorai-global-items">
            {zoraiNavItems.map((item) => (
              <button
                type="button"
                key={item.id}
                className={[
                  "zorai-global-item",
                  item.id === activeView ? "zorai-global-item--active" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => selectView(item.id)}
                title={item.label}
                aria-label={item.label}
              >
                <ZoraiNavIcon icon={item.icon} />
              </button>
            ))}
          </div>
        </nav>

        <aside
          className={["zorai-contextual-rail", railOpen ? "" : "zorai-contextual-rail--collapsed"].filter(Boolean).join(" ")}
          aria-label={activeItem.railLabel}
        >
          <div className="zorai-rail-heading">
            <button
              type="button"
              className="zorai-icon-button zorai-rail-toggle"
              onClick={() => setRailOpen((open) => !open)}
              aria-expanded={railOpen}
              aria-controls="zorai-contextual-rail-body"
              title={railOpen ? "Collapse sidebar" : "Expand sidebar"}
              aria-label={railOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
              <ZoraiHamburgerIcon />
            </button>
            <div className="zorai-kicker">{activeItem.label}</div>
          </div>
          <div id="zorai-contextual-rail-body" className="zorai-rail-body" hidden={!railOpen}>
            {renderRail(activeView, activeTool, setActiveTool, activeSettingsTab, setActiveSettingsTab, activeDatabaseTable, selectDatabaseTable)}
          </div>
        </aside>

        <main className="zorai-main">
          <div className="zorai-main-body">{renderMain(activeView, activeTool, setActiveTool, activeSettingsTab, setActiveSettingsTab, goalOpenRequest, activeDatabaseTable, selectDatabaseTable, returnTarget, returnToTarget)}</div>
          <OperatorQuestionDock />
        </main>

        <ZoraiContextPanel
          title={contextLabels.title}
          subtitle={contextLabels.title === activeItem.railLabel ? undefined : activeItem.railLabel}
          collapsedLabel={contextLabels.collapsed}
          open={contextOpen}
          onToggle={() => setContextOpen((current) => !current)}
        >
          {renderContext(activeView, activeTool, setActiveTool)}
        </ZoraiContextPanel>
      </div>
    </ThreadFilePreviewProvider>
  );
}

function renderRail(
  view: ZoraiViewId,
  activeTool: ZoraiToolId,
  setActiveTool: (toolId: ZoraiToolId) => void,
  activeSettingsTab: ZoraiSettingsTabId,
  setActiveSettingsTab: (tabId: ZoraiSettingsTabId) => void,
  activeDatabaseTable: string | null,
  setActiveDatabaseTable: (tableName: string) => void,
) {
  if (view === "code") return <CodeRail />;
  if (view === "threads") return <ThreadsRail />;
  if (view === "goals") return <GoalsRail />;
  if (view === "workspaces") return <WorkspacesRail />;
  if (view === "database") return <DatabaseRail activeTable={activeDatabaseTable} onSelectTable={setActiveDatabaseTable} />;
  if (view === "tools") return <ToolsRail activeTool={activeTool} onSelectTool={setActiveTool} />;
  if (view === "activity") return <ActivityRail />;
  return <SettingsRail activeTab={activeSettingsTab} onSelectTab={setActiveSettingsTab} />;
}

function renderMain(
  view: ZoraiViewId,
  activeTool: ZoraiToolId,
  setActiveTool: (toolId: ZoraiToolId) => void,
  activeSettingsTab: ZoraiSettingsTabId,
  setActiveSettingsTab: (tabId: ZoraiSettingsTabId) => void,
  goalOpenRequest: GoalOpenRequest | null,
  activeDatabaseTable: string | null,
  setActiveDatabaseTable: (tableName: string) => void,
  returnTarget: ZoraiReturnTarget | null,
  onReturnTarget: () => void,
) {
  if (view === "code") return <CodeView />;
  if (view === "threads") return <ThreadsView returnTarget={returnTarget} onReturnTarget={onReturnTarget} />;
  if (view === "goals") return <GoalsView openGoalRunRequest={goalOpenRequest} returnTarget={returnTarget} onReturnTarget={onReturnTarget} />;
  if (view === "workspaces") return <WorkspacesView />;
  if (view === "database") return <DatabaseView activeTable={activeDatabaseTable} onSelectTable={setActiveDatabaseTable} />;
  if (view === "tools") return <ToolsView activeTool={activeTool} onSelectTool={setActiveTool} />;
  if (view === "activity") return <ActivityView />;
  return <SettingsView activeTab={activeSettingsTab} onSelectTab={setActiveSettingsTab} />;
}

function renderContext(
  view: ZoraiViewId,
  activeTool: ZoraiToolId,
  setActiveTool: (toolId: ZoraiToolId) => void,
) {
  if (view === "code") return <CodeAgentPane />;
  if (view === "threads") return <ThreadsContext />;
  if (view === "goals") return <GoalsContext />;
  if (view === "tools") return <ToolsContext activeTool={activeTool} onSelectTool={setActiveTool} />;
  return <GenericContext view={view} />;
}

function GenericContext({ view }: { view: ZoraiViewId }) {
  const item = zoraiNavItems.find((entry) => entry.id === view) ?? zoraiNavItems[0];
  return (
    <div className="zorai-context-summary">
      <div className="zorai-section-label">{item.label}</div>
      <div className="zorai-context-block">
        <strong>{item.railLabel}</strong>
        <span>{item.description}</span>
      </div>
    </div>
  );
}
