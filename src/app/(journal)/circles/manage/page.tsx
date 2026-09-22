import AccountScreen from "@/features/family-settings/account-screen";
import { getFamilySettingsFixture } from "@/fixtures/design-preview/timelines.server";

export default function ManageCirclesPage({
  searchParams,
}: {
  searchParams: Promise<{ inviteCircle?: string; name?: string }>;
}) {
  return (
    <AccountScreen
      searchParams={searchParams}
      manageCircles
      loadPreview={getFamilySettingsFixture}
    />
  );
}
