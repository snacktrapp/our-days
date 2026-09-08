"use client";

import { useState } from "react";
import type { DailyPrayerMoment } from "@/features/daily-prayer/daily-prayer";

function filledLines(lines: readonly string[]) {
  return lines.filter((line) => line.trim().length > 0);
}

export function ExpandableDailyPrayerCopy({
  prayer,
}: Readonly<{
  prayer: DailyPrayerMoment;
}>) {
  const [expanded, setExpanded] = useState(false);
  const thanks = filledLines(prayer.thanks);
  const prayers = filledLines(prayer.prayers);

  return (
    <div className="daily-prayer-copy">
      <button
        className="daily-prayer-toggle"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span>“{prayer.verse}”</span>
        <cite>{prayer.reference} · NLT</cite>
      </button>
      {expanded ? (
        <dl className="daily-prayer-answers">
          {thanks.length > 0 ? (
            <>
              <dt>Thankful for</dt>
              {thanks.map((line) => (
                <dd key={line}>{line}</dd>
              ))}
            </>
          ) : null}
          {prayer.showUp ? (
            <>
              <dt>How I will show up</dt>
              <dd>{prayer.showUp}</dd>
            </>
          ) : null}
          {prayers.length > 0 ? (
            <>
              <dt>Prayers</dt>
              {prayers.map((line) => (
                <dd key={line}>{line}</dd>
              ))}
            </>
          ) : null}
          {prayer.affirm ? (
            <>
              <dt>Who I am</dt>
              <dd>{prayer.affirm}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}
