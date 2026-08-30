import { requireDesignPreview } from "@/lib/design-preview.server";

export const dynamic = "force-dynamic";

export default async function JournalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireDesignPreview();

  return children;
}
