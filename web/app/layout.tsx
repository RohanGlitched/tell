import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans, JetBrains_Mono, Newsreader, Schibsted_Grotesk } from 'next/font/google';
import Link from 'next/link';
import './globals.css';
import { Mark } from '@/components/Mark';

const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-plex-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-jetbrains', display: 'swap' });
const display = Schibsted_Grotesk({ subsets: ['latin'], weight: ['500', '700', '800', '900'], variable: '--font-schibsted', display: 'swap' });
const hand = Newsreader({ subsets: ['latin'], style: ['italic'], weight: ['400', '500'], variable: '--font-newsreader', display: 'swap' });

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://tell-midnight.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: 'Tell: what your Midnight contract gives away', template: '%s · Tell' },
  description:
    'Tell reads a Compact contract the way the compiler does and shows, in bits, what each circuit reveals about its users: guessable hashes, secret branches, linkable tags, keys in the clear.',
  openGraph: { type: 'website', siteName: 'Tell', images: ['/og.png'] },
  twitter: { card: 'summary_large_image', images: ['/og.png'] },
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f6f8' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1320' },
  ],
};

const NAV = [
  ['/scan', 'Scan', 'Scan'],
  ['/survey', 'Survey', 'Survey'],
  ['/zoo', 'Leak zoo', 'Zoo'],
  ['/how', 'How it works', 'How'],
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${hand.variable} ${display.variable}`}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:bg-[var(--sheet)] focus:px-3 focus:py-2">
          Skip to content
        </a>
        <header className="sticky top-0 z-40 border-b border-[var(--rule)] bg-[color-mix(in_srgb,var(--paper)_88%,transparent)] backdrop-blur">
          <div className="mx-auto flex max-w-[1180px] items-center gap-6 px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2 no-underline" aria-label="Tell home">
              <Mark />
              <span className="display text-[21px] font-extrabold tracking-[-0.03em]">Tell</span>
            </Link>
            <nav className="no-scrollbar ml-auto flex items-center gap-1 overflow-x-auto text-[14px] sm:gap-2" aria-label="Main">
              {NAV.map(([href, label, short]) => (
                <Link key={href} href={href} className="whitespace-nowrap rounded px-2 py-1.5 text-[var(--graphite)] no-underline hover:bg-[var(--sheet)] hover:text-[var(--ink)]">
                  <span className="hidden sm:inline">{label}</span>
                  <span className="sm:hidden">{short}</span>
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}

function Footer() {
  return (
    <footer className="mt-24 border-t border-[var(--rule)] bg-[var(--sheet)]">
      <div className="mx-auto grid max-w-[1180px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2">
            <Mark />
            <span className="font-semibold">Tell</span>
          </div>
          <p className="mt-3 max-w-[38ch] text-[14px] text-[var(--graphite)]">
            A privacy leak scanner for Midnight. Built for the Midnight Buildathon on AKINDO, Wave 2, October 2026. Open source under Apache-2.0.
          </p>
        </div>
        <FooterCol
          title="Use it"
          links={[
            ['/scan', 'Scan a contract'],
            ['/how#cli', 'Command line'],
            ['/how#ci', 'GitHub Action'],
            ['/how#suppress', 'Mark a finding intended'],
          ]}
        />
        <FooterCol
          title="Evidence"
          links={[
            ['/survey', 'Buildathon survey'],
            ['/zoo', 'Leak zoo and attack tests'],
            ['/how#limits', 'What Tell cannot see'],
          ]}
        />
        <FooterCol
          title="Project"
          links={[
            ['https://github.com/RohanGlitched/tell', 'Source on GitHub'],
            ['/how', 'How it works'],
            ['/how#changelog', 'Changelog'],
            ['https://midnight.network', 'Midnight'],
          ]}
        />
      </div>
      <div className="border-t border-[var(--rule)] px-4 py-4 text-center text-[13px] text-[var(--faint)] sm:px-6">
        Findings are produced by static analysis of what the Compact compiler builds. They describe what the public transcript can reveal, not proof that anyone has read it.
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h2 className="text-[13px] font-semibold text-[var(--graphite)]">{title}</h2>
      <ul className="mt-3 space-y-2 text-[14px]">
        {links.map(([href, label]) => (
          <li key={href}>
            <a href={href} className="no-underline hover:underline">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
