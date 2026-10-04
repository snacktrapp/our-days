import Svg, { Path } from "react-native-svg";

/**
 * public/our-days-wordmark.svg. The web paints it with a CSS mask
 * (src/app/globals.css `.our-days-wordmark`) in --ink.
 */
const paths = [
  "M50 2a50 50 0 1 1 0 100A50 50 0 0 1 50 2Zm0 27a23 23 0 1 0 0 46 23 23 0 0 0 0-46Z",
  "M112 8q0-6 6-6h17q6 0 6 6v53q0 14 15 14t15-14V8q0-6 6-6h17q6 0 6 6v54q0 40-44 40t-44-40Z",
  "M214 8q0-6 6-6h42q37 0 37 34 0 23-20 30l24 29q5 7-4 7h-23l-28-34h-5v28q0 6-6 6h-17q-6 0-6-6Zm29 20v18h18q10 0 10-9t-10-9Z",
  "M330 8q0-6 6-6h36q51 0 51 50t-51 50h-36q-6 0-6-6Zm29 21v46h12q23 0 23-23t-23-23Z",
  "M465 2h14q6 0 9 7l38 86q3 7-5 7h-19q-5 0-7-5l-5-12h-36l-5 12q-2 5-7 5h-19q-8 0-5-7l38-86q3-7 9-7Zm7 36-10 24h20Z",
  "M519 2h22q4 0 7 5l20 31 20-31q3-5 7-5h22q9 0 4 8l-39 56v30q0 6-6 6h-17q-6 0-6-6V66l-39-56q-5-8 5-8Z",
  "M677 2v23q0 4-5 4h-35q-9 0-9 7 0 6 9 6h13q32 0 32 29t-33 31h-42q-6 0-6-6V80q0-5 6-5h39q8 0 8-7 0-6-8-6h-13q-32 0-32-30t33-30Z",
];

export function Wordmark({
  color,
  width,
}: Readonly<{ color: string; width: number }>) {
  const height = (width * 104) / 682;
  return (
    <Svg
      width={width}
      height={height}
      viewBox="0 0 682 104"
      accessibilityRole="image"
      accessibilityLabel="Our Days"
    >
      {paths.map((d) => (
        <Path key={d.slice(0, 12)} d={d} fill={color} fillRule="evenodd" />
      ))}
    </Svg>
  );
}
