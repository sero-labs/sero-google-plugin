import { promises as fs } from 'node:fs';
import path from 'node:path';

import { withStateLock } from '@sero-ai/extension-runtime';

import { DEFAULT_GOOGLE_STATE, normalizeGoogleState, type GoogleAppState } from '../shared/types';

export function resolveStatePath(cwd: string): string {
  const seroHome = process.env.SERO_HOME;
  if (seroHome) {
    return path.join(seroHome, 'apps', 'google', 'state.json');
  }
  return path.join(cwd, '.sero', 'apps', 'google', 'state.json');
}

export async function readState(filePath: string): Promise<GoogleAppState> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return normalizeGoogleState(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_GOOGLE_STATE };
  }
}

export async function writeState(filePath: string, state: GoogleAppState): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(tmpPath, filePath);
}

/**
 * Locked read-modify-write for state.json. The Sero host writes this file for
 * the UI under the same `<stateFile>.lock` mutex, so a tool result cannot
 * interleave with a panel edit and clobber it (sero#428). Returning the input
 * unchanged skips the write.
 */
export async function updateState(
  filePath: string,
  updater: (current: GoogleAppState) => GoogleAppState,
): Promise<GoogleAppState> {
  return withStateLock(filePath, async () => {
    const current = await readState(filePath);
    const next = updater(current);
    if (next !== current) await writeState(filePath, next);
    return next;
  });
}
