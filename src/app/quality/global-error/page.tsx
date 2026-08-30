import { redirect } from "next/navigation";
import { isDesignPreviewEnabled } from "@/lib/design-preview.server";

export default function GlobalErrorQualityProbe() {
  if (!isDesignPreviewEnabled()) redirect("/sign-in");
  throw new Error("Intentional global error quality probe");
}
