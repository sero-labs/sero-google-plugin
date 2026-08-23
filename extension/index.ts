/**
 * Google Workspace Pi extension — Gmail + Calendar tools.
 *
 * Wraps gogcli to give the agent access to Gmail and Calendar.
 * Results are written to the app state file so the Sero web UI
 * can display them instantly via file watching.
 */

import { StringEnum } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { Type } from 'typebox';

import {
  applyCalendarCalendarsResult,
  applyCalendarEventResult,
  applyCalendarEventsResult,
  applyGmailSearchResult,
  applyGmailThreadResult,
} from '../shared/google-state';
import { resolveStatePath, updateState } from './app-state';
import { runGog } from './gogcli';
import { registerGoogleAuthTool } from './google/auth-tool';
import { registerGoogleCliTool } from './google/cli-tool';
import { errorToolResult, textToolResult } from './tool-results';

// ── Tool parameters ──────────────────────────────────────────

const GmailParams = Type.Object({
  action: StringEnum([
    'search', 'read_thread', 'send', 'archive', 'labels',
  ] as const),
  query: Type.Optional(Type.String({ description: 'Gmail search query (for search)' })),
  thread_id: Type.Optional(Type.String({ description: 'Thread ID (for read_thread, archive)' })),
  to: Type.Optional(Type.String({ description: 'Recipient email (for send)' })),
  subject: Type.Optional(Type.String({ description: 'Email subject (for send)' })),
  body: Type.Optional(Type.String({ description: 'Email body (for send)' })),
  max: Type.Optional(Type.Number({ description: 'Max results (for search, default 10)' })),
});

const CalendarParams = Type.Object({
  action: StringEnum([
    'today', 'week', 'range', 'search', 'create', 'delete', 'calendars',
  ] as const),
  query: Type.Optional(Type.String({ description: 'Search query (for search)' })),
  calendar_id: Type.Optional(Type.String({ description: 'Calendar ID (default: primary)' })),
  event_id: Type.Optional(Type.String({ description: 'Event ID (for delete)' })),
  summary: Type.Optional(Type.String({ description: 'Event title (for create)' })),
  from: Type.Optional(Type.String({ description: 'Start time for create/range. Use RFC3339 with timezone offset or Z, e.g. 2026-05-05T14:30:00+01:00. Do not use bare local times.' })),
  to: Type.Optional(Type.String({ description: 'End time for create/range. Use RFC3339 with timezone offset or Z, e.g. 2026-05-05T15:30:00+01:00. Do not use bare local times.' })),
  location: Type.Optional(Type.String({ description: 'Event location (for create)' })),
  description: Type.Optional(Type.String({ description: 'Event description or notes (for create)' })),
  attendees: Type.Optional(Type.String({ description: 'Comma-separated emails (for create)' })),
  max: Type.Optional(Type.Number({ description: 'Max results (for range, default 50)' })),
  merge: Type.Optional(Type.Boolean({ description: 'Merge range results into the existing cache instead of replacing it' })),
});

function parseJsonResponse(stdout: string): unknown | null {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return null;
  }
}

// ── Extension entry point ────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let statePath = '';

  pi.on('session_start', async (_event, ctx) => {
    statePath = resolveStatePath(ctx.cwd);
  });
  pi.on('session_tree', async (_event, ctx) => {
    statePath = resolveStatePath(ctx.cwd);
  });

  registerGoogleAuthTool(pi, () => statePath);
  registerGoogleCliTool(pi);

  // ── Gmail tool ─────────────────────────────────────────────

  pi.registerTool({
    name: 'gmail',
    label: 'Gmail',
    description:
      'Access Gmail. Actions: search (query emails), read_thread (get thread details), ' +
      'send (compose email), archive (remove from inbox), labels (list labels).',
    parameters: GmailParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const resolved = ctx ? resolveStatePath(ctx.cwd) : statePath;
      if (!resolved) return errorToolResult('no workspace');
      statePath = resolved;

      switch (params.action) {
        case 'search': {
          const q = params.query || 'newer_than:3d';
          const max = params.max || 10;
          const result = await runGog(
            ['gmail', 'search', q, '--max', String(max)],
            { json: true },
          );
          if (result.exitCode !== 0) {
            return errorToolResult(result.stderr || 'Search failed');
          }

          const data = parseJsonResponse(result.stdout);
          if (data) {
            // Re-read and merge under the shared state lock so the fetch never
            // holds it and a concurrent UI write survives (sero#428).
            await updateState(statePath, (current) => applyGmailSearchResult(current, data, q));
          }
          return textToolResult(result.stdout);
        }

        case 'read_thread': {
          if (!params.thread_id) return errorToolResult('thread_id required');
          const threadId = params.thread_id;
          const result = await runGog(['gmail', 'thread', 'get', threadId], { json: true });
          if (result.exitCode !== 0) {
            return errorToolResult(result.stderr || 'Failed to read thread');
          }

          const data = parseJsonResponse(result.stdout);
          if (data) {
            await updateState(statePath, (current) => applyGmailThreadResult(current, data, threadId));
          }

          const markReadResult = await runGog(
            ['gmail', 'labels', 'modify', threadId, '--remove', 'UNREAD'],
            { json: true },
          );
          if (markReadResult.exitCode !== 0) {
            console.warn('[google] Failed to mark thread as read:', markReadResult.stderr || markReadResult.stdout);
          }

          return textToolResult(result.stdout);
        }

        case 'send': {
          if (!params.to) return errorToolResult('to required');
          const args = ['gmail', 'send', '--to', params.to];
          if (params.subject) args.push('--subject', params.subject);
          if (params.body) args.push('--body', params.body);
          const result = await runGog(args, { json: true });
          if (result.exitCode !== 0) {
            return errorToolResult(result.stderr || 'Send failed');
          }
          return textToolResult('Email sent successfully');
        }

        case 'archive': {
          if (!params.thread_id) return errorToolResult('thread_id required');
          const result = await runGog(
            ['gmail', 'labels', 'modify', params.thread_id, '--remove', 'INBOX'],
            { json: true },
          );
          if (result.exitCode !== 0) {
            return errorToolResult(result.stderr || 'Archive failed');
          }
          return textToolResult(`Archived thread ${params.thread_id}`);
        }

        case 'labels': {
          const result = await runGog(['gmail', 'labels', 'list'], { json: true });
          if (result.exitCode !== 0) {
            return errorToolResult(result.stderr || 'Failed to list labels');
          }
          return textToolResult(result.stdout);
        }

        default:
          return errorToolResult(`Unknown gmail action: ${params.action}`);
      }
    },

    renderCall(args, theme) {
      let text = theme.fg('toolTitle', theme.bold('gmail '));
      text += theme.fg('muted', args.action);
      if (args.query) text += ` ${theme.fg('dim', `"${args.query}"`)}`;
      if (args.to) text += ` ${theme.fg('dim', `→ ${args.to}`)}`;
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

  // ── Calendar tool ──────────────────────────────────────────

  pi.registerTool({
    name: 'gcal',
    label: 'Google Calendar',
    description:
      'Access Google Calendar. Actions: today (today\'s events), week (this week), ' +
      'range (events for a date range), search (find events), create (new event), delete (remove event), calendars (list). ' +
      'For create/range, resolve relative dates first and pass RFC3339 times with a timezone offset or Z, e.g. 2026-05-05T14:30:00+01:00. Never use bare local times like 2026-05-05 14:30 or 2026-05-05T14:30:00.',
    parameters: CalendarParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const resolved = ctx ? resolveStatePath(ctx.cwd) : statePath;
      if (!resolved) return errorToolResult('no workspace');
      statePath = resolved;

      const calId = params.calendar_id || 'primary';

      switch (params.action) {
        case 'today':
        case 'week': {
          const view = params.action;
          const flag = params.action === 'today' ? '--today' : '--week';
          const result = await runGog(['calendar', 'events', calId, flag], { json: true });
          if (result.exitCode !== 0) {
            return errorToolResult(result.stderr || 'Failed to fetch events');
          }

          const data = parseJsonResponse(result.stdout);
          if (data) {
            await updateState(statePath, (current) => applyCalendarEventsResult(current, data, {
              calendarId: calId,
              view,
            }));
          }
          return textToolResult(result.stdout);
        }

        case 'range': {
          if (!params.from || !params.to) {
            return errorToolResult('from and to are required');
          }
          const { from, to } = params;
          const max = params.max || 50;
          const result = await runGog(
            ['calendar', 'events', calId, '--from', from, '--to', to, '--max', String(max)],
            { json: true },
          );
          if (result.exitCode !== 0) {
            return errorToolResult(result.stderr || 'Failed to fetch events');
          }

          const data = parseJsonResponse(result.stdout);
          if (data) {
            await updateState(statePath, (current) => applyCalendarEventsResult(current, data, {
              calendarId: calId,
              mergeRange: params.merge ? { from, to } : undefined,
            }));
          }
          return textToolResult(result.stdout);
        }

        case 'search': {
          if (!params.query) return errorToolResult('query required');
          const result = await runGog(['calendar', 'search', params.query], { json: true });
          if (result.exitCode !== 0) {
            return errorToolResult(result.stderr || 'Search failed');
          }
          return textToolResult(result.stdout);
        }

        case 'create': {
          if (!params.summary || !params.from || !params.to) {
            return errorToolResult('summary, from, to required');
          }
          const args = ['calendar', 'create', calId, '--summary', params.summary, '--from', params.from, '--to', params.to];
          if (params.location) args.push('--location', params.location);
          if (params.description) args.push('--description', params.description);
          if (params.attendees) args.push('--attendees', params.attendees);
          const result = await runGog(args, { json: true });
          if (result.exitCode !== 0) {
            return errorToolResult(result.stderr || 'Create failed');
          }

          const data = parseJsonResponse(result.stdout);
          if (data) {
            await updateState(statePath, (current) => applyCalendarEventResult(current, data, calId));
          }
          return textToolResult(`Created: ${params.summary}`);
        }

        case 'delete': {
          if (!params.event_id) return errorToolResult('event_id required');
          const result = await runGog(['calendar', 'delete', calId, params.event_id], { json: false });
          if (result.exitCode !== 0) {
            return errorToolResult(result.stderr || 'Delete failed');
          }
          return textToolResult(`Deleted event ${params.event_id}`);
        }

        case 'calendars': {
          const result = await runGog(['calendar', 'calendars'], { json: true });
          if (result.exitCode !== 0) {
            return errorToolResult(result.stderr || 'Failed to fetch calendars');
          }

          const data = parseJsonResponse(result.stdout);
          if (data) {
            await updateState(statePath, (current) => applyCalendarCalendarsResult(current, data));
          }
          return textToolResult(result.stdout);
        }

        default:
          return errorToolResult(`Unknown calendar action: ${params.action}`);
      }
    },

    renderCall(args, theme) {
      let text = theme.fg('toolTitle', theme.bold('gcal '));
      text += theme.fg('muted', args.action);
      if (args.summary) text += ` ${theme.fg('dim', `"${args.summary}"`)}`;
      if (args.query) text += ` ${theme.fg('dim', `"${args.query}"`)}`;
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

  // ── Commands ───────────────────────────────────────────────

  pi.registerCommand('gmail', {
    description: 'Search recent Gmail inbox',
    handler: async () => {
      pi.sendUserMessage('Search my recent Gmail inbox using the gmail tool with action search.');
    },
  });

  pi.registerCommand('gcal', {
    description: 'Show today\'s calendar events',
    handler: async () => {
      pi.sendUserMessage('Show today\'s calendar events using the gcal tool with action today.');
    },
  });
}
