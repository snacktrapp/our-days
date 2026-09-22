import { redirect } from "next/navigation";
import AccountScreen from "@/features/family-settings/account-screen";
import { getFamilySettingsFixture } from "@/fixtures/design-preview/timelines.server";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{
    inviteCircle?: string;
    name?: string;
    previewLoading?: string;
  }>;
}) {
  const query = await searchParams;
  if (query.inviteCircle) {
    const params = new URLSearchParams({ inviteCircle: query.inviteCircle });
    if (query.name) params.set("name", query.name);
    redirect(`/circles?${params}`);
  }
  return (
    <AccountScreen
      searchParams={Promise.resolve(query)}
      loadPreview={getFamilySettingsFixture}
    />
  );
}
