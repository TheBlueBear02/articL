/**
 * Vertical parallel yellow strokes — the upright of the ArticL logo "L".
 * Use as a section watermark or edge mark on a white background.
 */
export function BrandVerticalLines({
  className = "",
  count = 4,
  opacity = 1,
}: {
  className?: string;
  /** How many upright strokes (logo L uses 4). */
  count?: number;
  opacity?: number;
}) {
  const gap = 10;
  const stroke = 5.5;
  const width = stroke + (count - 1) * gap + stroke;
  const lines = Array.from({ length: count }, (_, i) => {
    const x = stroke / 2 + i * gap;
    return <path key={i} d={`M${x} 4 V92`} />;
  });

  return (
    <svg
      viewBox={`0 0 ${width} 96`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <g stroke="currentColor" strokeWidth={stroke} strokeLinecap="square" opacity={opacity}>
        {lines}
      </g>
    </svg>
  );
}
