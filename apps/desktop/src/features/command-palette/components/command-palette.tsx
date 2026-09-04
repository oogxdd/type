import { useRef } from "react";
import { FolderPlusIcon, FolderIcon } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/ui/command";
import type { SettingsSectionId } from "@/features/settings/lib/sections";
import { useCommandPaletteCommands } from "../hooks/use-command-palette-commands";

type CommandPaletteProps = {
  onOpenSettings: (section: SettingsSectionId) => void;
  onOpenFeed: () => void;
  onOpenArchive: () => void;
  onMoveFocusRestore: () => void;
  onNewRecording: () => void;
  onImportHandwriting: () => void;
};

/**
 * Context-aware command palette (⌘K / Ctrl+K). The hook owns the live command
 * list and state; this component renders either the normal command list or the
 * terminal-style `mv <path>` folder picker.
 */
export function CommandPalette({
  onOpenSettings,
  onOpenFeed,
  onOpenArchive,
  onMoveFocusRestore,
  onNewRecording,
  onImportHandwriting,
}: CommandPaletteProps) {
  const restoreNavigationFocusOnCloseRef = useRef(false);
  const {
    open,
    setOpen,
    inputValue,
    setInputValue,
    closePalette,
    groups,
    runCommand,
    moveMode,
    runMove,
    completePath,
  } = useCommandPaletteCommands({
    onOpenSettings,
    onOpenFeed,
    onOpenArchive,
    onNewRecording,
    onImportHandwriting,
  });

  return (
    <CommandDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setOpen(true);
        } else {
          closePalette();
        }
      }}
      // In move mode we render our own folder suggestions, so let cmdk show them
      // verbatim instead of fuzzy-filtering against the "mv …" input.
      shouldFilter={!moveMode}
      onCloseAutoFocus={(event) => {
        if (!restoreNavigationFocusOnCloseRef.current) {
          return;
        }
        restoreNavigationFocusOnCloseRef.current = false;
        event.preventDefault();
        onMoveFocusRestore();
      }}
    >
      <CommandInput
        placeholder={
          moveMode
            ? "mv <folder> — Right/Tab to drill in, Enter to move"
            : "Type a command or search…"
        }
        value={inputValue}
        onValueChange={setInputValue}
        onKeyDown={(event) => {
          if (!moveMode || (event.key !== "Tab" && event.key !== "ArrowRight")) {
            return;
          }
          // Complete the highlighted folder so you can browse its children.
          event.preventDefault();
          const active = document.querySelector<HTMLElement>(
            '[cmdk-item][aria-selected="true"][data-folder-path]'
          );
          const path = active?.getAttribute("data-folder-path");
          if (path) {
            completePath(path);
          }
        }}
      />
      <CommandList>
        {moveMode ? (
          <>
            <CommandEmpty>
              {moveMode.noteCount === 0
                ? "Open or select a note first."
                : "No matching folders. Keep typing to create one."}
            </CommandEmpty>
            {moveMode.noteCount > 0 && moveMode.rows.length > 0 ? (
              <CommandGroup
                heading={
                  moveMode.noteCount > 1
                    ? `Move ${moveMode.noteCount} notes to…`
                    : "Move note to…"
                }
              >
                {moveMode.rows.map((row) => {
                  const Icon =
                    row.kind === "create" ? FolderPlusIcon : FolderIcon;
                  return (
                    <CommandItem
                      key={`${row.kind}:${row.path}`}
                      value={`${row.kind}:${row.path}`}
                      data-folder-path={row.kind === "folder" ? row.path : undefined}
                      onSelect={() => {
                        restoreNavigationFocusOnCloseRef.current = true;
                        runMove(row.path);
                      }}
                    >
                      <Icon className="text-muted-foreground" />
                      <span className="truncate">{row.label}</span>
                      {row.kind === "folder" && row.sublabel !== row.label ? (
                        <span className="text-muted-foreground ml-auto truncate text-xs">
                          {row.sublabel}
                        </span>
                      ) : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
          </>
        ) : (
          <>
            <CommandEmpty>No matching commands.</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.heading} heading={group.heading}>
                {group.items.map((command) => {
                  const Icon = command.icon;
                  return (
                    <CommandItem
                      key={command.id}
                      keywords={command.keywords}
                      onSelect={() => runCommand(command)}
                    >
                      <Icon className="text-muted-foreground" />
                      <span>{command.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
