import {
  CommonActions,
  createNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

// One native stack whose root is the Home pager: Menu | Capture | Sync live
// side by side in a native horizontal pager (tab behavior, no visible tab
// bar) — swipe left/right anywhere to move between them, with the capture
// page in the middle as the boot landing. Everything else (Feed, Folder,
// Editor, Settings…) is pushed onto the stack above the pager, so the native
// back swipe from those lands back on whatever page was showing.
export type RootStackParamList = {
  Home: undefined;
  Feed: undefined;
  Folder: { path: string; title: string };
  Editor: { path: string; title?: string };
  Settings: undefined;
  SettingsWorkingFolders: undefined;
  SettingsTranscription: undefined;
};

export const Stack = createNativeStackNavigator<RootStackParamList>();

/** Container ref so deep-link handling can navigate from outside React. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export const navigateToScreen = <Screen extends keyof RootStackParamList>(
  screen: Screen,
  params?: RootStackParamList[Screen]
) => {
  if (navigationRef.isReady()) {
    navigationRef.dispatch(CommonActions.navigate({ name: screen, params }));
  }
};

// ---- Home pager plumbing ---------------------------------------------------

export type HomePage = "menu" | "capture" | "sync";

export const HOME_PAGE_INDEX: Record<HomePage, number> = {
  menu: 0,
  capture: 1,
  sync: 2,
};

// Structural type instead of importing PagerView here: keeps this module
// free of the native dependency (only home-pager.tsx touches it).
type HomePagerHandle = {
  setPage: (index: number) => void;
  setPageWithoutAnimation: (index: number) => void;
};

/** Set by HomePagerScreen on mount; null while the pager isn't attached. */
export const homePagerRef: { current: HomePagerHandle | null } = {
  current: null,
};

// A jump requested before the pager mounted (cold-start deep link) — the
// pager consumes it on mount instead of landing on the default page.
let pendingHomePage: HomePage | null = null;

export const consumePendingHomePage = (): HomePage | null => {
  const page = pendingHomePage;
  pendingHomePage = null;
  return page;
};

/**
 * Move the Home pager to a page — the buttons' and deep links' counterpart
 * of the swipe. Callers navigating from a pushed screen should also
 * `navigateToScreen("Home")` to pop back to the pager first.
 */
export const jumpToHomePage = (page: HomePage, animated = true) => {
  const pager = homePagerRef.current;
  if (!pager) {
    pendingHomePage = page;
    return;
  }
  if (animated) {
    pager.setPage(HOME_PAGE_INDEX[page]);
  } else {
    pager.setPageWithoutAnimation(HOME_PAGE_INDEX[page]);
  }
};
