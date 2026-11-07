// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// The Redacted brand device: redaction bars (solid when a secret holds, see-through when it
// leaks), the mark built from them, and the grade seal. Styles live in globals.css
// (.bar, .bar.see, .seal); these components only arrange them.

import type { CSSProperties, ReactNode } from 'react';

// Two solid bars and one hollow pink one: a redaction with a gap in it.
export function BrandMark({ size = 28, light = true }: { size?: number; light?: boolean }) {
  const fill = light ? '#fff' : 'var(--indigo)';
  return (
    <svg width={size} height={(size * 20) / 28} viewBox="0 0 28 20" aria-hidden="true">
      <rect x="0" y="2" width="12" height="6" rx="1.5" fill={fill} />
      <rect x="15" y="2" width="13" height="6" rx="1.5" fill="none" stroke="#FF3EA5" strokeWidth="1.6" />
      <rect x="0" y="12" width="28" height="6" rx="1.5" fill={fill} />
    </svg>
  );
}

// A redaction bar. With `see`, the hidden value shows through in marker pink: a leak.
export function Bar({ see, width, height, className = '', label }: { see?: ReactNode; width?: number | string; height?: number; className?: string; label?: string }) {
  const style: CSSProperties = { width, height, lineHeight: height ? `${height}px` : undefined };
  if (see !== undefined)
    return (
      <span className={`bar see ${className}`} style={style} aria-label={label}>
        {see}
      </span>
    );
  return <span className={`bar ${className}`} style={style} aria-label={label ?? 'redacted'} role="img" />;
}

// The grade as a seal: pink for D and F, violet for C, green for A and B.
export function GradeSeal({ grade, size = 84, caption = 'grade' }: { grade: string; size?: number; caption?: string | null }) {
  return (
    <div className="seal" data-grade={grade} style={{ width: size, height: size, borderWidth: size >= 64 ? 3 : 2 }} aria-label={`Grade ${grade}`} role="img">
      <div>
        <b className="block" style={{ fontSize: Math.round(size * 0.48) }}>
          {grade}
        </b>
        {caption && size >= 64 && <small className="mt-0.5 block font-[family-name:var(--sans)] text-[10.5px] font-semibold">{caption}</small>}
      </div>
    </div>
  );
}

// Severity pill: Critical, High, Medium, Low, Info.
export function Sev({ s }: { s: string }) {
  return (
    <span className="sev" data-sev={s}>
      {s}
    </span>
  );
}
