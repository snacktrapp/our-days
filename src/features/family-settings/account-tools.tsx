import Link from "next/link";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { PublicLegalFooter } from "@/features/legal/public-legal-footer";
import { AppearanceSettings } from "@/features/shell/appearance-settings";
import { NotificationPreference } from "./notification-preference";
import {
  SettingsChevron,
  SettingsGroup,
  SettingsRowCopy,
  SettingsRowLink,
  SettingsRowTrail,
  SettingsSection,
} from "./settings-directory";

export function AccountTools() {
  return (
    <>
      <SettingsSection aria-label="Preferences">
        <SettingsGroup>
          <AppearanceSettings />
          <NotificationPreference />
          <SettingsRowLink href="/trash" plain ariaLabel="Recently removed">
            <SettingsRowCopy
              title="Recently removed"
              subtitle="Moments you may want back"
            />
            <SettingsRowTrail>
              <SettingsChevron />
            </SettingsRowTrail>
          </SettingsRowLink>
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection aria-label="Session">
        <SettingsGroup>
          <div className="settings-row is-plain settings-sign-out-row">
            <SignOutButton />
          </div>
        </SettingsGroup>
      </SettingsSection>
      <PublicLegalFooter />
    </>
  );
}
