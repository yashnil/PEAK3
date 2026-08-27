import type { Metadata } from "next";
import V2PreviewGallery from "./V2PreviewGallery";

/**
 * PEAK3 V2 primitive gallery — INTERNAL, not part of the product.
 *
 * Same posture as `/arena/labs`: not linked from the navbar or the
 * homepage, `robots: { index: false }`, reachable only by direct URL.
 * Unlike `/arena/labs` (an archived legacy mode still played with real
 * data), this route exists purely to verify the V2 design system in
 * isolation — every name and number on it is clearly-labeled sample data
 * for demonstrating primitive STATES (staged/current/bench/etc.), never a
 * real PEAK3 statistic or ranking. It renders V2 unconditionally,
 * independent of `?ui=`/the dev switch, because its entire purpose is to
 * show the V2 system regardless of which version the rest of the app is
 * currently set to.
 */
export const metadata: Metadata = {
  title: "V2 Component Gallery | PEAK3 Arena",
  description: "Internal PEAK3 V2 · Broadcast Arena primitive gallery. Not part of the product.",
  robots: { index: false, follow: false },
};

export default function V2PreviewPage() {
  return <V2PreviewGallery />;
}
