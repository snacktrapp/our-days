import type { Metadata } from "next";
import { LegalDocument } from "@/content/legal/legal-document";
import { readSupportPageSource } from "@/content/legal/read-legal-source";

export const metadata: Metadata = {
  title: "Support — Our Days",
};

export default function SupportPage() {
  return <LegalDocument source={readSupportPageSource()} />;
}
