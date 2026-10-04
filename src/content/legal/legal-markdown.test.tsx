import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGAL_DRAFT_BANNER } from "./draft-banner";
import { LegalDocument } from "./legal-document";

function readDraft(name: string) {
  return readFileSync(join(process.cwd(), "src/content/legal", name), "utf8");
}

describe("public legal drafts", () => {
  it("keeps the draft banner and bracketed placeholders visible", () => {
    render(<LegalDocument source={readDraft("privacy-policy.md")} />);

    expect(
      screen.getByRole("heading", { name: "Our Days Privacy Policy" }),
    ).toBeVisible();
    expect(screen.getByRole("note")).toHaveTextContent(LEGAL_DRAFT_BANNER);
    expect(LEGAL_DRAFT_BANNER).toBe("DRAFT – pending review");
    expect(screen.getByText(/\[DATE OF PUBLICATION\]/)).toBeVisible();
    expect(
      screen.getByText(/\[square brackets\] need Brian's confirmation/),
    ).toBeVisible();
    expect(screen.getAllByText("team@beelinetech.co").length).toBeGreaterThan(
      0,
    );
  });

  it("keeps support placeholders and links to the other public pages", () => {
    render(<LegalDocument source={readDraft("support-page.md")} />);

    expect(
      screen.getByRole("heading", { name: "Common questions" }),
    ).toBeVisible();
    expect(screen.getByText(/Block \[name\]/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Privacy Policy" }),
    ).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms of Use" })).toHaveAttribute(
      "href",
      "/terms",
    );
  });

  it("links terms to the privacy page without resolving placeholders", () => {
    render(<LegalDocument source={readDraft("terms-of-use.md")} />);

    expect(screen.getByText(/\[or 18 — confirm\]/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Privacy Policy" }),
    ).toHaveAttribute("href", "/privacy");
  });
});
