import Image from "next/image";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-1.5 sm:px-6 sm:py-2">
        <Link href="/" className="inline-flex items-center overflow-hidden" aria-label="ArticL home">
          {/* Crop the top 20% of the asset (empty padding in the JPG). */}
          <span className="inline-flex h-8 overflow-hidden sm:h-[2.4rem]">
            <Image
              src="/logos/header-logo.jpg"
              alt="ArticL"
              width={220}
              height={55}
              priority
              className="h-10 w-auto max-w-none -translate-y-[20%] sm:h-12"
            />
          </span>
        </Link>
        <button
          type="button"
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-neutral-900 transition hover:brightness-95"
        >
          Sign up
        </button>
      </div>
    </header>
  );
}
