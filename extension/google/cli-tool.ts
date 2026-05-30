import { StringEnum } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { Type, type Static } from 'typebox';

import { errorToolResult, textToolResult } from '../tool-results';
import {
  GOOGLE_CLI_HELP,
  GOOGLE_CLI_SUMMARY,
  handleGoogleCliCommand,
} from './cli-handlers';
import type {
  GoogleCliAccessMode,
  GoogleCliContext,
  GoogleCliSessionRuntime,
  GoogleCliToolDefinition,
} from './cli-types';

const GoogleToolParams = Type.Object({
  service: StringEnum(['auth', 'gmail', 'calendar'] as const),
  action: Type.String({ description: 'Google service action, e.g. list, search, events, create.' }),
  args: Type.Optional(Type.Array(Type.String(), {
    description: 'Additional positional arguments and flags, in CLI token order. Calendar create/update/freebusy/range times must be RFC3339 with a timezone offset or Z, e.g. 2026-05-05T14:30:00+01:00; do not pass bare local times.',
  })),
});

type GoogleToolParamsValue = Static<typeof GoogleToolParams>;

function buildStructuredArgs(params: GoogleToolParamsValue): string[] {
  return [params.service, params.action, ...(params.args ?? [])];
}

interface GoogleCliContextCandidate {
  workspaceId?: string;
  workspaceManager?: GoogleCliContext['workspaceManager'];
  containerManager?: GoogleCliContext['containerManager'];
  access?: GoogleCliAccessMode;
  invocation?: { source?: string };
  agentContext?: unknown;
  sessionRuntime?: unknown;
}

function resolveCliAccess(candidate: GoogleCliContextCandidate): GoogleCliAccessMode {
  if (candidate.invocation?.source === 'tool' || candidate.agentContext || candidate.sessionRuntime) {
    return 'agent';
  }
  return 'operator';
}

function isSessionRuntime(value: unknown): value is GoogleCliSessionRuntime {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { sendMessage?: unknown }).sendMessage === 'function';
}

function toCliContext(context: unknown): GoogleCliContext | undefined {
  if (!context || typeof context !== 'object') return undefined;

  const candidate = context as GoogleCliContextCandidate;
  if (
    typeof candidate.workspaceId !== 'string' ||
    !candidate.workspaceManager ||
    !candidate.containerManager
  ) {
    return undefined;
  }

  return {
    workspaceId: candidate.workspaceId,
    workspaceManager: candidate.workspaceManager,
    containerManager: candidate.containerManager,
    access: resolveCliAccess(candidate),
    ...(isSessionRuntime(candidate.sessionRuntime) ? { sessionRuntime: candidate.sessionRuntime } : {}),
  };
}

function renderGoogleToolResultText(output: string): string {
  const trimmed = output.trim();
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed;
}

export function createGoogleCliTool(): GoogleCliToolDefinition {
  return {
    name: 'google',
    label: 'Google Workspace',
    description:
      'Google Workspace CLI parity tool. Preserves `sero google ...` auth, Gmail, and Calendar commands. For calendar create/update/freebusy/range, resolve relative dates before calling and pass RFC3339 date-times with a timezone offset or Z (for example 2026-05-05T14:30:00+01:00), never bare local times.',
    parameters: GoogleToolParams,

    async execute(_toolCallId, params) {
      const parsed = params as GoogleToolParamsValue;
      const result = await handleGoogleCliCommand(buildStructuredArgs(parsed), undefined, {
        access: 'agent',
      });
      return result.exitCode === 0
        ? textToolResult(
            result.output,
            result.details && typeof result.details === 'object'
              ? result.details as Record<string, unknown>
              : {},
          )
        : errorToolResult(
            result.output.replace(/^ERROR:\s*/u, ''),
            result.details && typeof result.details === 'object'
              ? result.details as Record<string, unknown>
              : {},
          );
    },

    renderCall(args, theme) {
      const parsed = args as GoogleToolParamsValue;
      let text = theme.fg('toolTitle', theme.bold('google '));
      text += theme.fg('muted', `${parsed.service} ${parsed.action}`);
      if (Array.isArray(parsed.args) && parsed.args.length > 0) {
        text += ` ${theme.fg('dim', parsed.args.join(' '))}`;
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const first = result.content[0];
      const msg = first?.type === 'text' ? first.text : '';
      const short = renderGoogleToolResultText(msg);
      return new Text(
        msg.startsWith('Error:') ? theme.fg('error', short) : theme.fg('success', '✓ ') + theme.fg('muted', short),
        0,
        0,
      );
    },

    cli: {
      summary: GOOGLE_CLI_SUMMARY,
      help: GOOGLE_CLI_HELP,
      group: 'Google',
      overrideBuiltin: true,
      execute: async (args, context) => handleGoogleCliCommand(args, toCliContext(context)),
    },
  };
}

export function registerGoogleCliTool(pi: ExtensionAPI): void {
  pi.registerTool(createGoogleCliTool());
}
