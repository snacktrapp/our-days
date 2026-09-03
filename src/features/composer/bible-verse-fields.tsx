"use client";

import { useEffect, useRef, useState } from "react";
import {
  type BibleVerse,
  type BibleVerseSelection,
  bibleBookNames,
  chaptersInBook,
  endingVersesInChapter,
  loadWebCatalog,
  selectBiblePassage,
  versesInChapter,
} from "./bible-verse-catalog";

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

  useEffect(() => {
    void loadWebCatalog();
  }, []);

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
    const complete = Boolean(
      next.book && next.chapter && next.startVerse && next.endVerse,
    );
    if (!complete) {
      onChange(next, null);
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
