import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

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
