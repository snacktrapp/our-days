import { readTermsGate } from "./safety-actions";
import { TermsAcceptanceForm } from "./terms-gate-form";

export async function TermsAcceptanceGate() {
  try {
    const gate = await readTermsGate();
    if (!gate.required) return null;
  } catch {
    return null;
  }
  return <TermsAcceptanceForm />;
}
