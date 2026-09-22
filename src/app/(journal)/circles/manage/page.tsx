import { redirect } from "next/navigation";

export default async function ManageCirclesPage({
  searchParams,
}: {
  searchParams: Promise<{ inviteCircle?: string; name?: string }>;
}) {
  const { inviteCircle, name } = await searchParams;
  const params = new URLSearchParams();
  if (inviteCircle) params.set("inviteCircle", inviteCircle);
  if (name) params.set("name", name);
  redirect(`/circles${params.size ? `?${params}` : ""}`);
}
