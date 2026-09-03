"use client";

import { useEffect, useRef, useState } from "react";
import {
  type BibleVerse,
  type BibleVerseSelection,
  bibleBookNames,
  chaptersInBook,
  endingVersesInChapter,
  loadWebCatalog,
  previewBiblePassage,
  selectBiblePassage,
  formatBibleVerseReference,
  versesInChapter,
} from "./bible-verse-catalog";

// Composer spec: Bible verse stays its own † mode on the entry tab. Book,
// chapter, starting verse, and ending verse use the same closed-row custom
// pickers as moment date/time. Selecting a range fills a WEB moment. A live
// preview of that World English Bible text sits below the pickers and updates
// as soon as a starting verse exists, then expands or shrinks when the ending
// verse changes. No search box, no licensed translation, no new tab.

type BibleVerseFieldsProps = Readonly<{
  value: BibleVerseSelection;
  onChange: (value: BibleVerseSelection, passage: BibleVerse | null) => void;
  bookTriggerRef?: React.RefObject<HTMLButtonElement | null>;
}>;

type OpenPicker = "book" | "chapter" | "start" | "end" | null;

function bookLabel(book: string | null) {
  return book ?? "Choose book";
}

function chapterLabel(chapter: number | null) {
  return chapter ? String(chapter) : "Choose chapter";
}

function verseLabel(verse: number | null) {
  return verse ? String(verse) : "Choose verse";
}

export function BibleVerseFields({
  value,
  onChange,
  bookTriggerRef,
}: BibleVerseFieldsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const passageRequestRef = useRef(0);
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null);
  const [catalogReady, setCatalogReady] = useState(false);
  const [asyncPreview, setAsyncPreview] = useState<BibleVerse | null>(null);

  useEffect(() => {
    void loadWebCatalog().then(() => setCatalogReady(true));
  }, []);

  const complete = Boolean(
    value.book && value.chapter && value.startVerse && value.endVerse,
  );
  const requestedReference =
    complete &&
    value.book &&
    value.chapter &&
    value.startVerse &&
    value.endVerse
      ? formatBibleVerseReference(
          value.book,
          value.chapter,
          value.startVerse,
          value.endVerse,
        )
      : null;
  const syncPreview =
    catalogReady &&
    value.book &&
    value.chapter &&
    value.startVerse &&
    value.endVerse
      ? previewBiblePassage(
          value.book,
          value.chapter,
          value.startVerse,
          value.endVerse,
        )
      : null;
  const preview =
    syncPreview ??
    (asyncPreview &&
    requestedReference &&
    asyncPreview.reference === requestedReference
      ? asyncPreview
      : null);

  useEffect(() => {
    if (!complete || syncPreview || !requestedReference) return;
    if (
      value.book == null ||
      value.chapter == null ||
      value.startVerse == null ||
      value.endVerse == null
    ) {
      return;
    }
    const requestId = ++passageRequestRef.current;
    void selectBiblePassage(
      value.book,
      value.chapter,
      value.startVerse,
      value.endVerse,
    ).then((passage) => {
      if (passageRequestRef.current !== requestId) return;
      setAsyncPreview(passage);
    });
  }, [
    complete,
    requestedReference,
    syncPreview,
    value.book,
    value.chapter,
    value.endVerse,
    value.startVerse,
  ]);

  useEffect(() => {
    if (!openPicker) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpenPicker(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPicker(null);
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [openPicker]);

  const toggle = (picker: OpenPicker) => {
    setOpenPicker((current) => (current === picker ? null : picker));
  };

  const commit = (next: BibleVerseSelection) => {
    const requestId = ++passageRequestRef.current;
    const nextComplete = Boolean(
      next.book && next.chapter && next.startVerse && next.endVerse,
    );
    if (!nextComplete) {
      setAsyncPreview(null);
      onChange(next, null);
      return;
    }

    const immediate = previewBiblePassage(
      next.book!,
      next.chapter!,
      next.startVerse!,
      next.endVerse!,
    );
    if (immediate) {
      setAsyncPreview(immediate);
      onChange(next, immediate);
      return;
    }

    onChange(next, null);
    void selectBiblePassage(
      next.book!,
      next.chapter!,
      next.startVerse!,
      next.endVerse!,
    ).then((passage) => {
      if (passageRequestRef.current !== requestId) return;
      setAsyncPreview(passage);
      onChange(next, passage);
    });
  };

  const chapters = value.book ? chaptersInBook(value.book) : [];
  const startVerses =
    value.book && value.chapter
      ? versesInChapter(value.book, value.chapter)
      : [];
  const endVerses =
    value.book && value.chapter && value.startVerse
      ? endingVersesInChapter(value.book, value.chapter, value.startVerse)
      : [];

  return (
    <div
      ref={rootRef}
      className="composer-date-time-fields composer-bible-verse-fields"
    >
      <div className="composer-date-time-triggers">
        <div className="composer-field composer-picker-field">
          <span>Book</span>
          <button
            ref={bookTriggerRef}
            type="button"
            className="composer-picker-trigger"
            aria-label={`Book, ${bookLabel(value.book)}`}
            aria-haspopup="dialog"
            aria-expanded={openPicker === "book"}
            onClick={() => toggle("book")}
          >
            <span className={value.book ? undefined : "composer-picker-empty"}>
              {bookLabel(value.book)}
            </span>
            <span aria-hidden="true">⌄</span>
          </button>
        </div>
        <div className="composer-field composer-picker-field">
          <span>Chapter</span>
          <button
            type="button"
            className="composer-picker-trigger"
            aria-label={`Chapter, ${chapterLabel(value.chapter)}`}
            aria-haspopup="dialog"
            aria-expanded={openPicker === "chapter"}
            disabled={!value.book}
            onClick={() => toggle("chapter")}
          >
            <span
              className={value.chapter ? undefined : "composer-picker-empty"}
            >
              {chapterLabel(value.chapter)}
            </span>
            <span aria-hidden="true">⌄</span>
          </button>
        </div>
        <div className="composer-field composer-picker-field">
          <span>Starting verse</span>
          <button
            type="button"
            className="composer-picker-trigger"
            aria-label={`Starting verse, ${verseLabel(value.startVerse)}`}
            aria-haspopup="dialog"
            aria-expanded={openPicker === "start"}
            disabled={!value.chapter}
            onClick={() => toggle("start")}
          >
            <span
              className={value.startVerse ? undefined : "composer-picker-empty"}
            >
              {verseLabel(value.startVerse)}
            </span>
            <span aria-hidden="true">⌄</span>
          </button>
        </div>
        <div className="composer-field composer-picker-field">
          <span>Ending verse</span>
          <button
            type="button"
            className="composer-picker-trigger"
            aria-label={`Ending verse, ${verseLabel(value.endVerse)}`}
            aria-haspopup="dialog"
            aria-expanded={openPicker === "end"}
            disabled={!value.startVerse}
            onClick={() => toggle("end")}
          >
            <span
              className={value.endVerse ? undefined : "composer-picker-empty"}
            >
              {verseLabel(value.endVerse)}
            </span>
            <span aria-hidden="true">⌄</span>
          </button>
        </div>
      </div>

      {openPicker === "book" ? (
        <section
          className="composer-picker-panel"
          role="dialog"
          aria-label="Choose book"
        >
          <div className="composer-journal-menu" role="menu">
            {bibleBookNames().map((book) => {
              const isSelected = book === value.book;
              return (
                <button
                  key={book}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isSelected}
                  onClick={() => {
                    commit({
                      book,
                      chapter: null,
                      startVerse: null,
                      endVerse: null,
                    });
                    setOpenPicker(null);
                  }}
                >
                  <span>
                    <strong>{book}</strong>
                  </span>
                  <span aria-hidden="true">{isSelected ? "✓" : ""}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {openPicker === "chapter" ? (
        <NumberPickerPanel
          label="Choose chapter"
          values={chapters}
          selected={value.chapter}
          optionLabel={(chapter) => `Chapter ${chapter}`}
          onSelect={(chapter) => {
            commit({
              book: value.book,
              chapter,
              startVerse: null,
              endVerse: null,
            });
            setOpenPicker(null);
          }}
        />
      ) : null}

      {openPicker === "start" ? (
        <NumberPickerPanel
          label="Choose starting verse"
          values={startVerses}
          selected={value.startVerse}
          optionLabel={(verse) => `Starting verse ${verse}`}
          onSelect={(startVerse) => {
            const endVerse =
              value.endVerse && value.endVerse >= startVerse
                ? value.endVerse
                : startVerse;
            commit({
              ...value,
              startVerse,
              endVerse,
            });
            setOpenPicker(null);
          }}
        />
      ) : null}

      {openPicker === "end" ? (
        <NumberPickerPanel
          label="Choose ending verse"
          values={endVerses}
          selected={value.endVerse}
          optionLabel={(verse) => `Ending verse ${verse}`}
          onSelect={(endVerse) => {
            commit({
              ...value,
              endVerse,
            });
            setOpenPicker(null);
          }}
        />
      ) : null}

      {preview ? (
        <label className="composer-field">
          <span>
            Verse text <small>WEB</small>
          </span>
          <textarea
            readOnly
            aria-label="Verse text"
            aria-live="polite"
            value={preview.text}
          />
        </label>
      ) : null}
    </div>
  );
}

function NumberPickerPanel({
  label,
  values,
  selected,
  optionLabel,
  onSelect,
}: Readonly<{
  label: string;
  values: readonly number[];
  selected: number | null;
  optionLabel: (value: number) => string;
  onSelect: (value: number) => void;
}>) {
  return (
    <section
      className="composer-picker-panel composer-calendar-panel"
      role="dialog"
      aria-label={label}
    >
      <div className="composer-calendar-grid">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            aria-label={optionLabel(value)}
            aria-pressed={value === selected}
            onClick={() => onSelect(value)}
          >
            {value}
          </button>
        ))}
      </div>
    </section>
  );
}
