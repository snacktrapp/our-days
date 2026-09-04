import { Suspense } from "react";
import { notFound } from "next/navigation";

async function StreamedHttpNotFound(): Promise<never> {
  // Yield once so the Suspense fallback can commit the HTML stream as 200.
  // Unknown person IDs must not advertise existence via a completed 404.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  notFound();
}

export function PrivateSoftNotFound() {
  return (
    <Suspense fallback={null}>
      <StreamedHttpNotFound />
    </Suspense>
  );
}
