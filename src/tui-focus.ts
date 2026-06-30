export type SidebarReturnFocusAction = "none" | "clear-pending" | "focus-prompt";

export type PendingSidebarRefocus = {
  parentSessionID: string;
  childSessionID: string;
  childRowID: string;
  showCompletedHistory?: boolean;
  sidebarScrollTop?: number;
  sidebarScrollAnchor?: {
    childIDs: string[];
    intraRowOffset: number;
  };
};

export type SidebarRestoreFromChild = {
  childRowID: string;
  showCompletedHistory: boolean;
  sidebarScrollTop?: number;
  sidebarScrollAnchor?: PendingSidebarRefocus["sidebarScrollAnchor"];
};

export function resolveSidebarRestoreFromChild(input: {
  pendingSidebarRefocus?: PendingSidebarRefocus;
  sessionID: string;
}): SidebarRestoreFromChild | undefined {
  const { pendingSidebarRefocus, sessionID } = input;
  if (pendingSidebarRefocus?.parentSessionID !== sessionID) return undefined;

  return {
    childRowID: pendingSidebarRefocus.childRowID,
    showCompletedHistory: pendingSidebarRefocus.showCompletedHistory ?? false,
    sidebarScrollTop: pendingSidebarRefocus.sidebarScrollTop,
    sidebarScrollAnchor: pendingSidebarRefocus.sidebarScrollAnchor,
  };
}

export function resolveSidebarRestoreFromChildRoute(input: {
  pendingSidebarRefocus?: PendingSidebarRefocus;
  previousRouteSessionID?: string;
  routeSessionID?: string;
  sessionID: string;
}): SidebarRestoreFromChild | undefined {
  const { pendingSidebarRefocus, sessionID } = input;
  if (pendingSidebarRefocus?.parentSessionID !== sessionID) return undefined;

  const action = resolveSidebarReturnFocusAction({
    pendingSidebarRefocus,
    previousRouteSessionID: input.previousRouteSessionID,
    routeSessionID: input.routeSessionID,
  });
  if (action !== "focus-prompt") return undefined;

  return resolveSidebarRestoreFromChild({ pendingSidebarRefocus, sessionID });
}

export type ChildSessionState = {
  id: string;
  parentID: string;
  targetSessionID?: string;
};

export function resolveSiblingSidebarRefocus(input: {
  pendingSidebarRefocus?: PendingSidebarRefocus;
  routeSessionID?: string;
  children: Record<string, ChildSessionState> | ChildSessionState[];
}): Pick<PendingSidebarRefocus, "childSessionID" | "childRowID"> | undefined {
  const { pendingSidebarRefocus, routeSessionID, children } = input;
  if (
    !pendingSidebarRefocus ||
    !routeSessionID ||
    routeSessionID === pendingSidebarRefocus.parentSessionID ||
    routeSessionID === pendingSidebarRefocus.childSessionID
  ) {
    return undefined;
  }

  const sibling = Object.values(children).find(
    (child) =>
      child.parentID === pendingSidebarRefocus.parentSessionID &&
      child.targetSessionID === routeSessionID,
  );
  if (!sibling) return undefined;

  return {
    childSessionID: routeSessionID,
    childRowID: sibling.id,
  };
}

export function resolveSidebarReturnFocusAction(input: {
  pendingSidebarRefocus?: PendingSidebarRefocus;
  previousRouteSessionID?: string;
  routeSessionID?: string;
}): SidebarReturnFocusAction {
  const { pendingSidebarRefocus, previousRouteSessionID, routeSessionID } = input;
  if (!pendingSidebarRefocus || previousRouteSessionID === routeSessionID) {
    return "none";
  }

  if (
    previousRouteSessionID === pendingSidebarRefocus.childSessionID &&
    routeSessionID === pendingSidebarRefocus.parentSessionID
  ) {
    return "focus-prompt";
  }

  if (routeSessionID !== pendingSidebarRefocus.childSessionID) {
    return "clear-pending";
  }

  return "none";
}

export function focusPromptWithDeferredRetry(
  tryFocusPrompt: () => boolean,
  schedule: (callback: () => void) => void = (callback) => {
    setTimeout(callback, 0);
  },
): void {
  schedule(() => {
    if (tryFocusPrompt()) return;
    schedule(() => {
      void tryFocusPrompt();
    });
  });
}
