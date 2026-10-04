import catalog from "../../../src/features/composer/data/web-catalog.json" with { type: "json" };

/** World English Bible text, shared with the web composer. Loaded only for a verse. */
const bibleCatalog = catalog as Readonly<{
  books: readonly {
    name: string;
    chapters: readonly (readonly string[])[];
  }[];
}>;

export default bibleCatalog;
