import type { ReactElement, ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { Button, Host, Menu, RNHostView } from "@expo/ui/swift-ui";
import { accessibilityLabel as a11yLabel, contentShape, frame, shapes } from "@expo/ui/swift-ui/modifiers";

export type MenuItem = Readonly<{ id: string; title: string; destructive?: boolean; onPress: () => void }>;

/**
 * Native iOS pull-down menu on a 44×44 trigger. SwiftUI hit-tests only a Menu
 * label's visible pixels, so the old `MenuView` answered on the dots alone
 * (several taps to open). A fixed frame with a rectangle content shape makes
 * the whole square tappable.
 */
export function IosMenuTrigger({
  items,
  style,
  label,
  children,
}: Readonly<{ items: readonly MenuItem[]; style: StyleProp<ViewStyle>; label: string; children: ReactNode }>) {
  return (
    <Host matchContents style={style} ignoreSafeArea="all">
      <Menu
        label={<RNHostView matchContents>{children as ReactElement}</RNHostView>}
        modifiers={[frame({ width: 44, height: 44 }), contentShape(shapes.rectangle()), a11yLabel(label)]}
      >
        {items.map((item) => (
          <Button
            key={item.id}
            label={item.title}
            role={item.destructive ? "destructive" : undefined}
            onPress={item.onPress}
          />
        ))}
      </Menu>
    </Host>
  );
}
