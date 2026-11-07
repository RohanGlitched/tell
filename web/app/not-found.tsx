import type { Metadata } from 'next';
import Link from 'next/link';
import { Bar } from '@/components/brand';

export const metadata: Metadata = {
  title: 'Not found',
  robots: { index: false },
};

export default function NotFound() {
  return (
    <section className="on-indigo">
      <div className="wrap pb-24 pt-16 sm:pb-32 sm:pt-24">
        <p className="text-[13.5px] font-medium text-[var(--on-indigo-2)]">Page 404</p>
        <h1 className="mt-3 max-w-[18ch] text-[34px] leading-[1.1] sm:text-[46px]">
          Nothing leaks here, because nothing is <Bar width="3.4em" height={40} className="align-middle" label="redacted" />.
        </h1>
        <p className="mt-5 max-w-[46ch] text-[17px] text-[var(--on-indigo-3)]">This page does not exist. The ones that do are below.</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/scan" className="btn btn-pri">
            Scan a contract
          </Link>
          <Link href="/" className="btn btn-line border-[#5c53a8] text-white">
            Back to the home page
          </Link>
        </div>
        <p className="mt-8 text-[15px] text-[var(--on-indigo)] [&_a]:text-white">
          Or open the <Link href="/zoo">leak zoo</Link>, the <Link href="/survey">buildathon survey</Link>, or <Link href="/how">how Tell works</Link>.
        </p>
      </div>
    </section>
  );
}
