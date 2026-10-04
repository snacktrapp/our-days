import type { Metadata } from "next";
import { LegalDocument } from "@/content/legal/legal-document";
import { readPrivacyPolicySource } from "@/content/legal/read-legal-source";

export const metadata: Metadata = {
  title: "Privacy Policy — Our Days",
};

export default function PrivacyPage() {
  return <LegalDocument source={readPrivacyPolicySource()} />;
}
