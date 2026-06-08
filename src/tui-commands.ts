export type TuiCommandDispose = () => void;

type LegacyCommand = {
  title: string;
  value: string;
  description?: string;
  category?: string;
  keybind?: string;
  onSelect?: () => void;
};

type LegacyCommandApi = {
  register?: (commands: () => LegacyCommand[]) => TuiCommandDispose;
};

type KeymapCommand = {
  name: string;
  title: string;
  description?: string;
  category?: string;
  run: () => void;
};

type KeymapBinding = {
  key: string;
  cmd: string;
};

type KeymapLayer = {
  commands: KeymapCommand[];
  bindings: KeymapBinding[];
};

type KeymapApi = {
  registerLayer?: (layer: KeymapLayer) => TuiCommandDispose;
};

type CommandApiShape = {
  keymap?: KeymapApi;
  command?: LegacyCommandApi;
};

type RegisterSubagentCommandsInput = {
  api: CommandApiShape;
  sectionEnabled: () => boolean;
  toggleSection: (enabled: boolean) => void;
  focusSidebarList: () => void;
  toggleCompletedHistory: () => void;
};

const TOGGLE_SECTION_COMMAND = "subagent-statusline.toggle-sidebar-section";
const FOCUS_SIDEBAR_LIST_COMMAND = "subagent-statusline.focus-sidebar-list";
const TOGGLE_COMPLETED_HISTORY_COMMAND =
  "subagent-statusline.toggle-completed-history";
const COMMAND_CATEGORY = "Subagents";

type SharedCommandMetadata = {
  id: string;
  title: string;
  description: string;
  category: string;
};

const SHARED_COMMAND_METADATA: {
  toggle: SharedCommandMetadata;
  focus: SharedCommandMetadata;
  toggleCompletedHistory: SharedCommandMetadata;
} = {
  toggle: {
    id: TOGGLE_SECTION_COMMAND,
    title: "Subagents: Toggle sidebar section",
    description: "Toggle the entire subagent sidebar section",
    category: COMMAND_CATEGORY,
  },
  focus: {
    id: FOCUS_SIDEBAR_LIST_COMMAND,
    title: "Subagents: Focus sidebar list",
    description: "Focus the subagent sidebar list for keyboard navigation",
    category: COMMAND_CATEGORY,
  },
  toggleCompletedHistory: {
    id: TOGGLE_COMPLETED_HISTORY_COMMAND,
    title: "Subagents: Toggle completed history",
    description:
      "Toggle retained completed rows in the subagent sidebar. Shortcut: c while the sidebar list is focused.",
    category: COMMAND_CATEGORY,
  },
};

function createToggleSelectionTitle(sectionEnabled: boolean): string {
  return sectionEnabled
    ? "Subagents: Disable sidebar section"
    : "Subagents: Enable sidebar section";
}

function createCompositeDispose(disposers: TuiCommandDispose[]): TuiCommandDispose {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;

    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // Cleanup should be best-effort across mixed runtime APIs.
      }
    }
  };
}

export function registerSubagentCommands({
  api,
  sectionEnabled,
  toggleSection,
  focusSidebarList,
  toggleCompletedHistory,
}: RegisterSubagentCommandsInput): TuiCommandDispose {
  const disposers: TuiCommandDispose[] = [];

  if (api.keymap?.registerLayer) {
    disposers.push(
      api.keymap.registerLayer({
        commands: [
          {
            name: SHARED_COMMAND_METADATA.toggle.id,
            title: SHARED_COMMAND_METADATA.toggle.title,
            description: SHARED_COMMAND_METADATA.toggle.description,
            category: SHARED_COMMAND_METADATA.toggle.category,
            run: () => toggleSection(!sectionEnabled()),
          },
          {
            name: SHARED_COMMAND_METADATA.focus.id,
            title: SHARED_COMMAND_METADATA.focus.title,
            description: SHARED_COMMAND_METADATA.focus.description,
            category: SHARED_COMMAND_METADATA.focus.category,
            run: focusSidebarList,
          },
          {
            name: SHARED_COMMAND_METADATA.toggleCompletedHistory.id,
            title: SHARED_COMMAND_METADATA.toggleCompletedHistory.title,
            description:
              SHARED_COMMAND_METADATA.toggleCompletedHistory.description,
            category: SHARED_COMMAND_METADATA.toggleCompletedHistory.category,
            run: toggleCompletedHistory,
          },
        ],
        bindings: [
          {
            key: "alt+b",
            cmd: SHARED_COMMAND_METADATA.focus.id,
          },
        ],
      }),
    );
  }

  if (api.command?.register) {
    disposers.push(
      api.command.register(() => [
        {
          title: createToggleSelectionTitle(sectionEnabled()),
          value: SHARED_COMMAND_METADATA.toggle.id,
          description: SHARED_COMMAND_METADATA.toggle.description,
          category: SHARED_COMMAND_METADATA.toggle.category,
          onSelect: () => toggleSection(!sectionEnabled()),
        },
        {
          title: SHARED_COMMAND_METADATA.focus.title,
          value: SHARED_COMMAND_METADATA.focus.id,
          description: SHARED_COMMAND_METADATA.focus.description,
          category: SHARED_COMMAND_METADATA.focus.category,
          keybind: "alt+b",
          onSelect: focusSidebarList,
        },
        {
          title: SHARED_COMMAND_METADATA.toggleCompletedHistory.title,
          value: SHARED_COMMAND_METADATA.toggleCompletedHistory.id,
          description: SHARED_COMMAND_METADATA.toggleCompletedHistory.description,
          category: SHARED_COMMAND_METADATA.toggleCompletedHistory.category,
          onSelect: toggleCompletedHistory,
        },
      ]),
    );
  }

  return createCompositeDispose(disposers);
}
