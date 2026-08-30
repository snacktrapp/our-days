import Link from "next/link";
import type { PeopleViewModel } from "./people-view-model";

export function PeoplePanel({ model }: { model: PeopleViewModel }) {
  return (
    <section className="section-panel people-panel">
      <p className="section-intro">{model.intro}</p>
      <div className="people-list">
        {model.people.map((person) => {
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
            <Link key={person.id} href={person.journalHref} prefetch={false}>
              {content}
            </Link>
          ) : (
            <div className="person-row" key={person.id}>
              {content}
            </div>
          );
        })}
      </div>
      <Link className="invite-button" href="/settings/family" prefetch={false}>
        Family access &amp; invitations
      </Link>
    </section>
  );
}
