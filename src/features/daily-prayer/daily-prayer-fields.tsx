"use client";

import type { DailyPrayerAnswers, DailyPrayerVerse } from "./daily-prayer";

export function DailyPrayerFields({
  verse,
  answers,
  onChange,
}: Readonly<{
  verse: DailyPrayerVerse;
  answers: DailyPrayerAnswers;
  onChange: (next: DailyPrayerAnswers) => void;
}>) {
  const setThanks = (index: 0 | 1 | 2, value: string) => {
    const thanks = [...answers.thanks] as [string, string, string];
    thanks[index] = value;
    onChange({ ...answers, thanks });
  };
  const setPrayers = (index: 0 | 1 | 2, value: string) => {
    const prayers = [...answers.prayers] as [string, string, string];
    prayers[index] = value;
    onChange({ ...answers, prayers });
  };

  return (
    <div className="composer-daily-prayer-fields">
      <p className="composer-daily-prayer-verse">
        <span>Today’s scripture</span>
        <q>{verse.text}</q>
        <cite>{verse.reference} · NLT</cite>
      </p>
      <fieldset className="composer-field">
        <legend>
          What are 3 things that I can thank God for this morning?
        </legend>
        {answers.thanks.map((line, index) => (
          <input
            key={`thanks-${index}`}
            type="text"
            value={line}
            maxLength={200}
            placeholder={`Thankful for… ${index + 1}`}
            onChange={(event) =>
              setThanks(index as 0 | 1 | 2, event.target.value)
            }
          />
        ))}
      </fieldset>
      <label className="composer-field">
        <span>
          Knowing my schedule for today, how can I intentionally show up more
          like Jesus would? How can I embody love, joy, generosity and
          acceptance towards others today?
        </span>
        <textarea
          value={answers.showUp}
          maxLength={1200}
          placeholder="How I will show up…"
          onChange={(event) =>
            onChange({ ...answers, showUp: event.target.value })
          }
        />
      </label>
      <fieldset className="composer-field">
        <legend>What are my 3 prayers for today?</legend>
        {answers.prayers.map((line, index) => (
          <input
            key={`prayer-${index}`}
            type="text"
            value={line}
            maxLength={200}
            placeholder={`Prayer ${index + 1}`}
            onChange={(event) =>
              setPrayers(index as 0 | 1 | 2, event.target.value)
            }
          />
        ))}
      </fieldset>
      <label className="composer-field">
        <span>Affirm who I am in the eyes of God</span>
        <textarea
          value={answers.affirm}
          maxLength={1200}
          placeholder="I am…"
          onChange={(event) =>
            onChange({ ...answers, affirm: event.target.value })
          }
        />
      </label>
    </div>
  );
}
