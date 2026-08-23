import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  chmod: vi.fn(),
  writeFile: vi.fn(),
  updateState: vi.fn(),
  getGoogleAuthManager: vi.fn(),
  getGooglePluginConfigPath: vi.fn(),
}));

vi.mock('node:fs', () => ({
  promises: {
    mkdir: mocks.mkdir,
    chmod: mocks.chmod,
    writeFile: mocks.writeFile,
  },
}));

vi.mock('../app-state', () => ({
  resolveStatePath: (cwd: string) => `${cwd}/.sero/apps/google/state.json`,
  updateState: mocks.updateState,
}));

vi.mock('../google/auth', () => ({
  getGoogleAuthManager: mocks.getGoogleAuthManager,
}));

vi.mock('../google/config', () => ({
  getGooglePluginConfigPath: mocks.getGooglePluginConfigPath,
}));

import { registerGoogleAuthTool } from '../google/auth-tool';

interface RegisteredToolDefinition {
  execute: (
    toolCallId: string,
    params: {
      action: 'save_config';
      client_id: string;
      client_secret: string;
    },
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: undefined,
  ) => Promise<{
    content: [{ type: 'text'; text: string }];
    details: Record<string, unknown>;
  }>;
}

describe('Google auth tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.chmod.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.updateState.mockImplementation(async (_path: string, updater: (s: { activeAccount: string | null }) => unknown) => updater({ activeAccount: null }));
    mocks.getGooglePluginConfigPath.mockReturnValue('/tmp/agent/plugin-config/sero-google-plugin.json');
    mocks.getGoogleAuthManager.mockReturnValue({
      getStatus: vi.fn(async () => ({ configured: true, authenticated: false })),
      login: vi.fn(),
      logout: vi.fn(),
      resetForConfigChange: vi.fn(),
      setBrowserOpener: vi.fn(),
    });
  });

  it('writes OAuth config with locked-down directory and file permissions', async () => {
    let registeredTool: RegisteredToolDefinition | null = null;
    registerGoogleAuthTool(
      {
        registerTool: (tool: RegisteredToolDefinition) => {
          registeredTool = tool;
        },
      } as never,
      () => '/workspace/.sero/apps/google/state.json',
    );

    expect(registeredTool).not.toBeNull();

    const result = await registeredTool!.execute(
      'tool-call-1',
      {
        action: 'save_config',
        client_id: 'client-id',
        client_secret: 'client-secret',
      },
      undefined,
      undefined,
      undefined as never,
    );

    expect(mocks.mkdir).toHaveBeenCalledWith('/tmp/agent/plugin-config', {
      recursive: true,
      mode: 0o700,
    });
    expect(mocks.chmod).toHaveBeenNthCalledWith(1, '/tmp/agent/plugin-config', 0o700);
    expect(mocks.writeFile).toHaveBeenCalledWith(
      '/tmp/agent/plugin-config/sero-google-plugin.json',
      '{\n  "clientId": "client-id",\n  "clientSecret": "client-secret"\n}\n',
      'utf8',
    );
    expect(mocks.chmod).toHaveBeenNthCalledWith(
      2,
      '/tmp/agent/plugin-config/sero-google-plugin.json',
      0o600,
    );
    expect(result).toEqual({
      content: [{ type: 'text', text: 'Saved Google OAuth credentials' }],
      details: { configured: true, authenticated: false },
    });
  });
});
