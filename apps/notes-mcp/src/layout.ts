import { lstat } from 'node:fs/promises';
import { join } from 'node:path';

export type LayoutMode = 'auto' | 'legacy' | 'system';
export type ResolvedLayout = {kind: 'legacy' | 'system'; stream: string; me: string; agent: string};
const layouts: Record<'legacy' | 'system', ResolvedLayout> = {
  legacy: {kind: 'legacy', stream: 'Feed', me: 'me', agent: 'agent'},
  system: {kind: 'system', stream: '_system/stream', me: '_system/me', agent: '_system/agent'},
};
/** Resolve only; never create folders or migrate user data. */
export async function resolveLayout(root: string, mode: LayoutMode = 'auto'): Promise<ResolvedLayout> {
  const exists = async (path: string) => {
    try { await lstat(join(root, path)); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  };
  if (mode !== 'auto') return {...layouts[mode]};
  const legacy = (await Promise.all(['Feed', 'me', 'agent'].map(exists))).some(Boolean);
  const system = (await Promise.all(['_system/stream', '_system/me', '_system/agent'].map(exists))).some(Boolean);
  if (legacy && system) throw new Error('Both legacy and system note areas exist. Select --layout legacy or --layout system explicitly; no migration was performed.');
  return {...layouts[legacy ? 'legacy' : 'system']};
}
