'use client';
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// "I'm interested": opens a prefilled GitHub issue on the Tell repository. Nothing is stored
// by this site; the visitor reviews the issue on GitHub and decides whether to submit it.

import { useState } from 'react';

type Option = { id: string; name: string };

export function issueUrl(repo: string, label: string, who: string, offer: string, note: string): string {
  const title = `Interest: ${offer} (${who})`;
  const body = [
    `**Who I am:** ${who}`,
    `**Interested in:** ${offer}`,
    '',
    note.trim() || '_What would you use Tell for? Anything about your contracts, timeline or setup helps._',
    '',
    '---',
    'Opened from tell-midnight.vercel.app/teams. This issue is public; leave out anything private.',
  ].join('\n');
  const q = new URLSearchParams({ title, body, labels: label });
  return `https://github.com/${repo}/issues/new?${q.toString()}`;
}

export default function InterestForm({ repo, label, segments, offers }: { repo: string; label: string; segments: Option[]; offers: Option[] }) {
  const [who, setWho] = useState(segments[0]?.name ?? '');
  const [offer, setOffer] = useState(offers[0]?.name ?? '');
  const [note, setNote] = useState('');
  const url = issueUrl(repo, label, who, offer, note);
  return (
    <form
      className="sheet rounded-sm p-5"
      data-testid="interest-form"
      onSubmit={(e) => {
        e.preventDefault();
        window.open(url, '_blank', 'noopener');
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-[14px] font-medium">
          I am
          <select value={who} onChange={(e) => setWho(e.target.value)} className="mt-1 block min-h-[44px] w-full rounded border border-[var(--rule)] bg-[var(--paper)] px-2 text-[15px]">
            {segments.map((s) => (
              <option key={s.id}>{s.name}</option>
            ))}
            <option>Something else</option>
          </select>
        </label>
        <label className="block text-[14px] font-medium">
          Interested in
          <select value={offer} onChange={(e) => setOffer(e.target.value)} className="mt-1 block min-h-[44px] w-full rounded border border-[var(--rule)] bg-[var(--paper)] px-2 text-[15px]">
            {offers.map((o) => (
              <option key={o.id}>{o.name}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="mt-4 block text-[14px] font-medium">
        A note (optional)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={1500}
          className="mt-1 block w-full rounded border border-[var(--rule)] bg-[var(--paper)] p-2 text-[15px]"
          placeholder="What you build, how many contracts, what you would want from Tell"
        />
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="min-h-[44px] rounded bg-[var(--ink)] px-5 font-medium text-[var(--paper)]">Open a GitHub issue</button>
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-[14px]" data-testid="interest-link">
          or open the link directly
        </a>
      </div>
      <p className="mt-3 text-[13px] text-[var(--graphite)]">
        This opens GitHub with the issue filled in. You review it there and submit it yourself. The issue is public; this site stores nothing.
      </p>
    </form>
  );
}
