export const dailyPrayerBodyPrefix = "OD:daily-prayer\n";

export type DailyPrayerAnswers = Readonly<{
  thanks: readonly [string, string, string];
  showUp: string;
  prayers: readonly [string, string, string];
  affirm: string;
}>;

export type DailyPrayerVerse = Readonly<{
  reference: string;
  text: string;
}>;

export type DailyPrayerMoment = DailyPrayerAnswers &
  Readonly<{
    reference: string;
    verse: string;
  }>;

export const emptyDailyPrayerAnswers: DailyPrayerAnswers = {
  thanks: ["", "", ""],
  showUp: "",
  prayers: ["", "", ""],
  affirm: "",
};

export const dailyPrayerVerses: readonly DailyPrayerVerse[] = [
  {
    reference: "Ezekiel 36:26",
    text: "And I will give you a new heart, and I will put a new spirit in you. I will take out your stony, stubborn heart and give you a tender, responsive heart.",
  },
  {
    reference: "Lamentations 3:22-23",
    text: "The faithful love of the Lord never ends! His mercies never cease. Great is his faithfulness; his mercies begin afresh each morning.",
  },
  {
    reference: "Psalm 143:8",
    text: "Let me hear of your unfailing love each morning, for I am trusting you. Show me where to walk, for I give myself to you.",
  },
  {
    reference: "Philippians 4:6-7",
    text: "Don’t worry about anything; instead, pray about everything. Tell God what you need, and thank him for all he has done. Then you will experience God’s peace, which exceeds anything we can understand.",
  },
  {
    reference: "Isaiah 26:3",
    text: "You will keep in perfect peace all who trust in you, all whose thoughts are fixed on you!",
  },
  {
    reference: "Psalm 51:10",
    text: "Create in me a clean heart, O God. Renew a loyal spirit within me.",
  },
  {
    reference: "Matthew 6:33",
    text: "Seek the Kingdom of God above all else, and live righteously, and he will give you everything you need.",
  },
  {
    reference: "Colossians 3:12",
    text: "Since God chose you to be the holy people he loves, you must clothe yourselves with tenderhearted mercy, kindness, humility, gentleness, and patience.",
  },
  {
    reference: "James 1:5",
    text: "If you need wisdom, ask our generous God, and he will give it to you. He will not rebuke you for asking.",
  },
  {
    reference: "Psalm 90:14",
    text: "Satisfy us each morning with your unfailing love, so we may sing for joy to the end of our lives.",
  },
];

const momentBodyLimit = 4000;
const lineLimit = 200;
const paragraphLimit = 1200;

function utcDayIndex(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return 0;
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function dailyPrayerVerseForDate(isoDate: string) {
  const verses = dailyPrayerVerses;
  return verses[Math.abs(utcDayIndex(isoDate)) % verses.length]!;
}

function trimLine(value: unknown, max = lineLimit) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/gu, " ").trim().slice(0, max);
}

function trimParagraph(value: unknown, max = paragraphLimit) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function threeLines(value: unknown): [string, string, string] {
  if (!Array.isArray(value)) return ["", "", ""];
  return [trimLine(value[0]), trimLine(value[1]), trimLine(value[2])];
}

export function normalizeDailyPrayerAnswers(
  input: Partial<DailyPrayerAnswers> | null | undefined,
): DailyPrayerAnswers {
  return {
    thanks: threeLines(input?.thanks),
    showUp: trimParagraph(input?.showUp),
    prayers: threeLines(input?.prayers),
    affirm: trimParagraph(input?.affirm),
  };
}

export function dailyPrayerHasAnswers(answers: DailyPrayerAnswers) {
  return (
    answers.thanks.some((line) => line.length > 0) ||
    answers.prayers.some((line) => line.length > 0) ||
    answers.showUp.length > 0 ||
    answers.affirm.length > 0
  );
}

export function formatDailyPrayerMoment(
  verse: DailyPrayerVerse,
  answers: DailyPrayerAnswers,
) {
  const normalized = normalizeDailyPrayerAnswers(answers);
  const payload = {
    v: 1,
    ref: verse.reference.trim(),
    verse: verse.text.trim(),
    thanks: normalized.thanks,
    showUp: normalized.showUp,
    prayers: normalized.prayers,
    affirm: normalized.affirm,
  };
  const body = `${dailyPrayerBodyPrefix}${JSON.stringify(payload)}`;
  return body.length <= momentBodyLimit ? body : body.slice(0, momentBodyLimit);
}

export function parseDailyPrayerMoment(body: string): DailyPrayerMoment | null {
  if (!body.startsWith(dailyPrayerBodyPrefix)) return null;
  try {
    const parsed = JSON.parse(body.slice(dailyPrayerBodyPrefix.length)) as {
      v?: unknown;
      ref?: unknown;
      verse?: unknown;
      thanks?: unknown;
      showUp?: unknown;
      prayers?: unknown;
      affirm?: unknown;
    };
    if (parsed.v !== 1) return null;
    const reference = trimLine(parsed.ref, 80);
    const verse = trimParagraph(parsed.verse, 800);
    if (!reference || !verse) return null;
    return {
      reference,
      verse,
      ...normalizeDailyPrayerAnswers({
        thanks: threeLines(parsed.thanks),
        showUp: trimParagraph(parsed.showUp),
        prayers: threeLines(parsed.prayers),
        affirm: trimParagraph(parsed.affirm),
      }),
    };
  } catch {
    return null;
  }
}

export function dailyPrayerPreviewText(moment: DailyPrayerMoment) {
  const firstThanks = moment.thanks.find((line) => line.length > 0);
  return firstThanks || moment.reference;
}
