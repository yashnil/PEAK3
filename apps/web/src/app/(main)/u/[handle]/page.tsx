import { notFound } from "next/navigation";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import { InitialsAvatar } from "@/components/auth/InitialsAvatar";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * The public profile projection served by `GET /api/v1/profiles/{handle}`
 * (`PublicProfileResponse`, apps/api/app/models/profile.py) — every field
 * here is a field this page actually renders below. `avatar_key` is part of
 * the contract but not yet rendered (no curated avatar-image UI exists yet);
 * kept here as an unused field is preferable to widening the interface
 * again once one exists.
 */
interface Profile {
  handle: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_key: string | null;
  joined_at: string;
}

async function getPublicProfile(handle: string): Promise<Profile | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/profiles/${encodeURIComponent(handle)}`, {
      next: { revalidate: 60 },
    });
    if (res.status === 404) return null;
    if (res.status === 403) return null; // private profile
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

interface Props {
  params: Promise<{ handle: string }>;
}

export default async function PublicProfilePage({ params }: Props) {
  const { handle } = await params;
  const profile = await getPublicProfile(handle);

  if (!profile) {
    notFound();
  }

  return (
    <PeakV2Shell width="live">
      <div className="max-w-lg mx-auto px-4 py-12 space-y-6">
        <div
          className="pk-depth pk-crown rounded-xl border p-6 space-y-3"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <InitialsAvatar
            name={profile.display_name ?? profile.handle}
            size={64}
            className="text-xl"
          />

          <div>
            <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
              {profile.display_name ?? profile.handle}
            </h1>
            {profile.handle && (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                @{profile.handle}
              </p>
            )}
          </div>

          {profile.bio && (
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {profile.bio}
            </p>
          )}

          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Joined {new Date(profile.joined_at).toLocaleDateString()}
          </p>
        </div>
      </div>
    </PeakV2Shell>
  );
}
