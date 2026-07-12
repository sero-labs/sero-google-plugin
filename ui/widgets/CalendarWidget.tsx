/**
 * CalendarWidget — the upcoming agenda for the dashboard.
 *
 * The next calendar events as a clean chronological list (time · title ·
 * where), with today's events highlighted. Composed from the shared
 * @sero-ai/ui dashboard set.
 */

import { useMemo } from 'react';
import { useAppState } from '@sero-ai/app-runtime';
import {
  ActivityList,
  ActivityListItem,
  DataBoundary,
  EmptyState,
  Inline,
  Stack,
  Status,
  WidgetContent,
} from '@sero-ai/ui';
import { CalendarCheck, CalendarDays } from 'lucide-react';
import type { CalendarEvent, GoogleAppState } from '../../shared/types';
import { DEFAULT_GOOGLE_STATE } from '../../shared/types';
import { clockTime, isToday } from './format';
import '../widget.css';

/** How many events the agenda peeks before "+N more". */
const SHOWN = 6;

/** The start-of-event ISO, preferring the local variant when present. */
function startOf(event: CalendarEvent): string {
  return event.start || event.startLocal || '';
}

/** When an event occurs: time for a timed event, "All day" otherwise. */
function whenLabel(event: CalendarEvent): string {
  const start = startOf(event);
  if (!start) return '';
  return event.isAllDay ? 'All day' : clockTime(start);
}

/** Supporting line: weekday for future days, plus location when present. */
function eventDetail(event: CalendarEvent): string {
  const start = startOf(event);
  const parts: string[] = [];
  if (start && !isToday(start)) {
    parts.push(new Date(start).toLocaleDateString(undefined, { weekday: 'short' }));
  }
  if (event.location) parts.push(event.location);
  return parts.join(' · ');
}

export function CalendarWidget() {
  const [state] = useAppState<GoogleAppState>(DEFAULT_GOOGLE_STATE);
  const connected = state.activeAccount !== null;

  const upcoming = useMemo(() => {
    const cutoff = Date.now() - 3_600_000; // keep events until an hour past their end
    return state.calendar.events
      .filter((e) => {
        const end = new Date(e.end || e.endLocal || startOf(e));
        return !isNaN(end.getTime()) && end.getTime() >= cutoff;
      })
      .sort((a, b) => new Date(startOf(a)).getTime() - new Date(startOf(b)).getTime());
  }, [state.calendar.events]);

  const todayCount = upcoming.filter((e) => isToday(startOf(e))).length;

  if (!connected) {
    return (
      <WidgetContent>
        <EmptyState
          icon={CalendarDays}
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
          <Status tone={todayCount > 0 ? 'info' : 'neutral'} pulse={todayCount > 0}>
            {todayCount > 0 ? `${todayCount} today` : 'Agenda'}
          </Status>
        </Inline>

        <DataBoundary
          state={upcoming.length === 0 ? 'empty' : 'ready'}
          empty={<EmptyState icon={CalendarCheck} title="No upcoming events" />}
        >
          <Stack gap="none" scroll>
            <ActivityList overflowCount={Math.max(0, upcoming.length - SHOWN)}>
              {upcoming.slice(0, SHOWN).map((event) => (
                <ActivityListItem
                  key={event.id}
                  tone={isToday(startOf(event)) ? 'info' : 'neutral'}
                  label={<span title={event.summary}>{event.summary}</span>}
                  detail={eventDetail(event) || undefined}
                  timestamp={whenLabel(event)}
                />
              ))}
            </ActivityList>
          </Stack>
        </DataBoundary>
      </Stack>
    </WidgetContent>
  );
}

export default CalendarWidget;
