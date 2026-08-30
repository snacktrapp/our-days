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
      <nav className="browse-years" aria-labelledby="browse-years-heading">
        <h2 id="browse-years-heading">Browse by year</h2>
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
      </nav>
    </section>
  );
}
