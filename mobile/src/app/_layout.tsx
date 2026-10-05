import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, type ReactNode } from "react";
import { Platform } from "react-native";

import { AuthProvider, useAuth } from "../components/auth-provider";
import { TermsGate } from "../components/safety-sheets";
import { ShareIntentBridge } from "../components/share-bridge";
import { applyUpdateAtLaunch } from "../lib/app-updates";
import { ThemeProvider, useAppTheme } from "../lib/theme";
import { installWebAlert } from "../lib/web-alert";

installWebAlert();

SplashScreen.preventAutoHideAsync().catch(() => {
  // Expo web and fast refresh have no native splash to hold.
});

export default function RootLayout() {
  const [fontsReady, fontError] = useFonts({
    "JetBrainsMono-Regular": require("../../assets/fonts/JetBrainsMono-Regular.ttf"),
    "JetBrainsMono-SemiBold": require("../../assets/fonts/JetBrainsMono-SemiBold.ttf"),
    "JetBrainsMono-Bold": require("../../assets/fonts/JetBrainsMono-Bold.ttf"),
  });
  return (
    <ThemeProvider>
      <AuthProvider>
        <BootGate fontsReady={fontsReady || Boolean(fontError)}>
          <ShareIntentBridge />
          <TermsGate>
            <ThemedStack />
          </TermsGate>
        </BootGate>
      </AuthProvider>
    </ThemeProvider>
  );
}

function BootGate({
  fontsReady,
  children,
}: Readonly<{ fontsReady: boolean; children: ReactNode }>) {
  const { ready } = useAuth();
  const revealed = useRef(false);
  useEffect(() => {
    void applyUpdateAtLaunch(() => revealed.current);
  }, []);
  useEffect(() => {
    if (!fontsReady || !ready) return;
    revealed.current = true;
    SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsReady, ready]);
  if (!fontsReady || !ready) return null;
  return children;
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
          // Auth used to replace `/` with `/journal` after the session
          // restored. The stack plays that replace as a push, so the feed
          // paints and then slides in from the right. Nothing in this app
          // needs a stack transition.
          animation: "none",
          contentStyle: { backgroundColor: colors.gridSurface },
        }}
      />
    </>
  );
}
