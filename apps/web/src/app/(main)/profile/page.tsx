"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { getAccessToken, signOut } from "@/lib/auth";
import RankedRatingCards from "@/components/ranked/RankedRatingCards";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Profile {
  handle: string | null;
  display_name: string | null;
  bio: string | null;
  is_public: boolean;
  history_public: boolean;
  joined_at: string;
}

async function fetchProfile(token: string): Promise<Profile> {
  const res = await fetch(`${API_BASE}/api/v1/profiles/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("Failed to load profile");
  return res.json();
}

async function updateProfile(token: string, data: Partial<Profile>): Promise<Profile> {
  const res = await fetch(`${API_BASE}/api/v1/profiles/me`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail ?? "Failed to update profile");
  }
  return res.json();
}

export default function ProfilePage() {
  const { user, loading, supabaseEnabled } = useAuth();
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push("/signin?returnTo=/profile");
      return;
    }
    (async () => {
      setProfileLoading(true);
      try {
        const token = await getAccessToken();
        if (!token) return;
        const p = await fetchProfile(token);
        setProfile(p);
        setHandle(p.handle ?? "");
        setDisplayName(p.display_name ?? "");
        setBio(p.bio ?? "");
        setIsPublic(p.is_public);
      } catch {
        setError("Failed to load profile.");
      } finally {
        setProfileLoading(false);
      }
    })();
  }, [user, loading, router]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");
      const updated = await updateProfile(token, {
        handle: handle || undefined,
        display_name: displayName || undefined,
        bio: bio || undefined,
        is_public: isPublic,
      });
      setProfile(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    router.push("/");
  }

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--border-default)] border-t-[var(--peak-accent)]" />
      </div>
    );
  }

  if (!supabaseEnabled) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center space-y-4">
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          Profile
        </h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Authentication is not configured. You can play all modes anonymously.
        </p>
        <Link href="/" className="text-sm underline" style={{ color: "var(--peak-accent)" }}>
          Back to PEAK3 Arena
        </Link>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
          Profile
        </h1>
        <div className="flex gap-3">
          <Link
            href="/history"
            className="text-sm px-3 py-1.5 rounded-lg"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-default)",
              color: "var(--text-secondary)",
            }}
          >
            History
          </Link>
          <button
            onClick={handleSignOut}
            className="text-sm px-3 py-1.5 rounded-lg"
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-default)",
              color: "var(--text-secondary)",
            }}
          >
            Sign Out
          </button>
        </div>
      </div>

      <div
        className="rounded-xl p-4 text-sm"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          color: "var(--text-muted)",
        }}
      >
        Signed in as <span style={{ color: "var(--text-secondary)" }}>{user.email ?? "anonymous"}</span>
        {profile?.joined_at && (
          <span> · Joined {new Date(profile.joined_at).toLocaleDateString()}</span>
        )}
      </div>

      <RankedRatingCards />

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
            Handle
          </label>
          <input
            type="text"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="your_handle"
            maxLength={30}
            className="w-full rounded-lg px-3 py-2 text-sm border"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-default)",
              color: "var(--text-primary)",
            }}
          />
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            3–30 characters, letters/digits/underscores. Used in public profile URL.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
            Display Name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={60}
            className="w-full rounded-lg px-3 py-2 text-sm border"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-default)",
              color: "var(--text-primary)",
            }}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
            Bio
          </label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={500}
            rows={3}
            className="w-full rounded-lg px-3 py-2 text-sm border resize-none"
            style={{
              background: "var(--bg-surface)",
              borderColor: "var(--border-default)",
              color: "var(--text-primary)",
            }}
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="rounded"
          />
          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Make profile public
          </span>
        </label>

        {error && (
          <p role="alert" className="text-sm rounded-lg px-3 py-2" style={{ background: "#ef444420", color: "#ef4444" }}>
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm" style={{ color: "#34d399" }}>
            Profile saved.
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-60"
          style={{ background: "var(--peak-accent)", color: "var(--text-inverse)" }}
        >
          {saving ? "Saving…" : "Save Profile"}
        </button>
      </form>
    </div>
  );
}
