import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppRuntimeContext } from '@sero-ai/common';

import { DEFAULT_GOOGLE_STATE, normalizeGoogleState, type GoogleAppState } from '../../shared/types';
import { createAppRuntime, GoogleRuntime } from '../index';
import { runGogJson } from '../../extension/gogcli';
import { getGoogleAuthManager } from '../../extension/google/auth';

vi.mock('../../extension/gogcli', () => ({
  runGogJson: vi.fn(),
}));

vi.mock('../../extension/google/auth', () => ({
  getGoogleAuthManager: vi.fn(),
}));

function createContext(initialState: GoogleAppState | null = null): {
  ctx: AppRuntimeContext;
  getState: () => GoogleAppState | null;
  notify: ReturnType<typeof vi.fn>;
} {
  let currentState = initialState;
  const notify = vi.fn();

  return {
    ctx: {
      appId: 'google',
      workspaceId: 'global',
      workspacePath: '/tmp/google',
      stateFilePath: '/tmp/google/.sero/apps/google/state.json',
      host: {
        appState: {
          read: async <T = unknown>() => currentState as T | null,
          update: async <T = unknown>(_filePath: string, updater: (current: T | null) => T) => {
            currentState = updater(currentState as T | null) as unknown as GoogleAppState;
          },
          watch: () => {},
          unwatch: () => {},
          globalDir: async (namespace: string) => ({ path: `/tmp/app-global/${namespace}` }),
        },
        subagents: {
          runStructured: async () => ({ response: '' }),
          onLiveOutput: () => () => {},
          listToolCatalog: async () => [],
          listSkillCatalog: async () => [],
          listAgentCatalog: async () => [],
        },
        workspace: {
          runCommand: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
          refreshAfterSync: async () => ({ refreshed: false, dependenciesInstalled: false, restartedServerIds: [] }),
          resolveRuntime: async () => ({
            workspaceId: 'global',
            workspacePath: '/tmp/google',
            desiredRuntime: 'host',
            actualRuntime: 'host',
            containerEnabled: false,
            capabilityAudit: [],
          }),
          listAccessRoots: async (workspaceId: string) => ({
            workspaceId,
            runtime: { backend: 'host' as const, mode: 'host' as const },
            roots: [],
            warnings: [],
          }),
          list: async () => [],
        },
        verification: {
          detectCompileCommands: async () => [],
          detectDependencyInstallCommand: async () => null,
          detectDevServerCommand: async () => null,
          detectVerificationCommands: async () => [],
          runCommands: async () => ({ success: true, results: [] }),
          runDevServerSmokeCheck: async () => ({ command: 'pnpm test', success: true, stdout: '', stderr: '', durationMs: 0 }),
          summarizeFailure: () => 'failure',
        },
        git: {
          createWorktree: async () => ({ worktreePath: '', branchName: '', greenfield: false }),
          removeWorktree: async () => {},
          syncWorktreeWithDefaultBranch: async () => ({ success: true, updated: false, resolvedConflicts: false }),
          syncWorkspaceRootToDefaultBranch: async () => ({ synced: true }),
          createCheckpoint: async () => null,
          getDiffSummary: async () => '',
          getDiff: async () => '',
          pushBranch: async () => true,
          ensureRemoteDefaultBranch: async () => 'main',
          createPr: async () => ({ success: false, error: 'not-used' }),
          mergePr: async () => ({ success: false, error: 'not-used' }),
          getPrMergeState: async () => 'unknown',
          getPrMergeError: async () => null,
          getWorkspaceStatus: async () => ({ isGitRepository: true, hasUncommittedChanges: false, summary: '' }),
          stashWorkspaceChanges: async () => ({ stashRef: null }),
          listPullRequests: async () => [],
          listIssues: async () => [],
        },
        devServers: {
          startManaged: async () => ({ reason: 'not-used' }),
          list: () => [],
          stop: async () => false,
          restart: async () => false,
          unregister: () => false,
        },
        notifications: {
          notify,
          requestChoice: async () => ({ choiceId: null, timedOut: true }),
        },
        credentials: {
          getProviderApiKey: async () => null,
        },
        toolchains: {
          ensure: async () => ({ path: '/tmp/tool' }),
          sharedToolsDir: async () => ({ path: '/tmp/app-tools' }),
        },
        models: {
          list: async () => [],
        },
        session: {
          getActiveForWorkspace: async () => null,
          getState: async () => ({ idle: true, pendingMessages: 0, activeTurnId: null }),
          sendUserSteer: async () => ({ turnId: null }),
          sendContextMessage: async () => ({ turnId: null }),
          onTurnComplete: () => () => {},
        },
      },
    },
    getState: () => currentState,
    notify,
  };
}

beforeEach(() => {
  vi.mocked(getGoogleAuthManager).mockReturnValue({
    getStatus: vi.fn(async () => ({ configured: true, authenticated: true, email: 'alice@example.com' })),
  } as never);
  vi.mocked(runGogJson).mockResolvedValue({
    data: {
      threads: [{
        id: 'thread-1',
        snippet: 'Build is green.',
        subject: 'Release update',
        from: 'Alice <alice@example.com>',
        date: '2026-04-18T10:00:00.000Z',
        labelIds: ['INBOX'],
        messages: [{ subject: 'Release update', from: 'Alice <alice@example.com>', date: '2026-04-18T10:00:00.000Z', labels: ['INBOX'] }],
      }],
    },
    error: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('GoogleRuntime', () => {
  it('creates the shared app runtime module shape', async () => {
    const runtime = createAppRuntime(createContext().ctx);

    expect(runtime).toBeInstanceOf(GoogleRuntime);
    await expect(runtime.start()).resolves.toBeUndefined();
    await expect(runtime.dispose()).resolves.toBeUndefined();
  });

  it('syncs the inbox in the background on startup', async () => {
    const { ctx, getState, notify } = createContext();
    const runtime = createAppRuntime(ctx);

    await runtime.start();

    expect(runGogJson).toHaveBeenCalledWith([
      'gmail',
      'search',
      'newer_than:3d',
      '--max',
      '15',
    ]);
    expect(getState()?.gmail.threads).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();

    await runtime.dispose();
  });

  it('uses the configured auto-refresh interval', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T10:00:00.000Z'));

    const { ctx } = createContext(normalizeGoogleState({
      ...DEFAULT_GOOGLE_STATE,
      gmail: {
        ...DEFAULT_GOOGLE_STATE.gmail,
        autoRefreshIntervalMinutes: 1,
        lastFetchedAt: '2026-04-18T10:00:00.000Z',
      },
    }));
    const runtime = createAppRuntime(ctx);

    await runtime.start();
    expect(runGogJson).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(59_000);
    expect(runGogJson).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(runGogJson).toHaveBeenCalledTimes(1);

    await runtime.dispose();
  });

  it('syncs immediately when the auto-refresh interval changes', async () => {
    const { ctx } = createContext(normalizeGoogleState({
      ...DEFAULT_GOOGLE_STATE,
      activeAccount: 'alice@example.com',
      gmail: {
        ...DEFAULT_GOOGLE_STATE.gmail,
        autoRefreshIntervalMinutes: 5,
        lastFetchedAt: new Date().toISOString(),
      },
    }));
    const runtime = createAppRuntime(ctx);

    await runtime.start();
    expect(runGogJson).not.toHaveBeenCalled();

    await runtime.handleStateChange({
      ...DEFAULT_GOOGLE_STATE,
      activeAccount: 'alice@example.com',
      gmail: {
        ...DEFAULT_GOOGLE_STATE.gmail,
        autoRefreshIntervalMinutes: 15,
        lastFetchedAt: new Date().toISOString(),
      },
    });

    expect(runGogJson).toHaveBeenCalledTimes(1);

    await runtime.dispose();
  });

  it('notifies when a brand-new unread thread arrives after a previous sync', async () => {
    const { ctx, notify } = createContext(normalizeGoogleState({
      ...DEFAULT_GOOGLE_STATE,
      activeAccount: 'alice@example.com',
      gmail: {
        ...DEFAULT_GOOGLE_STATE.gmail,
        lastFetchedAt: '2026-04-18T10:00:00.000Z',
        threads: [{
          id: 'thread-old',
          snippet: 'Old mail',
          subject: 'Old message',
          from: 'Bob <bob@example.com>',
          date: '2026-04-18T09:00:00.000Z',
          labelIds: ['INBOX'],
          isUnread: false,
          messageCount: 1,
        }],
      },
    }));
    const runtime = createAppRuntime(ctx);

    vi.mocked(runGogJson).mockResolvedValueOnce({
      data: {
        threads: [{
          id: 'thread-new',
          snippet: 'Build is green.',
          subject: 'Release update',
          from: 'Alice <alice@example.com>',
          date: '2026-04-18T10:05:00.000Z',
          labels: ['INBOX', 'UNREAD'],
          messageCount: 1,
        }],
      },
      error: null,
    });

    await runtime.start();

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      message: 'New mail from Alice',
      subtitle: 'Release update',
      source: 'Google Mail',
    }));

    await runtime.dispose();
  });

  it('notifies when a new unread message lands in an existing thread', async () => {
    const { ctx, notify } = createContext(normalizeGoogleState({
      ...DEFAULT_GOOGLE_STATE,
      activeAccount: 'alice@example.com',
      gmail: {
        ...DEFAULT_GOOGLE_STATE.gmail,
        lastFetchedAt: '2026-04-18T10:00:00.000Z',
        threads: [{
          id: 'thread-1',
          snippet: 'Earlier update',
          subject: 'Release update',
          from: 'Alice <alice@example.com>',
          date: '2026-04-18T10:00:00.000Z',
          labelIds: ['INBOX'],
          isUnread: false,
          messageCount: 1,
        }],
      },
    }));
    const runtime = createAppRuntime(ctx);

    vi.mocked(runGogJson).mockResolvedValueOnce({
      data: {
        threads: [{
          id: 'thread-1',
          snippet: 'Newest update',
          subject: 'Release update',
          from: 'Alice <alice@example.com>',
          date: '2026-04-18T10:05:00.000Z',
          labelIds: ['INBOX', 'UNREAD'],
          messageCount: 2,
          messages: [
            { subject: 'Release update', from: 'Alice <alice@example.com>', date: '2026-04-18T10:00:00.000Z', labels: ['INBOX'] },
            { subject: 'Release update', from: 'Alice <alice@example.com>', date: '2026-04-18T10:05:00.000Z', labels: ['INBOX', 'UNREAD'] },
          ],
        }],
      },
      error: null,
    });

    await runtime.start();

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      message: 'New mail from Alice',
      subtitle: 'Release update',
      source: 'Google Mail',
    }));

    await runtime.dispose();
  });

  it('does not notify when mail notifications are disabled', async () => {
    const { ctx, notify } = createContext(normalizeGoogleState({
      ...DEFAULT_GOOGLE_STATE,
      activeAccount: 'alice@example.com',
      gmail: {
        ...DEFAULT_GOOGLE_STATE.gmail,
        lastFetchedAt: '2026-04-18T10:00:00.000Z',
        notificationsEnabled: false,
        threads: [],
      },
    }));
    const runtime = createAppRuntime(ctx);

    vi.mocked(runGogJson).mockResolvedValueOnce({
      data: {
        threads: [{
          id: 'thread-new',
          snippet: 'Build is green.',
          subject: 'Release update',
          from: 'Alice <alice@example.com>',
          date: '2026-04-18T10:05:00.000Z',
          labelIds: ['INBOX', 'UNREAD'],
          messages: [{ subject: 'Release update', from: 'Alice <alice@example.com>', date: '2026-04-18T10:05:00.000Z', labels: ['INBOX', 'UNREAD'] }],
        }],
      },
      error: null,
    });

    await runtime.start();

    expect(notify).not.toHaveBeenCalled();

    await runtime.dispose();
  });
});
