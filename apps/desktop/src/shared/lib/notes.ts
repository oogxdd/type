// Browser-only note helpers. The pure tree walkers (getNoteParentPath,
// collectAllNotes, collectFolderPaths) live in @typenotes/shared/notes.

export const emitTreeInvalidated = () => {
  window.dispatchEvent(new CustomEvent("notes-tree-invalidated"));
};

export const yieldToUi = () =>
  new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });

export const toBase64 = (bytes: Uint8Array) => {
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

export const fromBase64 = (input: string) => {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};
