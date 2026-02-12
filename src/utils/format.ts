export type NotePreview = {
  title: string;
  dateLabel: string;
  secondLine: string;
};

export const formatNoteDateLabel = (timestamp: number | null) => {
  if (!timestamp) {
    return "";
  }
  const value = new Date(timestamp);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemStart = new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate()
  );
  const diffDays = Math.floor(
    (todayStart.getTime() - itemStart.getTime()) / 86_400_000
  );
  if (diffDays <= 0) {
    return value.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (diffDays === 1) {
    return "yesterday";
  }
  if (diffDays < 7) {
    return value.toLocaleDateString([], { weekday: "long" }).toLowerCase();
  }
  return value.toLocaleDateString([], {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  });
};

export const parseNotePreview = (
  noteName: string,
  content: string,
  updatedMs: number | null
): NotePreview => {
  const stripMarkdown = (line: string) =>
    line
      .replace(/^#{1,6}\s+/, "")
      .replace(/^[>\-+*]\s+/, "")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_~`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const lines = content.split(/\r?\n/);
  const fallbackTitle = noteName.replace(/\.md$/i, "");
  const title = stripMarkdown(lines[0] || "") || fallbackTitle;
  const secondLine = stripMarkdown(lines[1] || "");
  return { title, dateLabel: formatNoteDateLabel(updatedMs), secondLine };
};

export const getNextNoteFileName = (existingNames: string[]) => {
  const used = new Set(existingNames.map((name) => name.toLowerCase()));
  let index = 1;
  while (true) {
    const candidate = index === 1 ? "New note.md" : `New note ${index}.md`;
    if (!used.has(candidate.toLowerCase())) {
      return candidate;
    }
    index += 1;
  }
};
