// Mobile counterpart to the desktop app's error boundary. The RN app had none,
// so any error thrown on the JS thread during render/lifecycle (e.g. while the
// capture page swaps in a fresh blank page after a swipe-up commit) tore the
// whole app down with no visible message — indistinguishable from a native
// crash. This catches those, shows the actual error + component stack (so it
// can be read/screenshotted straight off the device), and lets you retry.
//
// Caveat: a React error boundary only catches JS-thread render/lifecycle
// throws. It does NOT catch UI-thread Reanimated worklet exceptions or native
// crashes — those still need the Metro / Xcode console.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
  componentStack: string | null;
};

// Fixed dark overlay palette — an error screen must stay legible regardless of
// the app theme (and it can't use the theme hook from a class component).
const OVERLAY = "#161618";
const TEXT = "#f4f4f5";
const MUTED = "#a1a1aa";
const DANGER = "#f87171";
const BORDER = "#3f3f46";

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surfaces in the Metro terminal too, so it's captured even if the user
    // dismisses the overlay before reading it.
    console.error("[ErrorBoundary]", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  private reset = () => this.setState({ error: null, componentStack: null });

  render() {
    const { error, componentStack } = this.state;
    if (!error) {
      return this.props.children;
    }
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.name}>
            {error.name}: {error.message}
          </Text>
          {error.stack ? <Text style={styles.stack}>{error.stack}</Text> : null}
          {componentStack ? (
            <>
              <Text style={styles.sectionLabel}>Component stack</Text>
              <Text style={styles.stack}>{componentStack}</Text>
            </>
          ) : null}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          onPress={this.reset}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: OVERLAY, paddingTop: 64, paddingBottom: 40 },
  content: { padding: 24, gap: 12 },
  title: { color: TEXT, fontSize: 20, fontWeight: "700" },
  name: { color: DANGER, fontSize: 15, fontWeight: "600" },
  sectionLabel: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    marginTop: 8,
  },
  stack: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: "Courier",
  },
  button: {
    marginHorizontal: 24,
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    alignItems: "center",
  },
  buttonPressed: { opacity: 0.6 },
  buttonText: { color: TEXT, fontSize: 15, fontWeight: "600" },
});
