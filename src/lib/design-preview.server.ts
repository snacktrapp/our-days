import "server-only";

import { isLocalDesignPreviewEnvironment } from "../../config/design-preview-policy";
import { redirect } from "next/navigation";
import { connection } from "next/server";

export function isDesignPreviewEnabled() {
  return isLocalDesignPreviewEnvironment(process.env);
}

export async function requireDesignPreview() {
  await connection();
  if (!isDesignPreviewEnabled()) redirect("/sign-in");
}
