import { Button } from "@/shared/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import type { SettingsSectionId } from "@/features/settings/lib/sections";
import { useCommandPaletteCommands } from "../hooks/use-command-palette-commands";

type CommandPaletteProps = {
  onOpenSettings: (section: SettingsSectionId) => void;
  onOpenFeed: () => void;
  onOpenArchive: () => void;
  onNewRecording: () => void;
  onImportHandwriting: () => void;
};

/**
 * Context-aware command palette (⌘K / Ctrl+K). The hook owns the live command
 * list and modal state; this component only renders the dialogs.
 */
export function CommandPalette({
  onOpenSettings,
  onOpenFeed,
  onOpenArchive,
  onNewRecording,
  onImportHandwriting,
}: CommandPaletteProps) {
  const {
    open,
    setOpen,
    groups,
    runCommand,
    moveDialogOpen,
    setMoveDialogOpen,
    destinationPath,
    setDestinationPath,
    submitMoveToFolder,
    setMoveTargets,
  } = useCommandPaletteCommands({
    onOpenSettings,
    onOpenFeed,
    onOpenArchive,
    onNewRecording,
    onImportHandwriting,
  });

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Type a command or search…" />
        <CommandList>
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
        </CommandList>
      </CommandDialog>

      <Dialog
        open={moveDialogOpen}
        onOpenChange={(nextOpen) => {
          setMoveDialogOpen(nextOpen);
          if (!nextOpen) {
            setDestinationPath("");
            setMoveTargets([]);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move notes to folder</DialogTitle>
            <DialogDescription>
              Enter a folder path. Missing folders will be created.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Input
              autoFocus
              value={destinationPath}
              onChange={(event) => setDestinationPath(event.target.value)}
              placeholder="Events/Wedding/Photos"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitMoveToFolder();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setMoveDialogOpen(false);
                setDestinationPath("");
                setMoveTargets([]);
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void submitMoveToFolder()}>
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
