const safeSegment = (value: string): string => {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .trim()
    .replace(/^[.-]+|[. -]+$/g, "");
  return cleaned || "Working Folder";
};

/** Stable, provider-safe destination name with second-level collision avoidance. */
export const backupFolderName = (profileName: string, now = new Date()): string => {
  const timestamp = now.toISOString().replace("T", " ").replace(/[:]/g, "-").slice(0, 19);
  return `Type Backup - ${safeSegment(profileName)} - ${timestamp} UTC`;
};
