import { ChevronRight, Folder } from "lucide-react";
import { useRef } from "react";
import type { FlattenedItem } from "@/features/tree/lib/types";
import { getDisplayFolderName } from "../types";

type MobileFoldersScreenProps = {
  items: FlattenedItem[];
  activeFolder: string;
  expanded: Set<string>;
  onToggle: (folderPath: string) => void;
  onSelect: (folderPath: string) => void;
  onLongPress: (folderPath: string) => void;
};

export function MobileFoldersScreen({
  items,
  activeFolder,
  expanded,
  onToggle,
  onSelect,
  onLongPress,
}: MobileFoldersScreenProps) {
  if (items.length === 0) {
    return <div className="mobile-screen-empty">No folders yet.</div>;
  }

  return (
    <div className="mobile-screen-scroll" aria-label="Folders list">
      {items.map((item) => (
        <FolderRow
          key={item.id}
          item={item}
          isActive={item.id === activeFolder}
          isExpanded={expanded.has(item.id)}
          onToggle={onToggle}
          onSelect={onSelect}
          onLongPress={onLongPress}
        />
      ))}
    </div>
  );
}

type FolderRowProps = {
  item: FlattenedItem;
  isActive: boolean;
  isExpanded: boolean;
  onToggle: (folderPath: string) => void;
  onSelect: (folderPath: string) => void;
  onLongPress: (folderPath: string) => void;
};

function FolderRow({
  item,
  isActive,
  isExpanded,
  onToggle,
  onSelect,
  onLongPress,
}: FolderRowProps) {
  const timerRef = useRef<number | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const longPressedRef = useRef(false);

  const clearLongPress = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  return (
    <div
      className={`mobile-folder-row${isActive ? " active" : ""}`}
      style={{ paddingLeft: 12 + item.depth * 15 }}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      onPointerDown={(event) => {
        longPressedRef.current = false;
        originRef.current = { x: event.clientX, y: event.clientY };
        clearLongPress();
        timerRef.current = window.setTimeout(() => {
          longPressedRef.current = true;
          onLongPress(item.id);
        }, 480);
      }}
      onPointerMove={(event) => {
        const origin = originRef.current;
        if (!origin) {
          return;
        }
        if (Math.abs(event.clientX - origin.x) > 8 || Math.abs(event.clientY - origin.y) > 8) {
          clearLongPress();
        }
      }}
      onPointerUp={() => {
        clearLongPress();
      }}
      onPointerCancel={clearLongPress}
      onPointerLeave={clearLongPress}
    >
      {item.children.length > 0 ? (
        <button
          type="button"
          className={`mobile-folder-row-toggle${isExpanded ? " expanded" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(item.id);
          }}
          aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
        >
          <ChevronRight size={16} />
        </button>
      ) : (
        <span className="mobile-folder-row-toggle-spacer" aria-hidden />
      )}

      <button
        type="button"
        className="mobile-folder-row-main"
        aria-label={`Open folder ${getDisplayFolderName(item.name)}`}
        onClick={() => {
          if (longPressedRef.current) {
            longPressedRef.current = false;
            return;
          }
          onSelect(item.id);
        }}
      >
        <span className="mobile-folder-row-title-wrap">
          <Folder size={15} className="mobile-folder-row-icon" aria-hidden />
          <span className="mobile-folder-row-title">{getDisplayFolderName(item.name)}</span>
        </span>
        <span className="mobile-folder-row-count">{item.noteCount || 0}</span>
      </button>
    </div>
  );
}
