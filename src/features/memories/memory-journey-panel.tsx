import Link from "next/link";
import { TimelineFeed } from "@/features/timeline/timeline-feed";
import type {
  ConnectedMomentActions,
  MomentConversationActions,
} from "@/features/moments/moment-action-types";
import type { MemoryJourneyViewModel } from "./memories-view-model";

export function MemoryJourneyPanel({
  model,
  connectedActions,
  conversationActions,
}: Readonly<{
  model: MemoryJourneyViewModel;
  connectedActions?: ConnectedMomentActions;
  conversationActions?: MomentConversationActions;
}>) {
  return (
    <div className="memory-journey">
      <Link className="memory-return" href={model.returnHref} prefetch={false}>
        <span aria-hidden="true">←</span> {model.returnLabel}
      </Link>
      <header className="memory-journey-heading">
        <span>{model.eyebrow}</span>
        <h2>{model.title}</h2>
        <p>{model.description}</p>
      </header>
      {model.state === "moments" ? (
        <TimelineFeed
          model={model.timeline}
          connectedActions={connectedActions}
          conversationActions={conversationActions}
        />
      ) : (
        <section className="memory-empty" aria-labelledby="memory-empty-title">
          <span className="memory-empty-node" aria-hidden="true" />
          <h3 id="memory-empty-title">{model.emptyState.title}</h3>
          <p>{model.emptyState.description}</p>
        </section>
      )}
    </div>
  );
}
