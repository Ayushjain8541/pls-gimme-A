export function StatusBadge({ state }: { state: string }) {
  const labels: Record<string, string> = {
    needs_solutions: "Needs solutions",
    queued: "Queued",
    processing: "Preparing",
    needs_review: "Needs attention",
    ready: "Ready",
    failed: "Preparation failed",
    not_started: "Not started",
    in_progress: "In progress",
    completed: "Completed",
  };
  return (
    <span className={`badge ${state}`}>
      <span />
      {labels[state] || state}
    </span>
  );
}
