"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getAccessToken } from "@/lib/auth";
import {
  progressionApi,
  ProgressionSummary,
  PersonalRecord,
  Achievement,
  StreakState,
} from "@/lib/progression-api";
import { XpProgress } from "@/components/progression/XpProgress";
import { StreakCard } from "@/components/progression/StreakCard";
import { AchievementCard } from "@/components/progression/AchievementCard";
import { PersonalRecords } from "@/components/progression/PersonalRecords";
import PeakV2Shell from "@/components/v2/PeakV2Shell";
import PeakV2SecondaryAction from "@/components/v2/PeakV2SecondaryAction";
import { PersonalPageLoading } from "@/components/ui/PersonalPageLoading";
import { ErrorState } from "@/components/ui/ErrorState";

type Tab = "overview" | "achievements" | "records";

export default function ProgressPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("overview");
  const [summary, setSummary] = useState<ProgressionSummary | null>(null);
  const [streak, setStreak] = useState<StreakState | null>(null);
  const [records, setRecords] = useState<PersonalRecord[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push("/signin?returnTo=/progress");
      return;
    }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading]);

  async function loadAll() {
    setFetching(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const [s, st, r, a] = await Promise.all([
        progressionApi.getSummary(token),
        progressionApi.getStreak(token),
        progressionApi.getRecords(token),
        progressionApi.getAchievements(token),
      ]);
      setSummary(s);
      setStreak(st);
      setRecords(r);
      setAchievements(a);
    } catch {
      setError("Failed to load progression data.");
    } finally {
      setFetching(false);
    }
  }

  if (loading || fetching) {
    return <PersonalPageLoading />;
  }

  if (!user) return null;

  const earnedAchievements = achievements.filter((a) => a.earned);
  const unearnedAchievements = achievements.filter((a) => !a.earned);

  return (
    <PeakV2Shell width="live">
      <header className="v2-page-header">
        <p className="v2-page-kicker">Progression</p>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="v2-page-title">My Progress</h1>
          <PeakV2SecondaryAction href="/profile" size="sm">
            ← Profile
          </PeakV2SecondaryAction>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-2" data-testid="progress-page">
      {error && <ErrorState message={error} />}

      {/* Level + XP */}
      {summary && (
        <div
          className="rounded-xl border p-4 space-y-3"
          style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
          aria-label="Level progress"
          data-testid="level-summary"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: "var(--text-secondary)" }}>
              Level
            </span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {summary.level.total_xp.toLocaleString()} total XP
            </span>
          </div>
          <XpProgress level={summary.level} />
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            XP measures your exploration, not your skill. Level is a participation indicator.
          </p>
        </div>
      )}

      {/* Streak */}
      {streak && <StreakCard streak={streak} />}

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg p-1" style={{ background: "var(--bg-elevated)" }} role="tablist">
        {(["overview", "achievements", "records"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="flex-1 py-1.5 rounded-md text-sm font-medium transition-colors capitalize"
            style={{
              background: tab === t ? "var(--bg-surface)" : "transparent",
              color: tab === t ? "var(--text-primary)" : "var(--text-secondary)",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && summary && (
        <div className="space-y-3" role="tabpanel" aria-label="Overview">
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Achievements" value={earnedAchievements.length} />
            <StatCard label="Records" value={records.length} />
            <StatCard label="Best Streak" value={streak?.longest_streak ?? 0} />
          </div>

          {summary.recent_achievements.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>
                Recent achievements
              </p>
              <div className="space-y-1.5">
                {summary.recent_achievements.map((key) => {
                  const a = achievements.find((x) => x.key === key);
                  if (!a) return null;
                  return <AchievementCard key={key} achievement={a} showDescription />;
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "achievements" && (
        <div className="space-y-4" role="tabpanel" aria-label="Achievements">
          {earnedAchievements.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>
                Earned ({earnedAchievements.length})
              </p>
              <div className="space-y-1.5">
                {earnedAchievements.map((a) => (
                  <AchievementCard key={a.key} achievement={a} showDescription />
                ))}
              </div>
            </div>
          )}
          {unearnedAchievements.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: "var(--text-muted)" }}>
                Not yet earned ({unearnedAchievements.length})
              </p>
              <div className="space-y-1.5">
                {unearnedAchievements.map((a) => (
                  <AchievementCard key={a.key} achievement={a} showDescription />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "records" && (
        <div role="tabpanel" aria-label="Personal records">
          <PersonalRecords records={records} />
          <p className="text-xs mt-4" style={{ color: "var(--text-muted)" }}>
            Records are version-scoped — they reflect the model and card pool active when each game was played.
          </p>
        </div>
      )}
      </div>
    </PeakV2Shell>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-lg border p-3 text-center"
      style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
    >
      <div className="score-number text-xl font-bold" style={{ color: "var(--peak-accent-text)" }}>
        {value}
      </div>
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
    </div>
  );
}
