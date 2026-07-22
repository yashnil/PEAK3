import { notFound } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Profile {
  handle: string | null;
  display_name: string | null;
  bio: string | null;
  is_public: boolean;
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
    <div className="max-w-lg mx-auto px-4 py-12 space-y-6">
      <div
        className="rounded-xl border p-6 space-y-3"
        style={{
          background: "var(--bg-surface)",
          borderColor: "var(--border-subtle)",
        }}
      >
        {/* Avatar placeholder — initials */}
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold"
          style={{
            background: "var(--bg-elevated)",
            color: "var(--peak-accent)",
            border: "2px solid var(--border-subtle)",
          }}
        >
          {(profile.display_name ?? profile.handle ?? "?").slice(0, 1).toUpperCase()}
        </div>

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
  );
}
