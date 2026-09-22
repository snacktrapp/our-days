import Link from "next/link";
import { SettingsDisclosure } from "@/features/family-settings/settings-disclosure";
import { groupHomeHref } from "@/features/shell/journal-switcher";
import { withCircleBrowseContext } from "@/features/shell/journal-routes";
import { peopleCountLabel, type PeopleViewModel } from "./people-view-model";

export function PeoplePanel({ model }: { model: PeopleViewModel }) {
  return (
    <section className="people-panel">
      <div className="settings-heading circle-directory-tools">
        <Link href="/circles/manage">Manage circles</Link>
      </div>
      {model.groups.map((group) => (
        <section
          key={group.id}
          id={`circle-${group.id}`}
          className="settings-section people-group"
          aria-labelledby={`people-group-${group.id}`}
        >
          <div className="settings-heading circle-directory-heading">
            <span>Circle</span>
            <h2 id={`people-group-${group.id}`}>{group.name}</h2>
            <Link
              className="person-arrow circle-journal-link"
              href={groupHomeHref(group.id)}
              prefetch={false}
              aria-label={`Open ${group.name} circle feed`}
            >
              View journal
            </Link>
            <p>{peopleCountLabel(group.members.length)}</p>
          </div>
          {group.inviteHref ? (
            <Link className="circle-manage-link" href={group.inviteHref}>
              Manage circle
            </Link>
          ) : null}
          <SettingsDisclosure
            className="circle-people-disclosure"
            label="People"
          >
            <div className="people-list">
              {group.members.map((person) => {
                const content = (
                  <>
                    <span
                      className={`person-avatar dot-${person.accent}`}
                      aria-hidden="true"
                    >
                      {person.initial}
                    </span>
                    <span className="person-copy">
                      <strong>{person.name}</strong>
                      <small>{person.roleLabel}</small>
                    </span>
                    <span
                      className="person-arrow"
                      aria-hidden={person.journalHref ? undefined : true}
                    >
                      {person.journalHref ? "View journal" : "›"}
                    </span>
                  </>
                );

                return person.journalHref ? (
                  <Link
                    key={person.id}
                    href={withCircleBrowseContext(person.journalHref, group.id)}
                    prefetch={false}
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="person-row" key={person.id}>
                    {content}
                  </div>
                );
              })}
            </div>
          </SettingsDisclosure>
        </section>
      ))}
      {model.groups.length === 0 ? (
        <p>No circles yet. You can still write in your journal.</p>
      ) : null}
    </section>
  );
}
