import { getImageProps } from "next/image";

type CspImageProps = Readonly<{
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes: string;
  className?: string;
  highPriority?: boolean;
}>;

const reviewedPublicImagePaths = new Set(["/sample-family.jpg"]);

/**
 * Keeps responsive URLs for reviewed public design assets without the inline
 * style emitted by Image. Private family media must use the separately
 * authorized non-optimizer delivery path defined by ADR-010.
 */
export function CspPublicImage({
  src,
  alt,
  width,
  height,
  sizes,
  className,
  highPriority = false,
}: CspImageProps) {
  if (!reviewedPublicImagePaths.has(src)) {
    throw new Error("CspPublicImage received an unreviewed public asset.");
  }

  const { props } = getImageProps({
    src,
    alt,
    width,
    height,
    sizes,
    loading: highPriority ? "eager" : "lazy",
    fetchPriority: highPriority ? "high" : undefined,
  });
  const { style: _inlineStyle, ...imageProps } = props;
  const generatedStyles = Object.entries(_inlineStyle);
  if (
    generatedStyles.length !== 1 ||
    generatedStyles[0][0] !== "color" ||
    generatedStyles[0][1] !== "transparent"
  ) {
    throw new Error("Next generated an unreviewed responsive image style.");
  }

  // Next's generated `color: transparent` belongs in CSS under a strict CSP.
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...imageProps} alt={alt} className={className} />;
}
