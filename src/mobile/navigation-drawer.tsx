import { Archive, Clock3, Folder, X } from "lucide-react";
import type { FlattenedItem } from "@/features/notes/tree/lib/types";
import { MobileFoldersScreen } from "@/mobile/views/folders-view";
import { MobileRecentScreen, type RecentBucketRow } from "@/mobile/views/recent-view";

type MobileNavigationDrawerProps = {
  navigationTab: "folders" | "recent";
  onNavigationTabChange: (tab: "folders" | "recent") => void;
  folders: FlattenedItem[];
  activeFolder: string;
  expanded: Set<string>;
  onToggleFolder: (folderPath: string) => void;
  onSelectFolder: (folderPath: string) => void;
  onFolderLongPress: (folderPath: string) => void;
  recentBuckets: RecentBucketRow[];
  onSelectRecentBucket: (bucketId: string) => void;
  onOpenArchive: () => void;
  onClose: () => void;
};

/**
 * Phone-only slide-in navigation drawer: a Folders/Recent tab switcher over the
 * folder tree and recent-date buckets, plus an Archive shortcut. Purely
 * presentational — the shell owns the open/close state and routing.
 */
export function MobileNavigationDrawer({
  navigationTab,
  onNavigationTabChange,
  folders,
  activeFolder,
  expanded,
  onToggleFolder,
  onSelectFolder,
  onFolderLongPress,
  recentBuckets,
  onSelectRecentBucket,
  onOpenArchive,
  onClose,
}: MobileNavigationDrawerProps) {
  return (
    <div className="mobile-drawer-overlay" role="dialog" aria-modal="true" aria-label="Navigation">
      <button
        type="button"
        className="mobile-drawer-backdrop"
        onClick={onClose}
        aria-label="Close navigation"
      />
      <aside className="mobile-drawer-panel">
        <div className="mobile-drawer-header">
          <h2>Navigation</h2>
          <button
            type="button"
            className="mobile-drawer-close"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <div className="mobile-drawer-content">
          <div className="mobile-drawer-tabs" role="tablist" aria-label="Navigation tabs">
            <button
              type="button"
              className={`mobile-drawer-tab${navigationTab === "folders" ? " active" : ""}`}
              onClick={() => onNavigationTabChange("folders")}
            >
              <Folder size={15} />
              <span>Folders</span>
            </button>
            <button
              type="button"
              className={`mobile-drawer-tab${navigationTab === "recent" ? " active" : ""}`}
              onClick={() => onNavigationTabChange("recent")}
            >
              <Clock3 size={15} />
              <span>Recent</span>
            </button>
          </div>
          <div className="mobile-drawer-main">
            {navigationTab === "folders" ? (
              <MobileFoldersScreen
                items={folders}
                activeFolder={activeFolder}
                expanded={expanded}
                onToggle={onToggleFolder}
                onSelect={onSelectFolder}
                onLongPress={onFolderLongPress}
              />
            ) : (
              <MobileRecentScreen buckets={recentBuckets} onSelect={onSelectRecentBucket} />
            )}
          </div>
          <div className="mobile-drawer-footer">
            <button type="button" className="mobile-drawer-archive-btn" onClick={onOpenArchive}>
              <Archive size={16} />
              <span>Archive</span>
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
