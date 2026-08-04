export type SidebarReturnFocusAction = "none" | "clear-pending" | "focus-prompt";

export type PendingSidebarRefocus = {
  parentSessionID: string;
  childSessionID: string;
  childRowID: string;
  showCompletedHistory?: boolean;
};

export type ChildSessionState = {
  id: string;
  parentID: string;
  targetSessionID?: string;
};

export function shouldReleaseSidebarListFocus(input: {
  previousRunningCount?: number;
  runningCount: number;
  listFocusModeActive: boolean;
}): boolean {
  return (
    input.listFocusModeActive &&
    (input.previousRunningCount ?? 0) > 0 &&
    input.runningCount === 0
  );
}

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
