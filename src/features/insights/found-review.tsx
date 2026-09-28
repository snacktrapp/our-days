"use client";

import { PostToField } from "@/features/composer/post-to-field";
import type { PostableCircle } from "@/features/composer/post-to";
import { FoundCandidateBody } from "./found-candidate";
import type { FoundCandidate } from "./found-types";

type FoundReviewProps = Readonly<{
  candidate: FoundCandidate;
  circles: readonly PostableCircle[];
  selectedIds: readonly string[];
  justMe: boolean;
  justMeAllowed: boolean;
  currentCircleId?: string;
  posting: boolean;
  error: string | null;
  onPostToChange: (
    next: Readonly<{ selectedIds: readonly string[]; justMe: boolean }>,
  ) => void;
  onBack: () => void;
  onPost: () => void;
}>;

export function FoundReview({
  candidate,
  circles,
  selectedIds,
  justMe,
  justMeAllowed,
  currentCircleId,
  posting,
  error,
  onPostToChange,
  onBack,
  onPost,
}: FoundReviewProps) {
  return (
    <div className="found-review">
      <FoundCandidateBody candidate={candidate} />
      {circles.length > 0 ? (
        <PostToField
          circles={circles}
          selectedIds={selectedIds}
          justMe={justMe}
          justMeAllowed={justMeAllowed}
          currentCircleId={currentCircleId}
          onChange={onPostToChange}
        />
      ) : null}
      <div className="composer-review-actions">
        <button
          className="secondary-composer-action"
          type="button"
          disabled={posting}
          onClick={onBack}
        >
          Back to edit
        </button>
        <button
          className="save-moment"
          type="button"
          disabled={posting}
          onClick={onPost}
        >
          {posting ? "Posting…" : "Post"}
        </button>
      </div>
      {error ? (
        <p className="composer-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
