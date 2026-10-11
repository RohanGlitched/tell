import type { Metadata } from 'next';
import LiveBoard from '@/components/LiveBoard';
import deployments from '@/data/deployments.json';

export const metadata: Metadata = {
  title: 'Live on Midnight',
  description: 'Two ballot contracts on Midnight Preview with the same votes. Tell reads one of them back from public chain data; the other stays sealed.',
};

export default function LivePage() {
  const deployed = Object.keys(deployments).length > 0;
  return (
    <div className="mx-auto max-w-[1180px] px-4 pb-10 pt-10 sm:px-6">
      <p className="label">Midnight Preview network</p>
      <h1 className="mt-2 max-w-[20ch] text-[36px] font-extrabold leading-[1.02] sm:text-[52px]">Same votes. Two contracts. One gives them away.</h1>
      <p className="mt-4 max-w-[66ch] text-[17px] text-[var(--graphite)]">
        Both ballots from the leak zoo are deployed on Midnight Preview, and the same voters voted the same way in each. This page reads both contracts’ public
        state straight from Midnight’s indexer and runs the attack Tell predicted: hash the four candidates, match the ballots. No private data is used.
      </p>
      {deployed ? (
        <LiveBoard />
      ) : (
        <div className="sheet mt-10 rounded-sm p-6">
          <p className="display text-[22px] font-bold">Deployment in progress</p>
          <p className="mt-2 text-[15px] text-[var(--graphite)]">The two ballots are being deployed to Midnight Preview. This page fills in as soon as the first votes land.</p>
        </div>
      )}
    </div>
  );
}
