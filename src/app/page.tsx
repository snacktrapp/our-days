import { PrivateEntry } from "@/features/auth/private-entry";
import { isDesignPreviewEnabled } from "@/lib/design-preview.server";
import { connection } from "next/server";
import { redirect } from "next/navigation";

export default async function Home() {
  await connection();

  if (isDesignPreviewEnabled()) redirect("/family");

  return <PrivateEntry />;
}
