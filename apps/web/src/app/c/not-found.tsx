export default function ChallengeNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card-elevated max-w-md p-8 text-center space-y-3">
        <h1 className="text-xl font-bold text-[var(--text-primary)]">
          Challenge not found
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          This challenge link has expired or is invalid.
        </p>
        <a
          href="/arena"
          className="inline-block mt-2 text-sm underline text-[var(--peak-accent)]"
        >
          Back to Arena
        </a>
      </div>
    </div>
  );
}
