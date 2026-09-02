import "server-only";

import { isDesignPreviewEnvironment } from "../../config/design-preview-policy";
import { redirect } from "next/navigation";
import { connection } from "next/server";

export function isDesignPreviewEnabled() {
  return isDesignPreviewEnvironment(process.env);
}

export async function requireDesignPreview() {
  await connection();
  if (!isDesignPreviewEnabled()) redirect("/sign-in");
}
