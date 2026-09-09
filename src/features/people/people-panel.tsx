import Link from "next/link";
import { peopleCountLabel, type PeopleViewModel } from "./people-view-model";

export function PeoplePanel({ model }: { model: PeopleViewModel }) {
  return (
    <section className="people-panel">
      <p className="section-intro chrome-body">{model.intro}</p>
      {model.groups.map((group) => (
        <section
          key={group.id}
          className="settings-section people-group"
          aria-labelledby={`people-group-${group.id}`}
        >
          <div className="settings-heading">
            <span>Circle</span>
            <h2 id={`people-group-${group.id}`}>{group.name}</h2>
            <p>{peopleCountLabel(group.members.length)}</p>
          </div>
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
                  href={person.journalHref}
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
          {group.inviteHref ? (
            <Link
              className="invite-button"
              href={group.inviteHref}
              prefetch={false}
            >
              Invite into this circle
            </Link>
          ) : null}
        </section>
      ))}
    </section>
  );
}
