import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform } from "react-native";

import { AuthProvider } from "../components/auth-provider";
import { ThemeProvider, useAppTheme } from "../lib/theme";

export default function RootLayout() {
  const [fontsReady, fontError] = useFonts({
    "JetBrainsMono-Regular": require("../../assets/fonts/JetBrainsMono-Regular.ttf"),
    "JetBrainsMono-SemiBold": require("../../assets/fonts/JetBrainsMono-SemiBold.ttf"),
    "JetBrainsMono-Bold": require("../../assets/fonts/JetBrainsMono-Bold.ttf"),
  });
  return (
    <ThemeProvider>
      <AuthProvider>
        {fontsReady || fontError ? <ThemedStack /> : null}
      </AuthProvider>
    </ThemeProvider>
  );
}

function ThemedStack() {
  const { colors } = useAppTheme();
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const id = "our-days-viewport";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    // The journal bars hide with the feed's own scroll, the same way the
    // web listens to window scroll. A document-sized page would leave them pinned.
    style.textContent =
      "html,body{height:100%;overflow:hidden}#root,#root>div{height:100%}";
    document.head.appendChild(style);
  }, []);
  return (
    <>
      <StatusBar style={colors.scheme === "light" ? "dark" : "light"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.gridSurface },
        }}
      />
    </>
  );
}
