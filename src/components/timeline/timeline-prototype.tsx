'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';

type View = 'family' | 'molly';
type Section = 'timeline' | 'people' | 'memories';
type MomentType = 'photo' | 'thought' | 'milestone' | 'location';

type Moment = {
  id: string;
  type: MomentType;
  person: 'Brian' | 'Molly' | 'Avery';
  initial: string;
  color: 'brian' | 'molly' | 'avery';
  time: string;
  date: string;
  isoDate: string;
  gap?: string;
  kicker: string;
  text: string;
  noteCount: number;
  image?: string;
  imageAlt?: string;
  place?: string;
  milestone?: string;
  age?: string;
  tagged?: string;
};

const moments: Moment[] = [
  {
    id: 'sunset',
    type: 'photo',
    person: 'Brian',
    initial: 'B',
    color: 'brian',
    time: '8:14 pm',
    date: 'Aug 28, 2026',
    isoDate: '2026-08-28',
    kicker: 'An ordinary Friday',
    text: 'We stayed until the light disappeared. Nobody wanted to be the first one back in the car.',
    noteCount: 2,
    image: '/sample-family.jpg',
    imageAlt: 'A child laughing outside in warm evening light',
    tagged: 'Molly + 3',
  },
  {
    id: 'kitchen',
    type: 'thought',
    person: 'Molly',
    initial: 'M',
    color: 'molly',
    time: '9:42 pm',
    date: 'Aug 14, 2026',
    isoDate: '2026-08-14',
    gap: 'two weeks earlier',
    kicker: 'A thought',
    text: 'Tonight the kitchen was loud, the floor was a mess, and I wished I could keep all of it.',
    noteCount: 4,
  },
  {
    id: 'lake',
    type: 'location',
    person: 'Molly',
    initial: 'M',
    color: 'molly',
    time: '4:08 pm',
    date: 'Jul 6, 2026',
    isoDate: '2026-07-06',
    gap: 'five weeks earlier',
    kicker: 'A place we’ll remember',
    text: 'The small beach past the pine trees, where Avery finally put both feet in the water.',
    noteCount: 1,
    place: 'Sand Harbor · Lake Tahoe',
    tagged: 'Avery',
  },
  {
    id: 'first-day',
    type: 'milestone',
    person: 'Avery',
    initial: 'A',
    color: 'avery',
    time: 'Added by Molly',
    date: 'Aug 21, 2023',
    isoDate: '2023-08-21',
    gap: 'three years earlier',
    kicker: 'Milestone',
    text: 'A backpack almost as big as Avery, one brave wave, and then straight through the blue door.',
    noteCount: 6,
    milestone: 'First day of school',
    age: 'Age 5',
  },
];

const people = [
  { name: 'Brian', initial: 'B', color: 'brian', role: 'Co-organizer' },
  { name: 'Molly', initial: 'M', color: 'molly', role: 'Co-organizer' },
  { name: 'Avery', initial: 'A', color: 'avery', role: 'Journal profile' },
  { name: 'Sam', initial: 'S', color: 'sam', role: 'Journal profile' },
  { name: 'June', initial: 'J', color: 'june', role: 'Journal profile' },
] as const;

function Connection({ moment }: { moment: Moment }) {
  return (
    <div className="connection">
      <span className={`avatar-node dot-${moment.color}`} aria-hidden="true">{moment.initial}</span>
      <span className="moment-meta">
        <strong>{moment.person}</strong>
        <span>{moment.time}</span>
      </span>
    </div>
  );
}

function MomentActions({ moment, held, onHold }: { moment: Moment; held: boolean; onHold: () => void }) {
  return (
    <div className="soft-actions">
      <button className={held ? 'held' : ''} aria-label={`${held ? 'Release' : 'Hold'} ${moment.kicker} by ${moment.person}`} aria-pressed={held} onClick={onHold}>
        {held ? '♥ Held' : '♡ Hold'}
      </button>
      <button aria-label={`Open ${moment.noteCount} notes for ${moment.kicker} by ${moment.person}`}>Notes</button>
      {moment.tagged && <span className="tagged">with {moment.tagged}</span>}
    </div>
  );
}

function MomentCard({ moment, held, onHold, preload = false }: { moment: Moment; held: boolean; onHold: () => void; preload?: boolean }) {
  if (moment.type === 'photo' && moment.image) {
    return (
      <div className="moment-card photo-card">
        <div className="photo-frame">
          <Image src={moment.image} alt={moment.imageAlt ?? ''} fill preload={preload} sizes="(max-width: 520px) 92vw, 410px" />
          <span className="photo-date">AUG 28</span>
        </div>
        <div className="card-copy">
          <p className="moment-kicker">{moment.kicker}</p>
          <p>{moment.text}</p>
          <MomentActions moment={moment} held={held} onHold={onHold} />
        </div>
      </div>
    );
  }

  if (moment.type === 'thought') {
    return (
      <div className="moment-card thought-card">
        <span className="thought-label">{moment.kicker}</span>
        <blockquote>“{moment.text}”</blockquote>
        <MomentActions moment={moment} held={held} onHold={onHold} />
      </div>
    );
  }

  if (moment.type === 'location') {
    return (
      <div className="moment-card location-card">
        <div className="memory-map" aria-hidden="true">
          <span className="map-water" />
          <span className="map-road road-one" />
          <span className="map-road road-two" />
          <span className="place-pin"><i /></span>
          <span className="map-label">TAHOE</span>
        </div>
        <div className="card-copy">
          <p className="moment-kicker">{moment.kicker}</p>
          <h3>{moment.place}</h3>
          <p>{moment.text}</p>
          <MomentActions moment={moment} held={held} onHold={onHold} />
        </div>
      </div>
    );
  }

  return (
    <div className="moment-card milestone-card">
      <div className="milestone-seal">
        <span>{moment.age}</span>
        <strong>✦</strong>
        <span>{moment.date.split(',')[1]}</span>
      </div>
      <div className="milestone-copy">
        <span>{moment.kicker}</span>
        <h3>{moment.milestone}</h3>
        <p>{moment.text}</p>
        <MomentActions moment={moment} held={held} onHold={onHold} />
      </div>
    </div>
  );
}

export default function TimelinePrototype() {
  const [view, setView] = useState<View>('family');
  const [section, setSection] = useState<Section>('timeline');
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<MomentType | null>(null);
  const [draft, setDraft] = useState('');
  const [heldMoments, setHeldMoments] = useState<string[]>([]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const addMomentRef = useRef<HTMLButtonElement>(null);
  const firstChoiceRef = useRef<HTMLButtonElement>(null);
  const molly = view === 'molly';

  const visibleMoments = molly ? moments.filter((moment) => moment.person === 'Molly') : moments;

  const toggleHeld = (id: string) => {
    setHeldMoments((current) => current.includes(id) ? current.filter((momentId) => momentId !== id) : [...current, id]);
  };

  const openTimeline = (nextView: View) => {
    setView(nextView);
    setSection('timeline');
  };

  const closeComposer = useCallback((discardDraft = false) => {
    if (!discardDraft && draft.trim() && !window.confirm('Discard this unfinished moment?')) {
      return;
    }

    setComposerOpen(false);
    setComposerMode(null);
    setDraft('');
    window.requestAnimationFrame(() => addMomentRef.current?.focus());
  }, [draft]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!composerOpen || !dialog) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    const focusFrame = window.requestAnimationFrame(() => firstChoiceRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, [composerOpen]);

  return (
    <main className={`app-shell ${molly ? 'theme-molly' : ''}`}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <section className="phone-stage" aria-label="Family journal prototype">
        <header className="topbar">
          <button className="family-mark" aria-label="Open family settings" onClick={() => setSection('people')}>
            <span className="family-mark-dot dot-brian" aria-hidden="true">B</span>
            <span className="family-mark-dot dot-molly" aria-hidden="true">M</span>
          </button>
          <div className="title-lockup">
            <span className="eyebrow">Our family</span>
            <h1>
              {section === 'people' ? 'Our people' : section === 'memories' ? 'Memories' : molly ? 'Molly’s days' : 'All our days'}
            </h1>
          </div>
          <button className="quiet-button" aria-label="Timeline options">•••</button>
        </header>

        {section === 'timeline' && (
          <>
            <div className="view-switch" role="group" aria-label="Timeline view">
              <button aria-pressed={!molly} className={!molly ? 'active' : ''} onClick={() => setView('family')}>Family</button>
              <button aria-pressed={molly} className={molly ? 'active' : ''} onClick={() => setView('molly')}>Molly</button>
            </div>

            {molly && (
              <div className="personal-intro">
                <span className="profile-orbit dot-molly" aria-hidden="true">M</span>
                <div><strong>Molly’s journal</strong><span>104 moments · 2012–2026</span></div>
              </div>
            )}

            <section className="timeline" aria-label="Chronological family moments">
              <div className="time-rail" aria-hidden="true" />
              <div className="date-marker"><span>{molly ? 'Summer 2026' : 'Today'}</span></div>

              {visibleMoments.map((moment, index) => (
                <div key={moment.id}>
                  {moment.gap && index > 0 && <div className="elapsed-gap"><span>{moment.gap}</span></div>}
                  {moment.id === 'first-day' && <div className="date-marker year-divider"><span>2023</span></div>}
                  <article className={`moment moment-${moment.type}`}>
                    <Connection moment={moment} />
                    <MomentCard moment={moment} held={heldMoments.includes(moment.id)} onHold={() => toggleHeld(moment.id)} preload={index === 0} />
                    <time dateTime={moment.isoDate}>{moment.date}</time>
                  </article>
                </div>
              ))}

              <div className="date-marker year-marker"><span>Earlier years</span></div>
              <p className="timeline-whisper">Keep scrolling to travel back through your family’s life.</p>
            </section>
          </>
        )}

        {section === 'people' && (
          <section className="section-panel people-panel">
            <p className="section-intro">Five lives, held together. Each person has a journal of their own.</p>
            <div className="people-list">
              {people.map((person) => (
                <button key={person.name} onClick={() => { if (person.name === 'Molly') openTimeline('molly'); }}>
                  <span className={`person-avatar dot-${person.color}`} aria-hidden="true">{person.initial}</span>
                  <span className="person-copy"><strong>{person.name}</strong><small>{person.role}</small></span>
                  <span className="person-arrow" aria-hidden={person.name === 'Molly' ? undefined : true}>{person.name === 'Molly' ? 'View journal' : '›'}</span>
                </button>
              ))}
            </div>
            <button className="invite-button">Invite family member</button>
          </section>
        )}

        {section === 'memories' && (
          <section className="section-panel memories-panel">
            <div className="memory-heading"><span>On this day</span><strong>4 years ago</strong></div>
            <button className="memory-feature" onClick={() => openTimeline('family')}>
              <div className="memory-photo">
                <Image src={moments[0].image!} alt="A child laughing outside" fill sizes="360px" />
              </div>
              <div><span>August 28, 2022</span><strong>A late-summer afternoon</strong><small>See this moment in the timeline →</small></div>
            </button>
            <div className="browse-years">
              <span>Browse by year</span>
              <div>{['2026', '2025', '2024', '2023'].map((year) => <button key={year}>{year}</button>)}</div>
            </div>
          </section>
        )}

        <nav className="bottom-nav" aria-label="Primary navigation">
          <button className={`nav-item ${section === 'timeline' && !molly ? 'active' : ''}`} aria-current={section === 'timeline' && !molly ? 'page' : undefined} onClick={() => openTimeline('family')}>
            <span className="nav-symbol" aria-hidden="true">│</span><span>Family</span>
          </button>
          <button className={`nav-item ${section === 'people' ? 'active' : ''}`} aria-current={section === 'people' ? 'page' : undefined} onClick={() => setSection('people')}>
            <span className="nav-symbol" aria-hidden="true">◌</span><span>People</span>
          </button>
          <button ref={addMomentRef} className="add-moment" aria-label="Add moment" onClick={() => setComposerOpen(true)}>+</button>
          <button className={`nav-item ${section === 'memories' ? 'active' : ''}`} aria-current={section === 'memories' ? 'page' : undefined} onClick={() => setSection('memories')}>
            <span className="nav-symbol" aria-hidden="true">⌁</span><span>Memories</span>
          </button>
        </nav>

        {composerOpen && (
          <dialog
            ref={dialogRef}
            className="composer-dialog"
            aria-labelledby="composer-title"
            aria-describedby="composer-privacy"
            onCancel={(event) => {
              event.preventDefault();
              closeComposer();
            }}
            onClick={(event) => {
              if (event.target === event.currentTarget) closeComposer();
            }}
          >
            <section className="composer-sheet">
              <span className="sheet-handle" />
              <button className="sheet-close" aria-label="Close moment composer" onClick={() => closeComposer()}>×</button>
              {!composerMode ? (
                <>
                  <span id="composer-privacy" className="private-label">Only your family can see this</span>
                  <h2 id="composer-title">What would you like to remember?</h2>
                  <div className="moment-choices">
                    <button ref={firstChoiceRef} onClick={() => setComposerMode('photo')}><span className="choice-icon photo-choice" aria-hidden="true">▣</span><strong>Photo or video</strong><small>A glimpse of the day</small></button>
                    <button onClick={() => setComposerMode('thought')}><span className="choice-icon thought-choice" aria-hidden="true">“</span><strong>A thought</strong><small>A few words to keep</small></button>
                    <button onClick={() => setComposerMode('milestone')}><span className="choice-icon milestone-choice" aria-hidden="true">✦</span><strong>Milestone</strong><small>A meaningful first</small></button>
                    <button onClick={() => setComposerMode('location')}><span className="choice-icon location-choice" aria-hidden="true">⌖</span><strong>A place</strong><small>Somewhere worth returning to</small></button>
                  </div>
                </>
              ) : (
                <form className="quick-compose" onSubmit={(event) => { event.preventDefault(); closeComposer(true); }}>
                  <span id="composer-privacy" className="private-label">New private {composerMode} moment</span>
                  <h2 id="composer-title">Hold onto this moment</h2>
                  <textarea aria-label="Moment text" placeholder="What happened?" value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus />
                  <div className="compose-row"><span>Moment date</span><button type="button">Today ›</button></div>
                  <div className="compose-row"><span>Journal</span><button type="button">Mine ›</button></div>
                  <button className="save-moment" type="submit">Save moment</button>
                </form>
              )}
            </section>
          </dialog>
        )}
      </section>
    </main>
  );
}
