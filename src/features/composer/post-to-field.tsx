"use client";

import { defaultPostToCircleIds, type PostableCircle } from "./post-to";

type PostToChange = Readonly<{
  selectedIds: readonly string[];
  justMe: boolean;
}>;

type PostToChoicesProps = Readonly<{
  circles: readonly PostableCircle[];
  selectedIds: readonly string[];
  justMe: boolean;
  justMeAllowed?: boolean;
  currentCircleId?: string;
  lockedCircleId?: string;
  legend?: string;
  onChange: (next: PostToChange) => void;
}>;

export function PostToChoices({
  circles,
  selectedIds,
  justMe,
  justMeAllowed = true,
  currentCircleId,
  lockedCircleId,
  legend = "Post to",
  onChange,
}: PostToChoicesProps) {
  if (circles.length === 0) return null;

  const chooseCircle = (circleId: string, checked: boolean) => {
    if (checked) {
      onChange({
        justMe: false,
        selectedIds: selectedIds.includes(circleId)
          ? selectedIds
          : [...selectedIds, circleId],
      });
      return;
    }
    if (circleId === lockedCircleId) return;
    const remaining = selectedIds.filter((id) => id !== circleId);
    if (remaining.length === 0) return;
    onChange({ justMe: false, selectedIds: remaining });
  };

  const fallbackIds = defaultPostToCircleIds(
    circles,
    lockedCircleId ?? currentCircleId,
  );

  return (
    <fieldset className="people-tags post-to-chips">
      <legend>{legend}</legend>
      <div>
        {circles.map((circle) => {
          const locked = !justMe && circle.id === lockedCircleId;
          return (
            <label key={circle.id}>
              <input
                type="checkbox"
                checked={!justMe && selectedIds.includes(circle.id)}
                disabled={locked}
                onChange={(event) =>
                  chooseCircle(circle.id, event.target.checked)
                }
              />
              {circle.name}
            </label>
          );
        })}
        {justMeAllowed ? (
          <label>
            <input
              type="checkbox"
              checked={justMe}
              onChange={(event) => {
                if (event.target.checked) {
                  onChange({ justMe: true, selectedIds: [] });
                  return;
                }
                onChange({ justMe: false, selectedIds: fallbackIds });
              }}
            />
            Just me
          </label>
        ) : null}
      </div>
    </fieldset>
  );
}

type PostToFieldProps = Omit<PostToChoicesProps, "legend">;

export function PostToField(props: PostToFieldProps) {
  if (props.circles.length === 0) return null;
  return (
    <div className="composer-field composer-post-to">
      <PostToChoices {...props} />
    </div>
  );
}
