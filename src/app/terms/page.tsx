import type { Metadata } from "next";
import { LegalDocument } from "@/content/legal/legal-document";
import { readTermsOfUseSource } from "@/content/legal/read-legal-source";

export const metadata: Metadata = {
  title: "Terms of Use — Our Days",
};

export default function TermsPage() {
  return <LegalDocument source={readTermsOfUseSource()} />;
}
