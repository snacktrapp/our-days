import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";

export function isDesignPreviewEnabled() {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.OUR_DAYS_ENABLE_DESIGN_PREVIEW === "true"
  );
}

export async function requireDesignPreview() {
  await connection();
  if (!isDesignPreviewEnabled()) redirect("/sign-in");
}
