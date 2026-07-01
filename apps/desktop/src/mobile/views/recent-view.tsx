import { CalendarDays, ChevronRight } from "lucide-react";

export type RecentBucketRow = {
  id: string;
  label: string;
  subtitle: string;
  count: number;
};

type MobileRecentScreenProps = {
  buckets: RecentBucketRow[];
  onSelect: (bucketId: string) => void;
};

export function MobileRecentScreen({ buckets, onSelect }: MobileRecentScreenProps) {
  if (buckets.length === 0) {
    return <div className="mobile-screen-empty">No recent notes yet.</div>;
  }

  return (
    <div className="mobile-screen-scroll" aria-label="Recent notes">
      {buckets.map((bucket) => (
        <button
          key={bucket.id}
          type="button"
          className="mobile-recent-row"
          onClick={() => onSelect(bucket.id)}
          aria-label={`Open ${bucket.label} notes`}
        >
          <span className="mobile-recent-main">
            <span className="mobile-recent-icon" aria-hidden>
              <CalendarDays size={15} />
            </span>
            <span className="mobile-recent-copy">
              <span className="mobile-recent-title">{bucket.label}</span>
              <span className="mobile-recent-subtitle">{bucket.subtitle}</span>
            </span>
          </span>
          <span className="mobile-recent-meta">
            <span className="mobile-recent-count">{bucket.count}</span>
            <ChevronRight size={16} />
          </span>
        </button>
      ))}
    </div>
  );
}
