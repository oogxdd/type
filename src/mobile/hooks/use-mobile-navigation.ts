import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  getCurrentRoute,
  getInitialMobileNavigationState,
  mobileNavigationReducer,
  type MobileAction,
} from "../navigation";
import type { LayoutMode } from "../navigation";
import { useSelection } from "@/app/state/selection-context";
import { useEditor } from "@/contexts/editor-context";
import { FEED_FOLDER_PATH } from "../types";

export function useMobileNavigation(layoutMode: LayoutMode) {
  const { selectFolderForMobile, selectNoteForMobile } = useSelection();
  const { flushSave } = useEditor();

  const [navigationState, dispatch] = useReducer(
    mobileNavigationReducer,
    getInitialMobileNavigationState()
  );

  const previousStackDepthRef = useRef(navigationState.stack.length);
  const nextTransitionRef = useRef<"forward" | "backward" | "up" | null>(null);
  const [phoneTransitionDirection, setPhoneTransitionDirection] = useState<
    "forward" | "backward" | "up"
  >("forward");

  const currentRoute = getCurrentRoute(navigationState);

  // Track transition direction based on stack depth changes
  useEffect(() => {
    if (layoutMode !== "phone") {
      return;
    }
    const previousDepth = previousStackDepthRef.current;
    const nextDepth = navigationState.stack.length;
    if (nextTransitionRef.current) {
      setPhoneTransitionDirection(nextTransitionRef.current);
      nextTransitionRef.current = null;
    } else if (nextDepth > previousDepth) {
      setPhoneTransitionDirection("forward");
    } else if (nextDepth < previousDepth) {
      setPhoneTransitionDirection("backward");
    }
    previousStackDepthRef.current = nextDepth;
  }, [layoutMode, navigationState.stack.length]);

  const popRoute = useCallback(async () => {
    if (layoutMode !== "phone") {
      return;
    }
    if (currentRoute.kind === "editor") {
      await flushSave();
    }
    dispatch({ type: "pop" });
  }, [currentRoute.kind, flushSave, layoutMode]);

  const openNotesRoute = useCallback(
    (folderPath: string) => {
      selectFolderForMobile(folderPath);
      dispatch({ type: "push", route: { kind: "notes", folderPath } });
    },
    [selectFolderForMobile]
  );

  const openArchiveRoute = useCallback(() => {
    openNotesRoute("Archieve");
  }, [openNotesRoute]);

  const openRecentBucketRoute = useCallback((bucketId: string) => {
    dispatch({ type: "push", route: { kind: "recent-date", bucketId } });
  }, []);

  const openEditorRoute = useCallback(
    (notePath: string, folderPath?: string) => {
      const resolvedFolderPath =
        folderPath ??
        (notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "");
      selectNoteForMobile(notePath);
      dispatch({
        type: "push",
        route: {
          kind: "editor",
          folderPath: resolvedFolderPath,
          notePath,
        },
      });
    },
    [selectNoteForMobile]
  );

  const openRecordingRoute = useCallback(
    (folderPath: string = FEED_FOLDER_PATH, autoStart?: boolean) => {
      selectFolderForMobile(folderPath);
      nextTransitionRef.current = "up";
      dispatch({ type: "push", route: { kind: "recording", folderPath, autoStart } });
    },
    [selectFolderForMobile]
  );

  return {
    navigationState,
    dispatch: dispatch as React.Dispatch<MobileAction>,
    currentRoute,
    phoneTransitionDirection,
    nextTransitionRef,
    popRoute,
    openNotesRoute,
    openArchiveRoute,
    openRecentBucketRoute,
    openEditorRoute,
    openRecordingRoute,
  };
}
