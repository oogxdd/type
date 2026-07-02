import { useColorScheme } from "react-native";

export type Theme = {
  dark: boolean;
  colors: {
    background: string;
    surface: string;
    text: string;
    secondaryText: string;
    border: string;
    accent: string;
    danger: string;
    success: string;
  };
};

const light: Theme = {
  dark: false,
  colors: {
    background: "#ffffff",
    surface: "#f4f4f5",
    text: "#18181b",
    secondaryText: "#71717a",
    border: "#e4e4e7",
    accent: "#2563eb",
    danger: "#dc2626",
    success: "#16a34a",
  },
};

const dark: Theme = {
  dark: true,
  colors: {
    background: "#101012",
    surface: "#1c1c1f",
    text: "#f4f4f5",
    secondaryText: "#a1a1aa",
    border: "#2a2a2e",
    accent: "#60a5fa",
    danger: "#f87171",
    success: "#4ade80",
  },
};

export const useTheme = (): Theme =>
  useColorScheme() === "dark" ? dark : light;
