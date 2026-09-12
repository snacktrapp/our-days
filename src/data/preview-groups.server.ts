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
  const cookieCircle = await readActiveCircleCookie();
  const requestedCircle = search?.circle;
  const extraSource = requestedCircle ?? cookieCircle;
  const extraGroup = createdName
    ? { id: "created", name: createdName }
    : extraSource && extraSource !== "family"
      ? { id: extraSource, name: "New circle" }
      : undefined;
  const selectedGroupId = requestedCircle
    ? extraGroup && requestedCircle === extraGroup.id
      ? extraGroup.id
      : requestedCircle
    : null;
  return extraGroup
    ? { extraGroup, selectedGroupId }
    : selectedGroupId
      ? { selectedGroupId }
      : {};
}
