import { requireDesignPreview } from "@/lib/design-preview.server";
import { redirect } from "next/navigation";

export default async function JournalPage() {
  await requireDesignPreview();
  redirect("/family");
}
