import type { Metadata } from "next";

import InviteLanding from "@/components/head-to-head/InviteLanding";

interface Props {
  params: Promise<{ token: string }>;
}

/**
 * `/arena/run-the-table/h2h/invite/{token}` — the invite landing page.
 *
 * A SERVER COMPONENT THAT DOES NOT RESOLVE THE TOKEN. The descriptor is fetched
 * client-side, on purpose: rendering it here would put a signed invite in the
 * server's request logs and in the HTML payload of every crawl, and it would
 * also mean a prefetch of the link resolved it. The token stays in the URL the
 * recipient was given and nowhere else.
 *
 * `noindex`, because an invite is addressed to one person.
 *
 * NOTE ON ROUTING: this static `invite` segment sits beside the dynamic
 * `[matchId]` segment. Next.js resolves static segments first, so
 * `/h2h/invite/…` can never be read as a match id.
 */
export const metadata: Metadata = {
  title: "RUN THE TABLE challenge | PEAK3 Arena",
  description: "Someone challenged you to their exact RUN THE TABLE board.",
  robots: { index: false, follow: false },
};

export default async function HeadToHeadInvitePage({ params }: Props) {
  const { token } = await params;
  return (
    <main>
      <InviteLanding token={token} />
    </main>
  );
}
