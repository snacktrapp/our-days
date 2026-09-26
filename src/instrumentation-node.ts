export async function registerNodeInstrumentation() {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.OUR_DAYS_LAB_BLOCKING_CSS === "1") return;

  const { installDeferredDocumentStylesheets } =
    await import("@/lib/defer-document-stylesheet");
  installDeferredDocumentStylesheets();
}
