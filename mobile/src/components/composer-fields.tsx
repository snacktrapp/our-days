import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { CircleMembership } from "../lib/journal";
import { reversePlace, searchPlaces, type GeocodedPlace, type PlaceSelection } from "../lib/places";
import { peopleCountLabel, type CirclePerson } from "../lib/roster";
import { useAppTheme } from "../lib/theme";
import { dotColor, dotInk, face, tracking } from "../lib/tokens";
import { useComposerInput } from "./keyboard-form";

type TimeParts = Readonly<{ hour: number; minute: number; period: "AM" | "PM" }>;

const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const weekdays = ["S", "M", "T", "W", "T", "F", "S"] as const;

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

function toDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function momentDateLabel(value: string) {
  return dateFormatter.format(parseDate(value));
}

function timePartsFromDate(now: Date): TimeParts {
  const roundedMinute = Math.floor(now.getMinutes() / 15) * 15;
  return {
    hour: now.getHours() % 12 || 12,
    minute: roundedMinute,
    period: now.getHours() >= 12 ? "PM" : "AM",
  };
}

function timeParts(value: string): TimeParts {
  if (!value) return timePartsFromDate(new Date());
  const [rawHour, rawMinute] = value.split(":").map(Number);
  return {
    hour: (rawHour ?? 0) % 12 || 12,
    minute: rawMinute ?? 0,
    period: (rawHour ?? 0) >= 12 ? "PM" : "AM",
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

export function currentPickerTimeValue(now = new Date()) {
  return toTimeValue(timePartsFromDate(now));
}

export function formatPickerTimeLabel(value: string) {
  if (!value) return "No time";
  const parts = timeParts(value);
  return `${parts.hour}:${String(parts.minute).padStart(2, "0")} ${parts.period}`;
}

export function occurredInstant(occurredOn: string, occurredTime: string) {
  if (!occurredTime) return { occurredAt: null as string | null, occurredTimezone: null as string | null };
  const local = new Date(`${occurredOn}T${occurredTime}:00`);
  if (Number.isNaN(local.getTime())) return null;
  return {
    occurredAt: local.toISOString(),
    occurredTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export function FieldLabel({
  children,
  optional = false,
}: Readonly<{ children: string; optional?: boolean }>) {
  const { colors } = useAppTheme();
  const retro = colors.appearance === "retro";
  const color = retro ? colors.muted : colors.scheme === "dark" ? "#c4cbc7" : colors.muted;
  return (
    <Text
      style={[
        face(colors, 600, "record"),
        {
          color,
          fontSize: retro ? 11 : 9,
          letterSpacing: tracking(retro ? 11 : 9, 0.08),
          textTransform: "uppercase",
        },
      ]}
    >
      {children}
      {optional ? (
        <Text style={{ fontSize: retro ? 10 : 7, letterSpacing: tracking(retro ? 10 : 7, 0.12) }}>
          <Text style={{ color: colors.ochre }}> · </Text>
          <Text style={{ color: colors.muted, textTransform: "uppercase" }}>Optional</Text>
        </Text>
      ) : null}
    </Text>
  );
}

export function DateTimeFields({
  date,
  maxDate,
  time,
  timeOptional,
  onDateChange,
  onTimeChange,
}: Readonly<{
  date: string;
  maxDate: string;
  time: string;
  timeOptional: boolean;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
}>) {
  const { colors } = useAppTheme();
  const retro = colors.appearance === "retro";
  const [open, setOpen] = useState<"date" | "time" | null>(null);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const selected = parseDate(date);
    return new Date(selected.getFullYear(), selected.getMonth(), 1);
  });
  const [draftTime, setDraftTime] = useState<TimeParts>(() => timeParts(time));
  const maximum = parseDate(maxDate);
  const firstWeekday = visibleMonth.getDay();
  const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day > 0 && day <= daysInMonth ? day : null;
  });
  const nextMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
  const nextBlocked = nextMonth > new Date(maximum.getFullYear(), maximum.getMonth(), 1);
  const trigger = {
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    borderRadius: retro ? 2 : 7,
  };

  return (
    <View style={styles.dateRow}>
      <View style={styles.dateCol}>
        <FieldLabel>Moment date</FieldLabel>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Moment date, ${momentDateLabel(date)}`}
          onPress={() => {
            const selected = parseDate(date);
            setVisibleMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
            setOpen((current) => (current === "date" ? null : "date"));
          }}
          style={[styles.trigger, trigger]}
        >
          <Text style={[face(colors, 400, "record"), { color: colors.ink, fontSize: 13 }]}>
            {momentDateLabel(date)}
          </Text>
          <Text style={{ color: colors.muted }}>▦</Text>
        </Pressable>
      </View>
      <View style={styles.dateCol}>
        <FieldLabel optional={timeOptional}>Time</FieldLabel>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Time, ${formatPickerTimeLabel(time)}`}
          onPress={() => {
            setDraftTime(timeParts(time));
            setOpen((current) => (current === "time" ? null : "time"));
          }}
          style={[styles.trigger, trigger]}
        >
          <Text
            style={[
              face(colors, 400, "record"),
              { color: time ? colors.ink : colors.faint, fontSize: 13 },
            ]}
          >
            {formatPickerTimeLabel(time)}
          </Text>
          <Text style={{ color: colors.muted }}>◷</Text>
        </Pressable>
      </View>
      {open === "date" ? (
        <View style={[styles.panel, { borderColor: colors.hairline, backgroundColor: colors.paper }]}>
          <View style={styles.monthRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              onPress={() =>
                setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))
              }
              style={styles.monthHit}
            >
              <Text style={[face(colors, 600), { color: colors.ink }]}>‹</Text>
            </Pressable>
            <Text style={[face(colors, 650), { color: colors.ink }]}>{monthFormatter.format(visibleMonth)}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next month"
              disabled={nextBlocked}
              onPress={() => setVisibleMonth(nextMonth)}
              style={styles.monthHit}
            >
              <Text style={[face(colors, 600), { color: nextBlocked ? colors.faint : colors.ink }]}>›</Text>
            </Pressable>
          </View>
          <View style={styles.calendar}>
            {weekdays.map((weekday, index) => (
              <Text key={`${weekday}-${index}`} style={[styles.weekday, face(colors, 600), { color: colors.muted }]}>
                {weekday}
              </Text>
            ))}
            {cells.map((day, index) => {
              if (!day) return <View key={`empty-${index}`} />;
              const candidate = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day);
              const value = toDateValue(candidate);
              const unavailable = candidate > maximum;
              const selected = value === date;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={momentDateLabel(value)}
                  accessibilityState={{ selected }}
                  disabled={unavailable}
                  onPress={() => {
                    onDateChange(value);
                    setOpen(null);
                  }}
                  style={[
                    styles.day,
                    selected ? { backgroundColor: colors.action, borderRadius: retro ? 2 : 8 } : null,
                  ]}
                >
                  <Text
                    style={[
                      face(colors, selected ? 650 : 400),
                      { color: unavailable ? colors.faint : selected ? colors.actionInk : colors.ink, fontSize: 13 },
                    ]}
                  >
                    {day}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onDateChange(maxDate);
              setOpen(null);
            }}
          >
            <Text style={[face(colors, 600), { color: colors.action }]}>Today</Text>
          </Pressable>
        </View>
      ) : null}
      {open === "time" ? (
        <View style={[styles.panel, { borderColor: colors.hairline, backgroundColor: colors.paper }]}>
          <View style={styles.timeRow}>
            <TimeColumn
              label="Hour"
              value={String(draftTime.hour)}
              options={Array.from({ length: 12 }, (_, index) => String(index + 1))}
              onChange={(value) => setDraftTime((current) => ({ ...current, hour: Number(value) }))}
            />
            <TimeColumn
              label="Minute"
              value={String(draftTime.minute).padStart(2, "0")}
              options={["00", "15", "30", "45"]}
              onChange={(value) => setDraftTime((current) => ({ ...current, minute: Number(value) }))}
            />
            <TimeColumn
              label="Period"
              value={draftTime.period}
              options={["AM", "PM"]}
              onChange={(value) => setDraftTime((current) => ({ ...current, period: value as "AM" | "PM" }))}
            />
          </View>
          <View style={styles.timeActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onTimeChange("");
                setOpen(null);
              }}
            >
              <Text style={[face(colors, 600), { color: colors.muted }]}>No time</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onTimeChange(toTimeValue(draftTime));
                setOpen(null);
              }}
            >
              <Text style={[face(colors, 650), { color: colors.action }]}>Set time</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function TimeColumn({
  label,
  value,
  options,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}>) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.timeCol}>
      <Text style={[face(colors, 600, "record"), { color: colors.muted, fontSize: 8, letterSpacing: tracking(8, 0.08) }]}>
        {label.toUpperCase()}
      </Text>
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable key={option} accessibilityRole="button" onPress={() => onChange(option)} style={styles.timeOption}>
            <Text style={[face(colors, selected ? 650 : 400), { color: selected ? colors.action : colors.ink }]}>
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

async function locateHere(
  setMessage: (value: string | null) => void,
  onPlace: (value: PlaceSelection) => void,
) {
  setMessage(null);
  try {
    let latitude: number;
    let longitude: number;
    if (Platform.OS === "web") {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 30_000,
          timeout: 12_000,
        });
      });
      latitude = position.coords.latitude;
      longitude = position.coords.longitude;
    } else {
      const Location = await import("expo-location");
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setMessage("Location isn’t available right now.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      latitude = position.coords.latitude;
      longitude = position.coords.longitude;
    }
    const named = await reversePlace(latitude, longitude);
    onPlace({
      label: named || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
      latitude,
      longitude,
    });
  } catch {
    setMessage("Location isn’t available right now.");
  }
}

export function PlaceFields({
  value,
  onChange,
}: Readonly<{
  value: PlaceSelection;
  onChange: (value: PlaceSelection) => void;
}>) {
  const { colors } = useAppTheme();
  const retro = colors.appearance === "retro";
  const [search, setSearch] = useState(value.label);
  const [suggestions, setSuggestions] = useState<readonly GeocodedPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canLocate =
    Platform.OS !== "web" || (typeof navigator !== "undefined" && "geolocation" in navigator);
  const placeInput = useComposerInput("place");

  useEffect(() => {
    if (search.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      void searchPlaces(search.trim(), controller.signal)
        .then((places) => {
          setSuggestions(places);
          setMessage(places.length === 0 ? "No matching places." : null);
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === "AbortError") return;
          setSuggestions([]);
          setMessage("Place search isn’t available right now.");
        })
        .finally(() => setSearching(false));
    }, 280);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search]);

  return (
    <View style={styles.stack}>
      <FieldLabel optional>Add a place</FieldLabel>
      <TextInput
        {...placeInput}
        value={search}
        placeholder="Search or locate"
        placeholderTextColor={colors.faint}
        maxLength={160}
        accessibilityLabel="Place name"
        onChangeText={(next) => {
          setSearch(next);
          setSuggestions([]);
          setSearching(false);
          setMessage(null);
          onChange(next.trim() ? { ...value, label: next } : { label: "", latitude: null, longitude: null });
        }}
        style={[
          styles.input,
          face(colors, 400, "record"),
          {
            color: colors.ink,
            borderColor: colors.hairline,
            backgroundColor: colors.surface,
            borderRadius: retro ? 2 : 7,
          },
        ]}
      />
      {canLocate ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void locateHere(setMessage, (next) => {
              setSearch(next.label);
              setSuggestions([]);
              onChange(next);
            });
          }}
        >
          <Text style={[face(colors, 400, "record"), { color: colors.action, fontSize: 13 }]}>⌖ Use my location</Text>
        </Pressable>
      ) : null}
      {searching ? <Text style={[face(colors, 400), { color: colors.muted, fontSize: 12 }]}>Looking up places…</Text> : null}
      {message ? <Text style={[face(colors, 400), { color: colors.muted, fontSize: 12 }]}>{message}</Text> : null}
      {suggestions.map((place) => (
        <Pressable
          key={`${place.label}-${place.latitude}`}
          accessibilityRole="button"
          onPress={() => {
            setSearch(place.label);
            setSuggestions([]);
            setMessage(null);
            onChange({ label: place.label, latitude: place.latitude, longitude: place.longitude });
          }}
          style={styles.suggestion}
        >
          <Text style={[face(colors, 500), { color: colors.ink }]}>{place.label}</Text>
          {place.detail && place.detail !== place.label ? (
            <Text style={[face(colors, 400), { color: colors.muted, fontSize: 11 }]}>{place.detail}</Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

export function AudienceChips({
  circles,
  counts,
  justMe,
  circleId,
  onJustMe,
  onCircle,
}: Readonly<{
  circles: readonly CircleMembership[];
  counts: ReadonlyMap<string, number>;
  justMe: boolean;
  circleId: string;
  onJustMe: (value: boolean) => void;
  onCircle: (id: string) => void;
}>) {
  const { colors } = useAppTheme();
  const retro = colors.appearance === "retro";
  return (
    <View style={styles.stack}>
      <FieldLabel>Who can see this?</FieldLabel>
      <View style={styles.chips}>
        {circles.map((circle) => {
          const selected = !justMe && circle.circleId === circleId;
          const count = counts.get(circle.circleId);
          return (
            <Pressable
              key={circle.circleId}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              onPress={() => onCircle(circle.circleId)}
              style={[styles.chip, chipStyle(colors, retro, selected)]}
            >
              <Text style={chipText(colors, retro, selected)}>{circle.name}</Text>
              {typeof count === "number" ? (
                <Text
                  style={[
                    face(colors, retro ? 700 : 400),
                    {
                      color: colors.muted,
                      fontSize: 11,
                      letterSpacing: retro ? tracking(11, 0.08) : 0,
                      textTransform: retro ? "uppercase" : "none",
                    },
                  ]}
                >
                  {peopleCountLabel(count)}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: justMe }}
          onPress={() => onJustMe(true)}
          style={[styles.chip, chipStyle(colors, retro, justMe)]}
        >
          <Text style={chipText(colors, retro, justMe)}>Just me</Text>
        </Pressable>
      </View>
    </View>
  );
}

function chipStyle(
  colors: ReturnType<typeof useAppTheme>["colors"],
  retro: boolean,
  selected: boolean,
) {
  if (retro) {
    return {
      borderColor: selected ? colors.action : colors.hairline,
      backgroundColor: selected ? "rgba(232,116,59,0.14)" : "transparent",
      borderRadius: 999,
    };
  }
  return {
    borderColor: selected ? colors.action : colors.hairline,
    backgroundColor: selected ? colors.selectionFill : "transparent",
    borderRadius: 13,
  };
}

function chipText(
  colors: ReturnType<typeof useAppTheme>["colors"],
  retro: boolean,
  selected: boolean,
) {
  return [
    face(colors, retro ? 700 : 400, "record"),
    {
      color: retro ? (selected ? colors.action : colors.muted) : colors.ink,
      fontSize: retro ? 11 : 14,
      letterSpacing: retro ? tracking(11, 0.08) : 0,
      textTransform: retro ? ("uppercase" as const) : ("none" as const),
    },
  ];
}

export function PeopleFields({
  people,
  selectedIds,
  onToggle,
}: Readonly<{
  people: readonly CirclePerson[];
  selectedIds: readonly string[];
  onToggle: (id: string) => void;
}>) {
  const { colors } = useAppTheme();
  const retro = colors.appearance === "retro";
  if (people.length === 0) return null;
  return (
    <View style={styles.stack}>
      <FieldLabel>Who else was part of this?</FieldLabel>
      <View style={styles.people}>
        {people.map((person) => {
          const selected = selectedIds.includes(person.id);
          return (
            <Pressable
              key={person.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              onPress={() => onToggle(person.id)}
              style={[
                styles.person,
                {
                  borderColor: selected ? colors.action : colors.hairline,
                  backgroundColor: selected ? colors.selectionFill : retro ? "transparent" : colors.cream,
                  borderRadius: 13,
                },
              ]}
            >
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: retro ? colors.action : dotColor(person.accent, colors),
                  },
                ]}
              >
                <Text
                  style={[
                    face(colors, 700),
                    { color: retro ? colors.actionInk : dotInk(person.accent, colors), fontSize: 9 },
                  ]}
                >
                  {person.initial}
                </Text>
              </View>
              <Text style={[face(colors, 400), { color: colors.ink, fontSize: 12, flex: 1 }]}>{person.name}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 6 },
  dateRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  dateCol: { flexGrow: 1, flexBasis: "46%", gap: 6 },
  trigger: {
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  panel: { width: "100%", borderWidth: 1, borderRadius: 8, padding: 10, gap: 8 },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthHit: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  calendar: { flexDirection: "row", flexWrap: "wrap" },
  weekday: { width: "14.28%", textAlign: "center", fontSize: 11, paddingVertical: 4 },
  day: { width: "14.28%", minHeight: 36, alignItems: "center", justifyContent: "center" },
  timeRow: { flexDirection: "row", gap: 8 },
  timeCol: { flex: 1, gap: 2 },
  timeOption: { minHeight: 32, justifyContent: "center" },
  timeActions: { flexDirection: "row", justifyContent: "space-between", minHeight: 44, alignItems: "center" },
  input: { borderWidth: 1, minHeight: 44, paddingHorizontal: 12, fontSize: 16 },
  suggestion: { minHeight: 44, justifyContent: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, justifyContent: "center" },
  people: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  person: {
    width: "47%",
    minHeight: 44,
    paddingHorizontal: 9,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  dot: { width: 25, height: 25, borderRadius: 13, alignItems: "center", justifyContent: "center" },
});
