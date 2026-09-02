"use client";

import { useEffect, useRef, useState } from "react";

type DateTimeFieldsProps = Readonly<{
  date: string;
  maxDate?: string;
  time: string;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
}>;

type OpenPicker = "date" | "time" | null;

type TimeParts = Readonly<{
  hour: number;
  minute: number;
  period: "AM" | "PM";
}>;

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const weekdays = ["S", "M", "T", "W", "T", "F", "S"] as const;

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateLabel(value: string) {
  return dateFormatter.format(parseDate(value));
}

function timeParts(value: string): TimeParts {
  if (value) {
    const [rawHour, rawMinute] = value.split(":").map(Number);
    return {
      hour: rawHour % 12 || 12,
      minute: rawMinute,
      period: rawHour >= 12 ? "PM" : "AM",
    };
  }

  const now = new Date();
  const roundedMinute = Math.floor(now.getMinutes() / 15) * 15;
  return {
    hour: now.getHours() % 12 || 12,
    minute: roundedMinute,
    period: now.getHours() >= 12 ? "PM" : "AM",
  };
}

function toTimeValue(parts: TimeParts) {
  const hour =
    parts.period === "PM"
      ? parts.hour === 12
        ? 12
        : parts.hour + 12
      : parts.hour === 12
        ? 0
        : parts.hour;
  return `${String(hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function timeLabel(value: string) {
  if (!value) return "No time";
  const parts = timeParts(value);
  return `${parts.hour}:${String(parts.minute).padStart(2, "0")} ${parts.period}`;
}

export function DateTimeFields({
  date,
  maxDate,
  time,
  onDateChange,
  onTimeChange,
}: DateTimeFieldsProps) {
  const effectiveMaxDate = maxDate ?? toDateValue(new Date());
  const rootRef = useRef<HTMLDivElement>(null);
  const [openPicker, setOpenPicker] = useState<OpenPicker>(null);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const selected = parseDate(date);
    return new Date(selected.getFullYear(), selected.getMonth(), 1);
  });
  const [draftTime, setDraftTime] = useState<TimeParts>(() => timeParts(time));

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

  const maximumDate = parseDate(effectiveMaxDate);
  const firstWeekday = visibleMonth.getDay();
  const daysInMonth = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth() + 1,
    0,
  ).getDate();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day > 0 && day <= daysInMonth ? day : null;
  });
  const nextMonth = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth() + 1,
    1,
  );
  const nextMonthUnavailable =
    nextMonth > new Date(maximumDate.getFullYear(), maximumDate.getMonth(), 1);

  const openDatePicker = () => {
    const selected = parseDate(date);
    setVisibleMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    setOpenPicker((current) => (current === "date" ? null : "date"));
  };

  const openTimePicker = () => {
    setDraftTime(timeParts(time));
    setOpenPicker((current) => (current === "time" ? null : "time"));
  };

  return (
    <div ref={rootRef} className="composer-date-time-fields">
      <div className="composer-date-time-triggers">
        <div className="composer-field composer-picker-field">
          <span>Moment date</span>
          <button
            type="button"
            className="composer-picker-trigger"
            aria-haspopup="dialog"
            aria-expanded={openPicker === "date"}
            onClick={openDatePicker}
          >
            <span>{dateLabel(date)}</span>
            <span aria-hidden="true">▦</span>
          </button>
        </div>
        <div className="composer-field composer-picker-field">
          <span>
            Time <small>Optional</small>
          </span>
          <button
            type="button"
            className="composer-picker-trigger"
            aria-haspopup="dialog"
            aria-expanded={openPicker === "time"}
            onClick={openTimePicker}
          >
            <span className={time ? undefined : "composer-picker-empty"}>
              {timeLabel(time)}
            </span>
            <span aria-hidden="true">◷</span>
          </button>
        </div>
      </div>

      {openPicker === "date" ? (
        <section
          className="composer-picker-panel composer-calendar-panel"
          role="dialog"
          aria-label="Choose moment date"
        >
          <div className="composer-calendar-heading">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() =>
                setVisibleMonth(
                  (current) =>
                    new Date(current.getFullYear(), current.getMonth() - 1, 1),
                )
              }
            >
              ‹
            </button>
            <strong>{monthFormatter.format(visibleMonth)}</strong>
            <button
              type="button"
              aria-label="Next month"
              disabled={nextMonthUnavailable}
              onClick={() => setVisibleMonth(nextMonth)}
            >
              ›
            </button>
          </div>
          <div className="composer-calendar-grid" aria-hidden="true">
            {weekdays.map((weekday, index) => (
              <span key={`${weekday}-${index}`}>{weekday}</span>
            ))}
          </div>
          <div className="composer-calendar-grid">
            {cells.map((day, index) => {
              if (!day) return <span key={`empty-${index}`} />;
              const candidate = new Date(
                visibleMonth.getFullYear(),
                visibleMonth.getMonth(),
                day,
              );
              const value = toDateValue(candidate);
              const unavailable = candidate > maximumDate;
              return (
                <button
                  key={value}
                  type="button"
                  aria-label={dateLabel(value)}
                  aria-pressed={value === date}
                  disabled={unavailable}
                  onClick={() => {
                    onDateChange(value);
                    setOpenPicker(null);
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="composer-picker-secondary"
            onClick={() => {
              onDateChange(effectiveMaxDate);
              setOpenPicker(null);
            }}
          >
            Today
          </button>
        </section>
      ) : null}

      {openPicker === "time" ? (
        <section
          className="composer-picker-panel composer-time-panel"
          role="dialog"
          aria-label="Choose optional time"
        >
          <div className="composer-time-controls">
            <label>
              <span>Hour</span>
              <select
                aria-label="Hour"
                value={draftTime.hour}
                onChange={(event) =>
                  setDraftTime((current) => ({
                    ...current,
                    hour: Number(event.target.value),
                  }))
                }
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map(
                  (hour) => (
                    <option key={hour} value={hour}>
                      {hour}
                    </option>
                  ),
                )}
              </select>
            </label>
            <span aria-hidden="true">:</span>
            <label>
              <span>Minute</span>
              <select
                aria-label="Minute"
                value={draftTime.minute}
                onChange={(event) =>
                  setDraftTime((current) => ({
                    ...current,
                    minute: Number(event.target.value),
                  }))
                }
              >
                {[0, 15, 30, 45].map((minute) => (
                  <option key={minute} value={minute}>
                    {String(minute).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Period</span>
              <select
                aria-label="AM or PM"
                value={draftTime.period}
                onChange={(event) =>
                  setDraftTime((current) => ({
                    ...current,
                    period: event.target.value as TimeParts["period"],
                  }))
                }
              >
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </label>
          </div>
          <div className="composer-picker-actions">
            <button
              type="button"
              className="composer-picker-secondary"
              onClick={() => {
                onTimeChange("");
                setOpenPicker(null);
              }}
            >
              No time
            </button>
            <button
              type="button"
              className="composer-picker-primary"
              onClick={() => {
                onTimeChange(toTimeValue(draftTime));
                setOpenPicker(null);
              }}
            >
              Set time
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
