// Full-screen gate shown while encrypted mode is locked. The backend rejects
// all content calls until unlock, so nothing behind this screen can leak.
// Entering the panic password wipes local data — same contract as desktop.

import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput } from "react-native";

import { useSecurityStore } from "../state/security-store";
import { useTheme } from "../theme";
import { Button } from "../ui/controls";

export const LockScreen = () => {
  const theme = useTheme();
  const [password, setPassword] = useState("");
  const unlock = useSecurityStore((s) => s.unlock);
  const busy = useSecurityStore((s) => s.busy);
  const error = useSecurityStore((s) => s.error);

  const submit = () => {
    if (!password || busy) {
      return;
    }
    void unlock(password).then(() => setPassword(""));
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={[styles.title, { color: theme.colors.text }]}>Locked</Text>
      <Text style={[styles.subtitle, { color: theme.colors.secondaryText }]}>
        Notes are encrypted. Enter your password to unlock.
      </Text>
      <TextInput
        style={[
          styles.input,
          {
            color: theme.colors.text,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface,
          },
        ]}
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        placeholderTextColor={theme.colors.secondaryText}
        secureTextEntry
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={submit}
        keyboardAppearance={theme.dark ? "dark" : "light"}
      />
      {error ? (
        <Text style={[styles.error, { color: theme.colors.danger }]}>{error}</Text>
      ) : null}
      <Button title={busy ? "Unlocking…" : "Unlock"} onPress={submit} disabled={busy || !password} />
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "center", padding: 32, gap: 12 },
  title: { fontSize: 28, fontWeight: "700", textAlign: "center" },
  subtitle: { fontSize: 14, textAlign: "center", marginBottom: 12 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  error: { fontSize: 13, textAlign: "center" },
});
