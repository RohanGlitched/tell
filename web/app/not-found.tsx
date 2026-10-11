import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Not found',
  robots: { index: false },
};

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[1180px] px-4 pb-10 pt-16 sm:px-6 sm:pt-24">
      <p className="label">Case file 404</p>
      <h1 className="mt-3 max-w-[18ch] text-[40px] font-extrabold leading-[1.02] sm:text-[56px]">Nothing leaks here, because nothing is here.</h1>
      <p className="hand mt-5 max-w-[46ch] text-[21px] leading-snug text-[var(--graphite)]">
        This page does not exist. The lamp is still on for the ones that do.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/scan" className="inline-flex min-h-[46px] items-center rounded-sm bg-[var(--ink)] px-5 font-semibold text-[var(--paper)] no-underline">
          Scan a contract
        </Link>
        <Link href="/" className="inline-flex min-h-[46px] items-center rounded-sm border border-[var(--ink)] px-5 font-semibold no-underline">
          Back to the home page
        </Link>
      </div>
      <p className="mt-8 text-[15px] text-[var(--graphite)]">
        Or open the <Link href="/zoo">leak zoo</Link>, the <Link href="/survey">buildathon survey</Link>, or <Link href="/how">how Tell works</Link>.
      </p>
    </div>
  );
}
