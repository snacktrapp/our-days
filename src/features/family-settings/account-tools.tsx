import { SignOutButton } from "@/features/auth/sign-out-button";
import { AccountSafetyControls } from "@/features/safety/account-safety";
import type { AccountSafetySnapshot } from "@/features/safety/safety-actions";
import { safetyContactEmail } from "@/features/safety/terms";
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

export function AccountTools({
  safety = null,
}: {
  safety?: AccountSafetySnapshot | null;
}) {
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
      <SettingsSection aria-label="Safety">
        <SettingsGroup>
          <div className="settings-row is-plain">
            <SettingsRowCopy
              title="Contact"
              subtitle={
                <a href={`mailto:${safetyContactEmail}`}>
                  {safetyContactEmail}
                </a>
              }
            />
          </div>
          <AccountSafetyControls safety={safety} />
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
