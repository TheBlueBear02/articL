/** Placeholder recommendations / reviews for the create page (desktop right column + mobile footer). */
const REVIEWS: { quote: string; name: string; role: string; stars: number }[] = [
  {
    quote: "Uploaded my paper and had a clean reel the same afternoon. Numbers matched the source — that mattered most.",
    name: "Dr. Maya Chen",
    role: "Political scientist",
    stars: 5,
  },
  {
    quote: "The student version finally explains method without dumbing it down. My lab uses it for every new working paper.",
    name: "Jonas Bergström",
    role: "PhD candidate",
    stars: 5,
  },
  {
    quote: "LinkedIn cut that doesn't sound like clickbait. Peers actually watched it through.",
    name: "Amira Hassan",
    role: "Public policy researcher",
    stars: 5,
  },
  {
    quote: "I was skeptical of AI scripts. The quote checks made me trust it enough to post.",
    name: "Prof. Eli Navarro",
    role: "Economics",
    stars: 4,
  },
];

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${n} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg
          key={i}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          aria-hidden
          className={i < n ? "text-brand" : "text-neutral-200"}
        >
          <path
            d="M12 3.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.6 6.2 18.1l.9-5.4L3.2 8.9l5.4-.8L12 3.2z"
            fill="currentColor"
          />
        </svg>
      ))}
    </span>
  );
}

/**
 * Vertical list of (placeholder) recommendations. Narrow layout for the desktop aside;
 * a bit roomier on mobile when shown under the create page content.
 */
export function CreateReviews({ className = "" }: { className?: string }) {
  return (
    <section className={className} aria-label="What researchers say">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-neutral-400">Recommended by researchers</h2>
      <ul className="mt-3 space-y-3">
        {REVIEWS.map((r) => (
          <li key={r.name} className="border-t border-neutral-100 pt-3 first:border-t-0 first:pt-0">
            <p className="text-[12px] font-semibold text-neutral-950">{r.name}</p>
            <p className="text-[11px] text-neutral-500">{r.role}</p>
            <div className="mt-1.5">
              <Stars n={r.stars} />
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-700">“{r.quote}”</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
