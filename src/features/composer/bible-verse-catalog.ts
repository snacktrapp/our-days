export type BibleVerse = Readonly<{
  reference: string;
  text: string;
}>;

// This small local starter library keeps searches on the device. The World
// English Bible is public domain; a complete offline text can replace this
// catalog later without changing the composer interface.
export const bibleVerseCatalog: readonly BibleVerse[] = [
  {
    reference: "Genesis 1:1",
    text: "In the beginning, God created the heavens and the earth.",
  },
  {
    reference: "Psalm 23:1",
    text: "Yahweh is my shepherd; I shall lack nothing.",
  },
  {
    reference: "Proverbs 3:5–6",
    text: "Trust in Yahweh with all your heart, and don’t lean on your own understanding. In all your ways acknowledge him, and he will make your paths straight.",
  },
  {
    reference: "Isaiah 41:10",
    text: "Don’t you be afraid, for I am with you. Don’t be dismayed, for I am your God. I will strengthen you. Yes, I will help you. Yes, I will uphold you with the right hand of my righteousness.",
  },
  {
    reference: "Jeremiah 29:11",
    text: "For I know the thoughts that I think toward you, says Yahweh, thoughts of peace, and not of evil, to give you hope and a future.",
  },
  {
    reference: "Matthew 6:33",
    text: "But seek first God’s Kingdom and his righteousness; and all these things will be given to you as well.",
  },
  {
    reference: "John 3:16",
    text: "For God so loved the world, that he gave his only born Son, that whoever believes in him should not perish, but have eternal life.",
  },
  {
    reference: "Romans 8:28",
    text: "We know that all things work together for good for those who love God, for those who are called according to his purpose.",
  },
  {
    reference: "1 Corinthians 13:4–7",
    text: "Love is patient and is kind. Love doesn’t envy. Love doesn’t brag, is not proud, doesn’t behave itself inappropriately, doesn’t seek its own way, is not provoked, takes no account of evil; doesn’t rejoice in unrighteousness, but rejoices with the truth; bears all things, believes all things, hopes all things, and endures all things.",
  },
  {
    reference: "Philippians 4:13",
    text: "I can do all things through Christ who strengthens me.",
  },
];

function searchable(value: string) {
  return value
    .toLocaleLowerCase("en-US")
    .replaceAll(/[–—:;,.’“”‘'!?]/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

export function searchBibleVerses(query: string) {
  const terms = searchable(query).split(" ").filter(Boolean);
  if (terms.length === 0) return bibleVerseCatalog.slice(0, 5);
  return bibleVerseCatalog.filter((verse) => {
    const haystack = searchable(`${verse.reference} ${verse.text}`);
    return terms.every((term) => haystack.includes(term));
  });
}

export function formatBibleVerseMoment(reference: string, text: string) {
  return `${text.trim()}\n\n— ${reference.trim()} · World English Bible`;
}
