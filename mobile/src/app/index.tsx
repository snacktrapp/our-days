import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useAuth } from "../components/auth-provider";
import { useAppTheme } from "../lib/theme";

export default function Index() {
  const { ready, session } = useAuth();
  const { colors } = useAppTheme();
  if (!ready) {
    return (
      <View style={[styles.waiting, { backgroundColor: colors.paper }]}>
        <ActivityIndicator color={colors.action} />
      </View>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;
  return <Redirect href="/journal" />;
}

const styles = StyleSheet.create({
  waiting: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
