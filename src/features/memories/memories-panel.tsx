import Link from "next/link";
import { CspPublicImage } from "@/components/csp-image";
import type { MemoriesViewModel } from "./memories-view-model";

export function MemoriesPanel({ model }: { model: MemoriesViewModel }) {
  return (
    <section
      className="section-panel memories-panel"
      aria-labelledby="on-this-day-heading"
    >
      <div className="memory-heading">
        <span>{model.heading}</span>
        <h2 id="on-this-day-heading">{model.subheading}</h2>
      </div>
      <div className="memory-portal-connection" aria-hidden="true">
        <span />
      </div>
      {model.feature.state === "photo" ? (
        <Link
          className="memory-feature"
          href={model.feature.href}
          prefetch={false}
        >
          <div className="memory-photo">
            <CspPublicImage
              src={model.feature.imageSrc}
              alt={model.feature.imageAlt}
              width={1200}
              height={801}
              sizes="360px"
            />
          </div>
          <div>
            <span>{model.feature.dateLabel}</span>
            <h3>{model.feature.title}</h3>
            <small>{model.feature.actionLabel}</small>
          </div>
        </Link>
      ) : model.feature.state === "moment" ? (
        <Link
          className="memory-feature memory-feature-written"
          href={model.feature.href}
          prefetch={false}
        >
          <span
            className={`memory-feature-avatar dot-${model.feature.personAccent}`}
            aria-hidden="true"
          >
            {model.feature.personInitial}
          </span>
          <div>
            <span>
              {model.feature.dateLabel} · {model.feature.kindLabel}
            </span>
            <h3>{model.feature.personName}</h3>
            <p>{model.feature.summary}</p>
            <small>{model.feature.actionLabel}</small>
          </div>
        </Link>
      ) : (
        <Link
          className="memory-feature memory-feature-empty"
          href={model.feature.href}
          prefetch={false}
        >
          <span className="memory-feature-empty-node" aria-hidden="true" />
          <div>
            <h3>{model.feature.title}</h3>
            <p>{model.feature.description}</p>
            <small>{model.feature.actionLabel}</small>
          </div>
        </Link>
      )}
      <nav className="browse-years" aria-labelledby="browse-years-heading">
        <h2 id="browse-years-heading">Browse by year</h2>
        {model.years.length > 0 ? (
          <div>
            {model.years.map((year) => (
              <Link
                key={year.year}
                href={year.href}
                prefetch={false}
                aria-label={year.ariaLabel}
              >
                {year.year}
              </Link>
            ))}
          </div>
        ) : (
          <p>
            {model.yearsEmptyMessage ??
              "Years will gather here as your family journal grows."}
          </p>
        )}
        {model.yearNavigation ? (
          <div className="browse-years-pagination">
            {model.yearNavigation.newestHref ? (
              <Link href={model.yearNavigation.newestHref} prefetch={false}>
                Newest years
              </Link>
            ) : null}
            {model.yearNavigation.earlierHref ? (
              <Link href={model.yearNavigation.earlierHref} prefetch={false}>
                Earlier years
              </Link>
            ) : null}
          </div>
        ) : null}
      </nav>
    </section>
  );
}
