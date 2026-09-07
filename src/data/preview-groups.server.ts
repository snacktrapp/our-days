import "server-only";

import {
  readActiveCircleCookie,
  readPreviewCreatedGroupName,
} from "@/lib/auth/active-circle";

export type PreviewGroupOptions = Readonly<{
  extraGroup?: Readonly<{ id: string; name: string }>;
  selectedGroupId?: string | null;
}>;

export async function previewGroupOptions(
  search?: Readonly<{ circle?: string; name?: string }>,
): Promise<PreviewGroupOptions> {
  const createdName =
    (search?.name ? search.name : null) ??
    (await readPreviewCreatedGroupName());
  const circle = search?.circle ?? (await readActiveCircleCookie());
  const extraGroup = createdName
    ? { id: "created", name: createdName }
    : circle && circle !== "family"
      ? { id: circle, name: "New group" }
      : undefined;
  const selectedGroupId =
    circle && extraGroup && circle === extraGroup.id ? extraGroup.id : "family";
  return extraGroup ? { extraGroup, selectedGroupId } : {};
}
