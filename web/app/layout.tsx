import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import Link from 'next/link';
import './globals.css';
import { BrandMark } from '@/components/brand';
import SiteNav from '@/components/SiteNav';
import SiteAnalytics from '@/components/SiteAnalytics';

// Self-hosted (SIL Open Font License, see app/fonts/README.md): the build no longer depends on
// reaching Google Fonts.
const serif = localFont({ src: './fonts/source-serif-4-latin.woff2', weight: '400 600', variable: '--font-source-serif', display: 'swap' });
const sans = localFont({ src: './fonts/schibsted-grotesk-latin.woff2', weight: '400 700', variable: '--font-schibsted', display: 'swap' });
const mono = localFont({
  src: [
    { path: './fonts/dm-mono-400-latin.woff2', weight: '400', style: 'normal' },
    { path: './fonts/dm-mono-500-latin.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-dm-mono',
  display: 'swap',
});

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tell-midnight.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: 'Tell: what your Midnight contract gives away', template: '%s · Tell' },
  description:
    'Tell reads a Compact contract the way the compiler does and shows, in bits, what each circuit reveals about its users: guessable hashes, secret branches, linkable tags, keys in the clear.',
  openGraph: {
    type: 'website',
    siteName: 'Tell',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Tell: every contract has a tell. A privacy leak scanner for Midnight.' }],
  },
  twitter: { card: 'summary_large_image', images: ['/og.png'] },
  icons: { icon: [{ url: '/icon.svg', type: 'image/svg+xml' }] },
};

export const viewport: Viewport = { themeColor: '#1A1446' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
          Skip to content
        </a>
        <header className="site-header sticky top-0 z-40 bg-[var(--indigo)] text-white">
          <div className="wrap flex h-[60px] items-center gap-7 lg:h-[66px]">
            <Link href="/" className="flex min-h-[44px] items-center gap-2.5 font-[family-name:var(--serif)] text-[22px] font-semibold no-underline" aria-label="Tell home">
              <BrandMark />
              Tell
            </Link>
            <SiteNav />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="outline-none">
          {children}
        </main>
        <Footer />
        <SiteAnalytics />
      </body>
    </html>
  );
}

function Footer() {
  return (
    <footer className="site-footer bg-[var(--indigo)] pb-7 pt-16 text-[14px] text-[var(--on-indigo)]">
      <div className="wrap">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4 lg:grid-cols-[1.6fr_repeat(4,1fr)]">
          <div className="col-span-2 md:col-span-4 lg:col-span-1">
            <Link href="/" className="flex items-center gap-2.5 font-[family-name:var(--serif)] text-[22px] font-semibold text-white no-underline">
              <BrandMark />
              Tell
            </Link>
            <p className="mt-3 max-w-[34ch]">A privacy leak scanner for Midnight. It reads source code and public state, never your users’ data.</p>
            <p className="mt-3 max-w-[34ch] text-[13px] text-[var(--on-indigo-2)]">Built for the Midnight Buildathon on AKINDO, Waves 2 and 3, October and November 2026.</p>
            <div className="mt-5 flex gap-1.5" aria-hidden="true">
              <span className="h-2 w-[60px] rounded-[2px] bg-[var(--indigo-3)]" />
              <span className="h-2 w-[28px] rounded-[2px] shadow-[inset_0_0_0_1.5px_var(--marker)]" />
              <span className="h-2 w-[90px] rounded-[2px] bg-[var(--indigo-3)]" />
            </div>
          </div>
          <FooterCol
            title="Product"
            links={[
              ['/scan', 'Web scanner'],
              ['/how#cli', 'Command line'],
              ['/how#ci', 'GitHub Action'],
              ['/scan', 'README badge'],
              ['/desk', 'Tell Desk'],
            ]}
          />
          <FooterCol
            title="Evidence"
            links={[
              ['/survey', 'Buildathon survey'],
              ['/zoo', 'Leak zoo'],
              ['/live', 'Live on Preprod'],
              ['/adoption', 'Adoption'],
            ]}
          />
          <FooterCol
            title="Read"
            links={[
              ['/how', 'How it works'],
              ['/how#limits', 'What Tell cannot see'],
              ['/how#suppress', 'Mark a finding intended'],
              ['/how#changelog', 'Changelog'],
            ]}
          />
          <FooterCol
            title="Tell"
            links={[
              ['/wave3', 'Wave 3: you said, we did'],
              ['/teams', 'For teams'],
              ['https://github.com/RohanGlitched/tell', 'GitHub'],
              ['https://midnight.network', 'Midnight'],
            ]}
          />
        </div>
        <div className="mt-12 flex flex-wrap justify-between gap-4 border-t border-[var(--indigo-3)] pt-5 text-[13px] text-[var(--on-indigo-2)]">
          <span>Apache-2.0. Built for Midnight.</span>
          <span>Static analysis of what the Compact compiler builds: what the public transcript can reveal, not proof that anyone has read it.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h2 className="mb-3 font-[family-name:var(--sans)] text-[13px] font-semibold text-white">{title}</h2>
      <ul className="grid gap-0.5 sm:gap-2">
        {links.map(([href, label]) => (
          <li key={href + label}>
            <a href={href} className="inline-flex min-h-[40px] items-center no-underline hover:text-white sm:min-h-0">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
