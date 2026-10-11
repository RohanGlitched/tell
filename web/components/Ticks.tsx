// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Engine messages mark code the way a commit message does: `voters`, `amount()`.
// Show those spans as code instead of literal backticks.

const TICK = /`([^`\n]+)`/g;

export function Ticks({ text }: { text?: string | null }) {
  if (!text) return null;
  const parts = text.split(TICK);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <code key={i} className="not-italic rounded-[2px] bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] px-[0.3em] py-[0.05em] text-[0.86em]">
            {p}
          </code>
        ) : (
          p
        ),
      )}
    </>
  );
}

// The same text for places that only take a string (title attributes, aria labels).
export const plain = (text: string) => text.replace(TICK, '$1');
