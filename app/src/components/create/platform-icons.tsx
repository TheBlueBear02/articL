import type { PostPlatform } from "@/lib/jobs";

// Small one-colour platform marks for the post text tabs (they take the text colour).
const ICONS: Record<PostPlatform, React.ReactNode> = {
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="17.3" cy="6.7" r="1.3" fill="currentColor" />
    </>
  ),
  tiktok: (
    <path
      fill="currentColor"
      d="M16.6 3c.3 2.3 1.8 3.9 4.1 4.1v3.2a7.3 7.3 0 0 1-4.1-1.3v6.2c0 3.3-2.5 5.8-5.9 5.8a5.8 5.8 0 0 1-5.9-5.8c0-3.5 3.1-6.2 6.7-5.7v3.3a2.6 2.6 0 0 0-3.5 2.4c0 1.4 1.2 2.6 2.7 2.6 1.5 0 2.7-1.1 2.7-2.9V3h3.2z"
    />
  ),
  linkedin: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3.5" fill="currentColor" />
      <rect x="6.6" y="10" width="2.4" height="7.4" fill="#fff" />
      <circle cx="7.8" cy="7.3" r="1.45" fill="#fff" />
      <path fill="#fff" d="M10.9 10h2.3v1c.4-.7 1.3-1.2 2.5-1.2 2 0 2.9 1.2 2.9 3.4v4.2h-2.4v-3.8c0-1.1-.4-1.7-1.3-1.7-1 0-1.6.7-1.6 1.8v3.7h-2.4V10z" />
    </>
  ),
};

export function PlatformIcon({ platform, className }: { platform: PostPlatform; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden className={className}>
      {ICONS[platform]}
    </svg>
  );
}
