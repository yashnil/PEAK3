import PeakV2Shell from "@/components/v2/PeakV2Shell";
import { Skeleton } from "@/components/ui/Skeleton";

/** Standard Next.js App Router loading UI — this route previously had none
 *  at all (a blank gap until the RSC resolved). No data/logic here, just a
 *  shape-matching placeholder. */
export default function PlayerPageLoading() {
  return (
    <PeakV2Shell width="live">
      <div role="status" aria-label="Loading player" className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-2">
        <Skeleton height={14} width={120} />
        <Skeleton height={36} width={280} />
        <div className="flex flex-col gap-3 pt-4">
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </div>
      </div>
    </PeakV2Shell>
  );
}
