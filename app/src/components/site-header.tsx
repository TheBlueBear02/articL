import Image from "next/image";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="mx-auto flex w-full max-w-6xl items-center px-4 py-1.5 sm:px-6 sm:py-2">
        <Link href="/" className="inline-flex items-center" aria-label="ArticL home">
          <Image
            src="/logos/header-logo.jpg"
            alt="ArticL"
            width={220}
            height={55}
            priority
            className="h-10 w-auto sm:h-12"
          />
        </Link>
      </div>
    </header>
  );
}
