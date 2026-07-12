/**
 * MailWidget — Gmail inbox at a glance for the dashboard.
 *
 * Unread count, the most recent threads (sender · subject · when) and the
 * connection state, composed from the shared @sero-ai/ui dashboard set.
 */

import { useAppState } from '@sero-ai/app-runtime';
import {
  ActivityList,
  ActivityListItem,
  DataBoundary,
  EmptyState,
  Inline,
  Stack,
  Status,
  Text,
  WidgetContent,
} from '@sero-ai/ui';
import { Mail, MailCheck } from 'lucide-react';
import type { GmailThread, GoogleAppState } from '../../shared/types';
import { DEFAULT_GOOGLE_STATE } from '../../shared/types';
import { shortDate } from './format';
import '../widget.css';

/** How many threads the list peeks before "+N more". */
const SHOWN = 5;

/** First name / display name from a raw "Name <addr>" From header. */
function senderName(from: string): string {
  const name = from.replace(/<[^>]+>/, '').trim();
  return name || from;
}

export function MailWidget() {
  const [state] = useAppState<GoogleAppState>(DEFAULT_GOOGLE_STATE);
  const connected = state.activeAccount !== null;
  const threads = state.gmail.threads;
  const unread = threads.filter((t) => t.isUnread).length;

  if (!connected) {
    return (
      <WidgetContent>
        <EmptyState
          icon={Mail}
          title="Google not connected"
          message="Open the Google app to sign in."
        />
      </WidgetContent>
    );
  }

  return (
    <WidgetContent>
      <Stack gap="sm" fill>
        <Inline justify="between" align="center">
          <Inline gap="xs" align="center">
            <Status tone={unread > 0 ? 'info' : 'neutral'} pulse={unread > 0}>
              {unread > 0 ? `${unread} unread` : 'Inbox'}
            </Status>
          </Inline>
          {state.gmail.lastFetchedAt && (
            <Text variant="supporting">{shortDate(state.gmail.lastFetchedAt)}</Text>
          )}
        </Inline>

        <DataBoundary
          state={threads.length === 0 ? 'empty' : 'ready'}
          empty={<EmptyState icon={MailCheck} title="Inbox empty" />}
        >
          <Stack gap="none" scroll>
            <ActivityList overflowCount={Math.max(0, threads.length - SHOWN)}>
              {threads.slice(0, SHOWN).map((thread) => (
                <ThreadRow key={thread.id} thread={thread} />
              ))}
            </ActivityList>
          </Stack>
        </DataBoundary>
      </Stack>
    </WidgetContent>
  );
}

function ThreadRow({ thread }: { thread: GmailThread }) {
  const name = senderName(thread.from);
  const count = thread.messageCount > 1 ? ` (${thread.messageCount})` : '';
  return (
    <ActivityListItem
      tone={thread.isUnread ? 'info' : 'neutral'}
      label={
        <span className={thread.isUnread ? 'font-semibold' : undefined} title={name}>
          {name}
          {count}
        </span>
      }
      detail={<span title={thread.subject}>{thread.subject}</span>}
      timestamp={shortDate(thread.date)}
    />
  );
}

export default MailWidget;
