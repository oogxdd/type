// The stack root: Menu | Capture | Sync as three pages of a native
// horizontal pager with no visible tab bar. Swiping left/right anywhere
// moves between them with UIScrollView paging physics, both directions
// finger-driven with live content — this replaces the old push/pop model and
// its hand-rolled gesture-driven preview overlays. Buttons and deep links
// jump pages via jumpToHomePage (navigation.ts).

import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import PagerView from "react-native-pager-view";

import {
  consumePendingHomePage,
  HOME_PAGE_INDEX,
  homePagerRef,
  jumpToHomePage,
} from "../navigation";
import { CaptureScreen } from "./capture-screen";
import { MenuScreen } from "./menu-screen";
import { SyncScreen } from "./sync-screen";

export const HomePagerScreen = () => {
  const [activeIndex, setActiveIndex] = useState(HOME_PAGE_INDEX.capture);

  useEffect(() => {
    // A cold-start deep link may have requested a page before the pager
    // attached (jumpToHomePage parks it) — apply it now, unanimated.
    const pending = consumePendingHomePage();
    if (pending) {
      jumpToHomePage(pending, false);
      setActiveIndex(HOME_PAGE_INDEX[pending]);
    }
    return () => {
      homePagerRef.current = null;
    };
  }, []);

  return (
    <PagerView
      ref={(pager) => {
        homePagerRef.current = pager;
      }}
      style={styles.pager}
      initialPage={HOME_PAGE_INDEX.capture}
      keyboardDismissMode="on-drag"
      onPageSelected={(event) => setActiveIndex(event.nativeEvent.position)}
    >
      {/* collapsable=false: the pager needs real native views as pages. */}
      <View key="menu" style={styles.page} collapsable={false}>
        <MenuScreen />
      </View>
      <View key="capture" style={styles.page} collapsable={false}>
        <CaptureScreen active={activeIndex === HOME_PAGE_INDEX.capture} />
      </View>
      <View key="sync" style={styles.page} collapsable={false}>
        <SyncScreen />
      </View>
    </PagerView>
  );
};

const styles = StyleSheet.create({
  pager: { flex: 1 },
  page: { flex: 1 },
});
