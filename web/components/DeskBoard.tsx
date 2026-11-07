'use client';
// Copyright (C) 2026 Rohan Borade
// SPDX-License-Identifier: Apache-2.0
//
// Tell Desk on the page, read from the indexer through /api/desk (polled like LiveBoard):
// sealed reports and their status (never their content), revealed reports with a check that
// runs in your browser, and the grade registry with a lookup by contract address.

import { useEffect, useState } from 'react';
import type { DeskGrade, DeskReport, DeskResponse } from '@/lib/desk';
import { NETWORKS, type NetworkName } from '@/lib/networks';
import { canonicalRepo, projectId, reportDigest, toHex } from '@/vendor/desk/codec';
import { GradeSeal } from './brand';
import { Slot } from './ui';
import deployments from '@/data/deployments.json';

const short = (h: string, a = 8, b = 6) => (h.length > a + b + 1 ? `${h.slice(0, a)}…${h.slice(-b)}` : h);
const when = (s: number) => (s ? new Date(s * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : '–');
const STATUS_TONE: Record<DeskReport['status'], string> = { pending: 'in progress', acknowledged: 'pilot', fixed: 'done', retracted: 'planned' };

export default function DeskLive() {
  const [data, setData] = useState<DeskResponse | null>(null);
  const [state, setState] = useState<'loading' | 'not-deployed' | 'error' | 'ok'>('loading');
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch('/api/desk', { cache: 'no-store' });
        const j = await r.json().catch(() => ({}));
        if (stop) return;
        if (r.status === 503) return setState('not-deployed');
        if (!r.ok) throw new Error(j.error ?? 'read failed');
        setData(j);
        setState('ok');
      } catch {
        if (!stop) setState((s) => (s === 'ok' ? 'ok' : 'error'));
      }
    };
    void load();
    const t = setInterval(load, 20_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  if (state === 'loading') return <div className="h-48 animate-pulse rounded-lg bg-[var(--mist)]" aria-busy="true" />;
  if (state !== 'ok' || !data)
    return (
      <Slot title="Live reads from the indexer" testId="desk-registry-slot">
        {state === 'not-deployed'
          ? 'Tell Desk is being deployed to Midnight Preprod. Once its address is recorded, this section lists every sealed report, every reveal and every grade, read from the indexer every 20 seconds.'
          : 'The Midnight indexer did not answer. The contract is still there; this retries every 20 seconds.'}
      </Slot>
    );

  const net = NETWORKS[(data.network as NetworkName) ?? 'preprod'];
  const revealed = data.reports.filter((r) => r.opening);
  return (
    <div className="grid gap-12" data-testid="desk-live">
      <p className="text-[13px] text-[var(--graphite)]">
        Read from {net.indexerHost} at {new Date(data.readAt).toLocaleTimeString()}; refreshes every 20 s. Contract{' '}
        <a href={`${net.explorer}/contracts/${data.address}`} className="mono">
          {short(data.address)}
        </a>
        .
      </p>

      <dl className="grid gap-5 sm:grid-cols-4">
        {[
          [data.sealedCount, 'reports sealed'],
          [data.reports.filter((r) => r.status === 'fixed').length, 'marked fixed by a maintainer'],
          [revealed.length, 'revealed and checkable'],
          [data.grades.length + data.selfGrades.length, 'grades in the registry'],
        ].map(([n, l]) => (
          <div key={l as string} className="border-t-2 border-[var(--indigo)] pt-3">
            <dt className="num font-[family-name:var(--serif)] text-[40px] leading-none">{n}</dt>
            <dd className="mt-2 text-[14px] text-[var(--graphite)]">{l}</dd>
          </div>
        ))}
      </dl>

      <div>
        <h3 className="font-[family-name:var(--serif)] text-[21px] font-medium">Sealed reports</h3>
        <p className="mt-1 max-w-[64ch] text-[14.5px] text-[var(--graphite)]">
          What anyone sees: a commitment, a tag that differs per report, times and a status. Not the text, not the project, not who wrote it.
        </p>
        <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--rule)]">
          <table className="w-full min-w-[640px] border-collapse text-[13.5px]">
            <thead className="bg-[var(--mist)] text-left">
              <tr>
                <th className="px-4 py-2 font-semibold">Report id (the seal)</th>
                <th className="px-4 py-2 font-semibold">Contents</th>
                <th className="px-4 py-2 font-semibold">Sealed</th>
                <th className="px-4 py-2 font-semibold">Last change</th>
                <th className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.reports.map((r) => (
                <tr key={r.id} className="border-t border-[var(--rule)]">
                  <td className="mono px-4 py-2.5" title={r.id}>
                    {short(r.id)}
                  </td>
                  <td className="px-4 py-2.5">{r.opening ? <span className="text-[var(--marker-ink)]">revealed below</span> : <span className="bar inline-block h-3.5 w-24 align-middle" role="img" aria-label="sealed" />}</td>
                  <td className="px-4 py-2.5 text-[var(--graphite)]">{when(r.sealedAt)}</td>
                  <td className="px-4 py-2.5 text-[var(--graphite)]">{when(r.updatedAt)}</td>
                  <td className="px-4 py-2.5">
                    <span className="status" data-status={STATUS_TONE[r.status]}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="font-[family-name:var(--serif)] text-[21px] font-medium">Revealed reports: check one yourself</h3>
        <p className="mt-1 max-w-[64ch] text-[14.5px] text-[var(--graphite)]">
          A reveal puts the opening on the ledger. Paste the published report text and the repository it is about: your browser hashes both and compares
          them with the opening. The server checks the opening against the seal, which needs only public data.
        </p>
        {revealed.length === 0 ? (
          <p className="mt-4 text-[14.5px] text-[var(--faint)]">Nothing revealed yet. Reports open once fixed, or after the 90-day embargo.</p>
        ) : (
          <div className="mt-4 grid gap-4">
            {revealed.map((r) => (
              <VerifyReveal key={r.id} r={r} />
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="font-[family-name:var(--serif)] text-[21px] font-medium">The grade registry</h3>
        <p className="mt-1 max-w-[64ch] text-[14.5px] text-[var(--graphite)]">
          Grades are keyed by code hash: SHA-256 over every circuit’s name and verifier key. A wallet computes it from any contract address and reads the grade
          here. Tell’s attestations come first; a maintainer’s self-report is flagged.
        </p>
        <GradeTable grades={[...data.grades, ...data.selfGrades]} />
        <GradeLookup empty={data.grades.length + data.selfGrades.length === 0} />
      </div>
    </div>
  );
}

function GradeTable({ grades }: { grades: DeskGrade[] }) {
  if (grades.length === 0)
    return (
      <div className="mt-4 rounded-lg border border-dashed border-[var(--rule-strong)] bg-[var(--mist)] px-5 py-4 text-[14.5px] text-[var(--graphite)]" data-testid="desk-grades-empty">
        <p className="font-semibold text-[var(--ink)]">No grades on chain yet: the registry is ready, the first attestations are next.</p>
        <p className="mt-1">
          Tell’s grades for the zoo ballots are being recorded by the second Desk deployment. Until then the lookup below still reads a contract from the
          indexer and computes its code hash, the key a wallet would use.
        </p>
      </div>
    );
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--rule)]">
      <table className="w-full min-w-[560px] border-collapse text-[13.5px]">
        <thead className="bg-[var(--mist)] text-left">
          <tr>
            <th className="px-4 py-2 font-semibold">Contract</th>
            <th className="px-4 py-2 font-semibold">Code hash</th>
            <th className="px-4 py-2 font-semibold">Grade</th>
            <th className="px-4 py-2 font-semibold">Source</th>
            <th className="px-4 py-2 font-semibold">Rules, scan</th>
          </tr>
        </thead>
        <tbody>
          {grades.map((g) => (
            <tr key={g.codeHash + String(g.selfReported)} className="border-t border-[var(--rule)]">
              <td className="px-4 py-2.5">{g.contract ?? <span className="text-[var(--faint)]">unnamed</span>}</td>
              <td className="mono px-4 py-2.5" title={g.codeHash}>
                {short(g.codeHash)}
              </td>
              <td className="px-4 py-2">
                <GradeSeal grade={g.grade} size={30} caption={null} />
              </td>
              <td className="px-4 py-2.5">{g.selfReported ? <span className="status" data-status="planned">self-reported</span> : <span className="status" data-status="done">attested by Tell</span>}</td>
              <td className="num px-4 py-2.5 text-[var(--graphite)]">
                {g.rules}, #{g.scan}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Real contracts on the same network to try the lookup with: the leak zoo's ballots.
const EXAMPLES = [
  { label: 'Leaky ballot', address: deployments.contracts['ballot-leaky'].address },
  { label: 'Fixed ballot', address: deployments.contracts['ballot-fixed'].address },
];

function GradeLookup({ empty }: { empty: boolean }) {
  const [address, setAddress] = useState(EXAMPLES[0].address);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ codeHash: string; grade: DeskGrade | null } | { error: string } | null>(null);
  const look = async (a: string) => {
    setBusy(true);
    setOut(null);
    try {
      const r = await fetch(`/api/desk?address=${encodeURIComponent(a.trim())}`);
      const j = await r.json();
      setOut(r.ok ? j : { error: j.error ?? 'Lookup failed.' });
    } catch {
      setOut({ error: 'Could not reach the indexer. Try again.' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="mt-5 rounded-lg border border-[var(--rule)] bg-white p-5"
      data-testid="desk-lookup"
      onSubmit={(e) => {
        e.preventDefault();
        void look(address);
      }}
    >
      <label htmlFor="desk-address" className="block text-[14px] font-semibold">
        Look up a contract, as a wallet would
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="desk-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="contract address, 64 hex characters"
          className="mono min-h-[44px] flex-1 rounded-md border border-[var(--rule)] bg-[var(--mist)] px-3 text-[13px]"
          autoComplete="off"
        />
        <button disabled={busy || !address.trim()} className="btn btn-ink">
          {busy ? 'Reading…' : 'Read its grade'}
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[13px] text-[var(--graphite)]">
        <span>Try a real contract on this network:</span>
        {EXAMPLES.map((x) => (
          <button
            key={x.address}
            type="button"
            disabled={busy}
            onClick={() => {
              setAddress(x.address);
              void look(x.address);
            }}
            className="min-h-[40px] rounded-md border border-[var(--rule)] bg-white px-3 hover:border-[var(--ink-3)] sm:min-h-[30px] sm:px-2.5"
          >
            Try the {x.label.toLowerCase()}
          </button>
        ))}
      </div>
      {out && 'error' in out && (
        <p role="alert" className="mt-3 text-[14px] text-[var(--marker-ink)]">
          {out.error}
        </p>
      )}
      {out && !('error' in out) && (
        <div className="mt-4 flex flex-wrap items-center gap-4 text-[14px]">
          {out.grade ? <GradeSeal grade={out.grade.grade} size={40} caption={null} /> : null}
          <p>
            Code hash <code>{short(out.codeHash)}</code>:{' '}
            {out.grade
              ? out.grade.selfReported
                ? `grade ${out.grade.grade}, self-reported by its maintainer`
                : `grade ${out.grade.grade}, attested by Tell`
              : empty
                ? 'the contract was found and its code hash computed, but the registry holds no grades yet. Grades are being recorded by the second Desk deployment; this lookup will answer once they are.'
                : 'no grade recorded for this code.'}
          </p>
        </div>
      )}
    </form>
  );
}

function VerifyReveal({ r }: { r: DeskReport }) {
  const [text, setText] = useState(r.published?.text ?? '');
  const [repo, setRepo] = useState(r.published?.repo ?? '');
  const [res, setRes] = useState<{ digest: boolean; project: boolean } | null>(null);
  const o = r.opening!;
  return (
    <form
      className="rounded-lg border border-[var(--rule)] bg-white p-5"
      data-testid="verify-reveal"
      onSubmit={async (e) => {
        e.preventDefault();
        // Web Crypto, in this browser: SHA-256 of the text, and of the canonical repository
        const digest = toHex(await reportDigest(text)) === o.digest;
        const project = repo.trim() ? toHex(await projectId(repo)) === o.project : false;
        setRes({ digest, project });
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="mono text-[13px]">report {short(r.id)}</p>
        <p className="text-[13px] text-[var(--graphite)]">
          sealed {when(r.sealedAt)} · {r.sealMatches ? <span className="text-[var(--sealed)]">opening matches the seal</span> : <span className="text-[var(--marker-ink)]">opening does not match the seal</span>}
        </p>
      </div>
      <label className="mt-3 block text-[13.5px] font-medium">
        Report text, exactly as published
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="mono mt-1 block w-full rounded-md border border-[var(--rule)] bg-[var(--mist)] p-2.5 text-[12.5px]" />
      </label>
      <label className="mt-3 block text-[13.5px] font-medium">
        Repository it is about
        <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="github.com/owner/repo" className="mono mt-1 block min-h-[40px] w-full rounded-md border border-[var(--rule)] bg-[var(--mist)] px-2.5 text-[12.5px]" />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button className="btn btn-ink btn-sm" disabled={!text}>
          Verify this reveal
        </button>
        {res && (
          <span className="flex flex-wrap gap-2" aria-live="polite">
            <span className={res.digest ? 'stamp' : 'sev'} data-sev={res.digest ? undefined : 'critical'}>
              {res.digest ? 'Text matches' : 'Text does not match'}
            </span>
            <span className={res.project ? 'stamp' : 'sev'} data-sev={res.project ? undefined : 'critical'}>
              {res.project ? `Project matches (${canonicalRepo(repo)})` : 'Project does not match'}
            </span>
          </span>
        )}
      </div>
    </form>
  );
}

// No Lace flow yet: the Desk client runs from the command line, with the private state on your machine.
export function DeskCliSlot() {
  return (
    <div className="rounded-lg bg-white p-5 text-[var(--ink)] sm:p-6" data-testid="desk-wallet-slot">
      <p className="text-[14.5px] text-[var(--graphite)]">
        Sealing, acknowledging and revealing run from the Desk client (<code>desk/src/client.ts</code>), so each party’s secrets stay in their own private
        state. A Lace flow in this page comes after the wallet path is solid; until then:
      </p>
      <pre className="mono mt-3 overflow-x-auto rounded-md bg-[var(--mist)] p-3.5 text-[12.5px] leading-[1.7]">{`npm run compact -w desk          # compile
npm test -w desk                 # lifecycle, rejections, attacker tests
npm run dry-run -w desk          # the Preprod demo, offline
TELL_NETWORK=preprod npm run deploy:desk -w chain   # deploy and run the demo`}</pre>
    </div>
  );
}
