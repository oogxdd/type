import { MobileFoldersScreen } from "@/mobile/views/folders-view";
import { MobileRecentScreen } from "@/mobile/views/recent-view";
import type { FlattenedItem } from "@/features/tree/lib/types";
import type { RecentBucket } from "@/mobile/hooks/use-recent-buckets";

type PhoneFoldersScreenProps = {
  navigationTab: "folders" | "recent";
  navigationFolders: FlattenedItem[];
  activeFolder: string;
  expanded: Set<string>;
  onToggleFolder: (path: string) => void;
  openNotesRoute: (folderPath: string) => void;
  openFolderActionSheet: (path: string) => void;
  recentBuckets: RecentBucket[];
  openRecentBucketRoute: (bucketId: string) => void;
};

export function PhoneFoldersScreen({
  navigationTab,
  navigationFolders,
  activeFolder,
  expanded,
  onToggleFolder,
  openNotesRoute,
  openFolderActionSheet,
  recentBuckets,
  openRecentBucketRoute,
}: PhoneFoldersScreenProps) {
  if (navigationTab === "recent") {
    return (
      <MobileRecentScreen
        buckets={recentBuckets.map((bucket) => ({
          id: bucket.id,
          label: bucket.label,
          subtitle: bucket.subtitle,
          count: bucket.notes.length,
        }))}
        onSelect={openRecentBucketRoute}
      />
    );
  }
  return (
    <MobileFoldersScreen
      items={navigationFolders}
      activeFolder={activeFolder}
      expanded={expanded}
      onToggle={onToggleFolder}
      onSelect={openNotesRoute}
      onLongPress={openFolderActionSheet}
    />
  );
}
