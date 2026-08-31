import type { Metadata } from "next";
import { PhotoStatusQualityPreview } from "@/features/composer/photo-status-quality-preview";
import { requireDesignPreview } from "@/lib/design-preview.server";

export const metadata: Metadata = {
  title: "Private photo status preview — Our Days",
};

export default async function PhotoStatusQualityPage() {
  await requireDesignPreview();
  return <PhotoStatusQualityPreview />;
}
