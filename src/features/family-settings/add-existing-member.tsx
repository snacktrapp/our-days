"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FamilyCircleViewModel } from "./family-settings-view-model";
import type {
  addExistingCircleMemberAction,
  listExistingCircleMembersAction,
} from "./family-settings-actions";

export type ExistingMemberActions = {
  list: typeof listExistingCircleMembersAction;
  add: typeof addExistingCircleMemberAction;
};

export function addFromCircleLabel(sources: readonly FamilyCircleViewModel[]) {
  if (sources.length === 1) return `Add someone from ${sources[0].name}`;
  return "Add someone from another circle";
}

export function AddExistingMember({
  circle,
  groups,
  preview = false,
  actions,
}: {
  circle: FamilyCircleViewModel;
  groups: readonly FamilyCircleViewModel[];
  preview?: boolean;
  actions?: ExistingMemberActions;
}) {
  const sources = groups.filter(
    (group) => group.id !== circle.id && group.canManageAccess,
  );
  if (
    !circle.canManageAccess ||
    sources.length === 0 ||
    (!preview && !actions)
  ) {
    return null;
  }
  return (
    <AddExistingMemberForm
      circle={circle}
      sources={sources}
      preview={preview}
      actions={actions}
    />
  );
}

export function AddExistingMemberForm({
  circle,
  sources,
  preview = false,
  actions,
}: {
  circle: FamilyCircleViewModel;
  sources: readonly FamilyCircleViewModel[];
  preview?: boolean;
  actions?: ExistingMemberActions;
}) {
  const id = useId();
  const router = useRouter();
  const [source, setSource] = useState("");
  const [selected, setSelected] = useState("");
  const [members, setMembers] = useState<
    { membership_id: string; display_name: string }[]
  >([]);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function loadMembers(sourceId: string) {
    setSource(sourceId);
    setSelected("");
    setMembers([]);
    setLoaded(false);
    setMessage("");
    if (!sourceId) return;
    startTransition(async () => {
      try {
        const result = preview
          ? {
              ok: true,
              message: "",
              members: (
                sources.find((group) => group.id === sourceId)?.members ?? []
              )
                .filter(
                  (person) =>
                    person.profileKind === "account" &&
                    person.membershipId &&
                    person.role !== "operations" &&
                    !circle.members.some(
                      (current) => current.name === person.name,
                    ),
                )
                .map((person) => ({
                  membership_id: person.membershipId!,
                  display_name: person.name,
                })),
            }
          : await actions!.list({
              sourceCircleId: sourceId,
              targetCircleId: circle.id,
            });
        setMembers(result.members);
        setLoaded(result.ok);
        setFailed(!result.ok);
        setMessage(result.message);
      } catch {
        setFailed(true);
        setMessage("Members could not be loaded. Try again.");
      }
    });
  }

  return (
    <form
      className="connected-invite-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!selected || pending) return;
        startTransition(async () => {
          try {
            const result = preview
              ? {
                  ok: true,
                  message: "Preview only. No membership was changed.",
                }
              : await actions!.add({
                  sourceMembershipId: selected,
                  targetCircleId: circle.id,
                });
            setMessage(result.message);
            setFailed(!result.ok);
            if (result.ok) {
              setMembers((current) =>
                current.filter((person) => person.membership_id !== selected),
              );
              setSelected("");
              if (!preview) router.refresh();
            }
          } catch {
            setFailed(true);
            setMessage("That person could not be added. Try again.");
          }
        });
      }}
    >
      <p className="chrome-body">
        Add a member from another circle you manage.
      </p>
      <label htmlFor={`${id}-source`}>From circle</label>
      <select
        id={`${id}-source`}
        value={source}
        disabled={pending}
        onChange={(event) => loadMembers(event.target.value)}
      >
        <option value="">Choose a circle</option>
        {sources.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </select>
      {loaded && members.length > 0 ? (
        <>
          <label htmlFor={`${id}-person`}>Person</label>
          <select
            id={`${id}-person`}
            value={selected}
            disabled={pending}
            onChange={(event) => {
              setSelected(event.target.value);
              setMessage("");
            }}
          >
            <option value="">Choose a person</option>
            {members.map((person) => (
              <option key={person.membership_id} value={person.membership_id}>
                {person.display_name}
              </option>
            ))}
          </select>
          <button type="submit" disabled={pending || !selected}>
            {pending ? "Adding…" : `Add to ${circle.name}`}
          </button>
        </>
      ) : null}
      {loaded && members.length === 0 ? (
        <p className="chrome-body">
          No members available to add. To invite someone else, use their email
          below.
        </p>
      ) : null}
      {pending && !loaded ? <p role="status">Loading members…</p> : null}
      {message ? (
        <p
          className="settings-inline-message"
          role={failed ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}
      {failed && !loaded ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => loadMembers(source)}
        >
          Try again
        </button>
      ) : null}
    </form>
  );
}
