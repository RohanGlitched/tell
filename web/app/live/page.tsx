import type { Metadata } from 'next';
import LiveBoard from '@/components/LiveBoard';
import deployments from '@/data/deployments.json';
import { NETWORKS, type NetworkName } from '@/lib/networks';
import { PageHead } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Live on Midnight',
  description: 'Two ballot contracts on a Midnight test network with the same votes. Tell reads one of them back from public chain data; the other stays sealed.',
};

export default function LivePage() {
  const dep = deployments as { network?: NetworkName; contracts?: Record<string, unknown> };
  const deployed = Object.keys(dep.contracts ?? {}).length > 0;
  const net = NETWORKS[dep.network ?? 'preprod'].label;
  return (
    <>
      <PageHead kicker={`${net} network`} title="Same votes. Two contracts. One gives them away.">
        <p>
          Both ballots from the leak zoo are deployed on {net}, and the same voters voted the same way in each. This page reads both contracts’ public
          state straight from Midnight’s indexer and runs the attack Tell predicted: hash the four candidates, match the ballots. No private data is used.
        </p>
      </PageHead>
    <div className="wrap pb-16 pt-12 sm:pt-14">
      {deployed ? (
        <LiveBoard />
      ) : (
        <div className="sheet mt-10 rounded-sm p-6">
          <p className="display text-[22px] font-bold">Deployment in progress</p>
          <p className="mt-2 text-[15px] text-[var(--graphite)]">The two ballots are being deployed to {net}. This page fills in as soon as the first votes land.</p>
        </div>
      )}
    </div>
    </>
  );
}
