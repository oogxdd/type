import { useMemo } from "react";
import {
  ChevronLeft,
  Menu,
  Mic,
  Plus,
  Settings,
} from "lucide-react";
import { createElement, type ReactNode } from "react";
import type { MobileAction, MobileRoute } from "../navigation";
import { getDisplayRouteTitle } from "../types";
import type { RecentBucket } from "@/mobile/hooks/use-recent-buckets";

type NavAction = {
  label: string;
  icon: ReactNode;
  onPress: () => void;
};

type PhoneNavHeaderParams = {
  currentRoute: MobileRoute;
  navigationTab: "folders" | "recent";
  activeFolderTitle: string;
  activeNoteTitle: string;
  recentBucketById: Map<string, RecentBucket>;
  dispatch: React.Dispatch<MobileAction>;
  popRoute: () => void;
  openEditorRoute: (notePath: string, folderPath?: string) => void;
  openRecordingRoute: (folderPath?: string) => void;
  createNewNote: (
    preferredFolderPath?: string,
    initialContent?: string,
    targetTimestampMs?: number
  ) => Promise<string | null>;
  setFoldersDrawerOpen: (open: boolean) => void;
};

export function usePhoneNavHeader({
  currentRoute,
  navigationTab,
  activeFolderTitle,
  activeNoteTitle,
  recentBucketById,
  dispatch,
  popRoute,
  openEditorRoute,
  openRecordingRoute,
  createNewNote,
  setFoldersDrawerOpen,
}: PhoneNavHeaderParams) {
  const phoneTitle =
    currentRoute.kind === "home"
      ? "Notes"
      : currentRoute.kind === "folders"
        ? navigationTab === "recent"
          ? "Recent"
          : "Folders"
        : currentRoute.kind === "notes"
          ? getDisplayRouteTitle(activeFolderTitle)
          : currentRoute.kind === "recent-date"
            ? recentBucketById.get(currentRoute.bucketId)?.label ?? "Recent"
            : currentRoute.kind === "recording"
              ? "New recording"
              : currentRoute.kind === "editor"
                ? activeNoteTitle
                : "Settings";

  const phoneLeftAction: NavAction =
    currentRoute.kind === "home"
      ? {
          label: "Folders",
          icon: createElement(Menu, { size: 18 }),
          onPress: () => setFoldersDrawerOpen(true),
        }
      : currentRoute.kind === "folders"
        ? {
            label: "Back",
            icon: createElement(ChevronLeft, { size: 18 }),
            onPress: () => dispatch({ type: "replace", route: { kind: "home" } }),
          }
        : {
            label: "Back",
            icon: createElement(ChevronLeft, { size: 18 }),
            onPress: () => {
              void popRoute();
            },
          };

  const phoneRightActions: NavAction[] = useMemo(() => {
    if (currentRoute.kind === "home" || currentRoute.kind === "folders") {
      return [
        {
          label: "Settings",
          icon: createElement(Settings, { size: 18 }),
          onPress: () => dispatch({ type: "push", route: { kind: "settings" } }),
        },
      ];
    }
    if (currentRoute.kind === "notes") {
      return [
        {
          label: "New note",
          icon: createElement(Plus, { size: 18 }),
          onPress: () => {
            void (async () => {
              const path = await createNewNote(currentRoute.folderPath);
              if (!path) {
                return;
              }
              openEditorRoute(path, currentRoute.folderPath);
            })();
          },
        },
        {
          label: "Record",
          icon: createElement(Mic, { size: 18 }),
          onPress: () => {
            openRecordingRoute(currentRoute.folderPath);
          },
        },
      ];
    }
    if (currentRoute.kind === "recent-date") {
      return [
        {
          label: "New note",
          icon: createElement(Plus, { size: 18 }),
          onPress: () => {
            void (async () => {
              const bucket = recentBucketById.get(currentRoute.bucketId);
              const path = await createNewNote(undefined, "", bucket?.dayEndMs ?? undefined);
              if (!path) {
                return;
              }
              openEditorRoute(path);
            })();
          },
        },
      ];
    }
    return [];
  }, [createNewNote, currentRoute, dispatch, openEditorRoute, openRecordingRoute, recentBucketById]);

  return { phoneTitle, phoneLeftAction, phoneRightActions };
}
