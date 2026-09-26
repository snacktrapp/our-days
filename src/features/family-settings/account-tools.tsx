import Link from "next/link";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { AccentPicker } from "@/features/shell/accent-picker";
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
          <AccentPicker />
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
    </>
  );
}
