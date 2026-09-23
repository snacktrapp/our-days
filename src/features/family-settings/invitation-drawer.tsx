"use client";

import type { ReactNode } from "react";
import { CommentDrawer } from "@/features/timeline/comment-drawer";

/** Keep invitation input on the same keyboard-aware surface as comments. */
export function InvitationDrawer({
  circleName,
  pending = false,
  onClose,
  children,
}: {
  circleName: string;
  pending?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <CommentDrawer
      id="invitation-drawer"
      title="Invite someone"
      context={circleName}
      pending={pending}
      onDismiss={onClose}
    >
      <div className="invite-section invitation-drawer-content">{children}</div>
      <button
        type="button"
        className="invitation-drawer-cancel"
        disabled={pending}
        onClick={onClose}
      >
        Close
      </button>
    </CommentDrawer>
  );
}
