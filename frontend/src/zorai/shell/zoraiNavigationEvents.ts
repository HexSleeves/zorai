import type { ZoraiSettingsTabId } from "../features/settings/settingsTabs";
import type { ZoraiToolId } from "../features/tools/tools";
import type { ZoraiViewId } from "./navigation";

export const ZORAI_NAVIGATE_EVENT = "zorai-navigate";
export const ZORAI_FOCUS_SEARCH_EVENT = "zorai-focus-search";

export type ZoraiReturnTarget = {
  view: ZoraiViewId;
  label: string;
  goalRunId?: string | null;
};

export type ZoraiNavigateDetail = {
  view?: ZoraiViewId;
  tool?: ZoraiToolId;
  settingsTab?: ZoraiSettingsTabId;
  toggleContext?: boolean;
  focusSearch?: boolean;
  returnTarget?: ZoraiReturnTarget | null;
  goalRunId?: string | null;
};

let pendingFocusSearch = false;

export function consumePendingFocusSearch(): boolean {
  if (!pendingFocusSearch) return false;
  pendingFocusSearch = false;
  return true;
}

export function navigateZorai(detail: ZoraiNavigateDetail) {
  if (detail.focusSearch) pendingFocusSearch = true;
  window.dispatchEvent(new CustomEvent<ZoraiNavigateDetail>(ZORAI_NAVIGATE_EVENT, { detail }));
  if (detail.focusSearch) {
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(ZORAI_FOCUS_SEARCH_EVENT));
    }, 0);
  }
}
