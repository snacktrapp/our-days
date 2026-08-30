import Link from "next/link";
import { CspPublicImage } from "@/components/csp-image";
import type { MemoriesViewModel } from "./memories-view-model";

export function MemoriesPanel({ model }: { model: MemoriesViewModel }) {
  return (
    <section className="section-panel memories-panel">
      <div className="memory-heading">
        <span>{model.heading}</span>
        <strong>{model.subheading}</strong>
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
          <strong>{model.feature.title}</strong>
          <small>{model.feature.actionLabel}</small>
        </div>
      </Link>
      <div className="browse-years">
        <span>Browse by year</span>
        <div>
          {model.years.map((year) => (
            <button key={year}>{year}</button>
          ))}
        </div>
      </div>
    </section>
  );
}
