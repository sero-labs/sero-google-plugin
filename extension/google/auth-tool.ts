import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { StringEnum } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { Type } from 'typebox';

import { resolveStatePath, updateState } from '../app-state';
import { errorToolResult, textToolResult } from '../tool-results';
import { getGoogleAuthManager } from './auth';
import { getGooglePluginConfigPath } from './config';
import type { GoogleAuthStatus } from './types';

const execFileAsync = promisify(execFile);

const GoogleAuthParams = Type.Object({
  action: StringEnum(['status', 'login', 'logout', 'save_config'] as const),
  client_id: Type.Optional(Type.String({ description: 'Google OAuth client ID (for save_config)' })),
  client_secret: Type.Optional(Type.String({ description: 'Google OAuth client secret (for save_config)' })),
});

async function openExternal(url: string): Promise<void> {
  if (process.platform === 'darwin') {
    await execFileAsync('open', [url]);
    return;
  }

  if (process.platform === 'linux') {
    await execFileAsync('xdg-open', [url]);
    return;
  }

  if (process.platform === 'win32') {
    await execFileAsync('cmd', ['/c', 'start', '', url]);
    return;
  }

  throw new Error(`Unsupported platform for browser launch: ${process.platform}`);
}

async function writeGooglePluginConfig(clientId: string, clientSecret: string): Promise<void> {
  const configPath = getGooglePluginConfigPath();
  const configDir = path.dirname(configPath);
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
  await fs.chmod(configDir, 0o700);
  await fs.writeFile(
    configPath,
    JSON.stringify({ clientId, clientSecret }, null, 2) + '\n',
    'utf8',
  );
  await fs.chmod(configPath, 0o600);
}

function authDetails(status: GoogleAuthStatus): Record<string, unknown> {
  return status.email
    ? { configured: status.configured, authenticated: status.authenticated, email: status.email }
    : { configured: status.configured, authenticated: status.authenticated };
}

function authStatusText(status: GoogleAuthStatus): string {
  if (!status.configured) {
    return 'Google OAuth is not configured';
  }

  if (!status.authenticated) {
    return 'Signed out';
  }

  return status.email ? `Signed in as ${status.email}` : 'Authenticated';
}

async function syncActiveAccount(statePath: string, email: string | null): Promise<void> {
  // Runs under the shared state lock; an unchanged account skips the write (sero#428).
  await updateState(statePath, (state) =>
    state.activeAccount === email ? state : { ...state, activeAccount: email },
  );
}

export function registerGoogleAuthTool(
  pi: ExtensionAPI,
  getStatePath: () => string,
): void {
  pi.registerTool({
    name: 'google_auth',
    label: 'Google Auth',
    description:
      'Internal Google auth + config actions for the Google app UI. ' +
      'Actions: status, login, logout, save_config.',
    parameters: GoogleAuthParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const statePath = ctx ? resolveStatePath(ctx.cwd) : getStatePath();
      if (!statePath) {
        return errorToolResult('no workspace');
      }

      const auth = getGoogleAuthManager();

      try {
        switch (params.action) {
          case 'status': {
            const status = await auth.getStatus();
            await syncActiveAccount(statePath, status.authenticated ? status.email ?? null : null);
            return textToolResult(authStatusText(status), authDetails(status));
          }

          case 'login': {
            auth.setBrowserOpener(openExternal);
            await auth.login(() => {});
            const status = await auth.getStatus();
            await syncActiveAccount(statePath, status.authenticated ? status.email ?? null : null);
            return textToolResult(authStatusText(status), authDetails(status));
          }

          case 'logout': {
            await auth.logout();
            await syncActiveAccount(statePath, null);
            const status = await auth.getStatus();
            return textToolResult('Signed out', authDetails(status));
          }

          case 'save_config': {
            if (!params.client_id || !params.client_secret) {
              return errorToolResult('client_id and client_secret are required');
            }

            await writeGooglePluginConfig(params.client_id, params.client_secret);
            auth.resetForConfigChange();
            const status = await auth.getStatus();
            await syncActiveAccount(statePath, status.authenticated ? status.email ?? null : null);
            return textToolResult('Saved Google OAuth credentials', authDetails(status));
          }

          default:
            return errorToolResult(`Unknown google_auth action: ${params.action}`);
        }
      } catch (error) {
        return errorToolResult(error instanceof Error ? error.message : 'Google auth action failed');
      }
    },

    renderCall(args, theme) {
      let text = theme.fg('toolTitle', theme.bold('google_auth '));
      text += theme.fg('muted', args.action);
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const first = result.content[0];
      const msg = first?.type === 'text' ? first.text : '';
      const short = msg.length > 120 ? msg.slice(0, 120) + '…' : msg;
      return new Text(
        msg.startsWith('Error:') ? theme.fg('error', short) : theme.fg('success', '✓ ') + theme.fg('muted', short),
        0, 0,
      );
    },
  });
}
