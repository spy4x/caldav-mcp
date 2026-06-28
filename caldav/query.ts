// ── Parallel calendar query logic ──
// Fetches all calendars → queries each in parallel → aggregates results.

import { CalDavClient } from './client.ts';
import { parseEvents, parseTodos } from './ical.ts';
import type { Calendar, Event, EventQueryResult, Todo, TodoQueryResult } from './types.ts';
import { ComponentType, TodoStatus, TodoStatusLabel } from './types.ts';
import type { PriorityFilter } from './types.ts';

const MAX_TODOS = 200;
const MAX_EVENTS = 200;

export class QueryEngine {
  readonly client: CalDavClient; // public for tool access

  constructor(client: CalDavClient) {
    this.client = client;
  }

  /** Get auth headers for direct fetch calls */
  getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Basic ${btoa(`${this.client['username']}:${this.client['password']}`)}`,
    };
  }

  /** Fetch all calendars */
  listCalendars(): Promise<Calendar[]> {
    return this.client.listCalendars();
  }

  /** Query todos across all (or one) calendar with optional filters */
  async queryTodos(opts: {
    calendarUrl?: string;
    status?: string;
    text?: string;
    dueBefore?: string;
    priority?: PriorityFilter;
  }): Promise<TodoQueryResult> {
    const calendars = opts.calendarUrl
      ? [
        {
          url: opts.calendarUrl,
          displayName: opts.calendarUrl,
          components: [ComponentType.VTODO],
        } as Calendar,
      ]
      : (await this.listCalendars()).filter((c) => c.components.includes(ComponentType.VTODO));

    if (calendars.length === 0) {
      return {
        total: 0,
        byStatus: {},
        byPriority: { high: 0, medium: 0, low: 0, none: 0 },
        overdue: 0,
        truncated: false,
        todos: [],
      };
    }

    // Query all calendars in parallel
    const results = await Promise.all(
      calendars.map(async (cal) => {
        try {
          const rawXml = await this.client.queryTodos(
            cal.url,
            opts.status,
            opts.text,
            opts.dueBefore,
          );
          return { xml: rawXml, calendar: cal };
        } catch (err) {
          console.error(`Failed to query ${cal.displayName}:`, err);
          return { xml: '', calendar: cal };
        }
      }),
    );

    // Extract ETags from REPORT response
    // The REPORT returns <D:response> with href + getetag + calendar-data
    const allTodos: Todo[] = [];
    for (const { xml, calendar } of results) {
      if (!xml) continue;
      const etags = extractEtags(xml, calendar.url);
      const todos = parseTodos(xml, calendar.displayName, calendar.url, etags);
      allTodos.push(...todos);
    }

    // Client-side priority filtering (CalDAV REPORT cannot do range filters)
    let filtered = allTodos;
    if (opts.priority) {
      const min = opts.priority.min ?? 1;
      const max = opts.priority.max ?? 9;
      filtered = allTodos.filter((t) =>
        t.priority !== undefined && t.priority >= min && t.priority <= max
      );
    }

    return aggregateTodos(filtered);
  }

  /** Get single todo by URL */
  async getTodo(url: string): Promise<Todo | null> {
    try {
      // Fetch the raw iCal file
      const res = await fetch(url, {
        headers: this.getAuthHeaders(),
      });
      if (!res.ok) return null;
      const text = await res.text();
      const etag = res.headers.get('ETag') || '';
      const calendarName = extractCalendarName(url);
      const etags = new Map<string, string>();
      const uidMatch = text.match(/^UID:(.*)$/m);
      if (uidMatch) etags.set(uidMatch[1]!.trim(), etag);
      const todos = parseTodos(text, calendarName, url, etags);
      return todos[0] || null;
    } catch {
      return null;
    }
  }

  /** Query events across all (or one) calendar */
  async queryEvents(opts: {
    calendarUrl?: string;
    dateFrom?: string;
    dateTo?: string;
    text?: string;
  }): Promise<EventQueryResult> {
    const calendars = opts.calendarUrl
      ? [
        {
          url: opts.calendarUrl,
          displayName: opts.calendarUrl,
          components: [ComponentType.VEVENT],
        } as Calendar,
      ]
      : (await this.listCalendars()).filter((c) => c.components.includes(ComponentType.VEVENT));

    if (calendars.length === 0) {
      return { total: 0, upcoming: 0, truncated: false, events: [] };
    }

    const results = await Promise.all(
      calendars.map(async (cal) => {
        try {
          const rawXml = await this.client.queryEvents(
            cal.url,
            opts.dateFrom,
            opts.dateTo,
            opts.text,
          );
          return { xml: rawXml, calendar: cal };
        } catch (err) {
          console.error(`Failed to query events for ${cal.displayName}:`, err);
          return { xml: '', calendar: cal };
        }
      }),
    );

    const allEvents: Event[] = [];
    for (const { xml, calendar } of results) {
      if (!xml) continue;
      const etags = extractEtags(xml, calendar.url);
      const events = parseEvents(xml, calendar.displayName, calendar.url, etags);
      allEvents.push(...events);
    }

    return aggregateEvents(allEvents);
  }

  /** Get single event by URL */
  async getEvent(url: string): Promise<Event | null> {
    try {
      const res = await fetch(url, { headers: this.getAuthHeaders() });
      if (!res.ok) return null;
      const text = await res.text();
      const calendarName = extractCalendarName(url);
      const etags = new Map<string, string>();
      const uidMatch = text.match(/^UID:(.*)$/m);
      if (uidMatch) etags.set(uidMatch[1]!.trim(), res.headers.get('ETag') || '');
      const events = parseEvents(text, calendarName, url, etags);
      return events[0] || null;
    } catch {
      return null;
    }
  }

  /** Create a todo */
  async createTodo(
    calendarUrl: string,
    todo: {
      summary: string;
      description?: string;
      categories?: string[];
      due?: string;
      priority?: number;
      status?: string;
      percentComplete?: number;
    },
  ): Promise<{ url: string; etag: string }> {
    const { buildTodoIcal } = await import('./ical.ts');
    const ical = buildTodoIcal({
      summary: todo.summary,
      description: todo.description,
      categories: todo.categories,
      status: todo.status,
      priority: todo.priority,
      due: todo.due,
      percentComplete: todo.percentComplete,
    });

    const uidMatch = ical.match(/^UID:(.*)$/m);
    const uid = uidMatch ? uidMatch[1]!.trim() : crypto.randomUUID();
    const url = `${calendarUrl}${uid}.ics`;

    const etag = await this.client.putIcal(url, ical);
    return { url, etag };
  }

  /** Update a todo */
  async updateTodo(
    url: string,
    etag: string,
    updates: {
      summary?: string;
      description?: string;
      categories?: string[];
      due?: string;
      priority?: number;
      status?: string;
      percentComplete?: number;
    },
  ): Promise<string> {
    const existing = await this.getTodo(url);
    if (!existing) throw new Error('Todo not found');

    const { buildTodoIcal } = await import('./ical.ts');
    const ical = buildTodoIcal({
      summary: updates.summary ?? existing.summary,
      description: updates.description ?? existing.description,
      categories: updates.categories ?? existing.categories,
      status: updates.status ?? TodoStatusLabel[existing.status],
      priority: updates.priority ?? existing.priority,
      due: updates.due ?? existing.due,
      percentComplete: updates.percentComplete ?? existing.percentComplete,
      uid: existing.uid,
    });

    return this.client.putIcal(url, ical, etag);
  }

  /** Delete a todo */
  async deleteTodo(url: string, etag: string): Promise<void> {
    await this.client.deleteResource(url, etag);
  }

  /** Create an event */
  async createEvent(
    calendarUrl: string,
    event: { summary: string; description?: string; start: string; end: string; location?: string },
  ): Promise<{ url: string; etag: string }> {
    const { buildEventIcal } = await import('./ical.ts');
    const ical = buildEventIcal({
      summary: event.summary,
      description: event.description,
      start: event.start,
      end: event.end,
      location: event.location,
    });

    const uidMatch = ical.match(/^UID:(.*)$/m);
    const uid = uidMatch ? uidMatch[1]!.trim() : crypto.randomUUID();
    const url = `${calendarUrl}${uid}.ics`;

    const etag = await this.client.putIcal(url, ical);
    return { url, etag };
  }

  /** Update an event */
  async updateEvent(
    url: string,
    etag: string,
    updates: {
      summary?: string;
      description?: string;
      start?: string;
      end?: string;
      location?: string;
    },
  ): Promise<string> {
    const existing = await this.getEvent(url);
    if (!existing) throw new Error('Event not found');

    const { buildEventIcal } = await import('./ical.ts');
    const ical = buildEventIcal({
      summary: updates.summary ?? existing.summary,
      description: updates.description ?? existing.description,
      start: updates.start ?? existing.start,
      end: updates.end ?? existing.end,
      location: updates.location ?? existing.location,
      uid: existing.uid,
    });

    return this.client.putIcal(url, ical, etag);
  }

  /** Delete an event */
  async deleteEvent(url: string, etag: string): Promise<void> {
    await this.client.deleteResource(url, etag);
  }
}

// ── Aggregation helpers ──

function aggregateTodos(todos: Todo[]): TodoQueryResult {
  const byStatus: Record<string, number> = {};
  let high = 0, medium = 0, low = 0, none = 0;
  let overdue = 0;
  const now = new Date();

  for (const t of todos) {
    const label = TodoStatusLabel[t.status];
    byStatus[label] = (byStatus[label] || 0) + 1;

    // Priority: 1-3 high, 4-6 medium, 7-9 low, undefined = none
    if (t.priority === undefined || t.priority === 0) none++;
    else if (t.priority <= 3) high++;
    else if (t.priority <= 6) medium++;
    else low++;

    // Overdue: NEEDS-ACTION or IN-PROCESS with due before now
    if (
      (t.status === TodoStatus.NEEDS_ACTION || t.status === TodoStatus.IN_PROCESS) &&
      t.due && new Date(t.due) < now
    ) {
      overdue++;
    }
  }

  const truncated = todos.length > MAX_TODOS;
  const sliced = todos.slice(0, MAX_TODOS);

  return {
    total: todos.length,
    byStatus,
    byPriority: { high, medium, low, none },
    overdue,
    truncated,
    todos: sliced.map((t) => ({
      summary: t.summary,
      description: t.description,
      categories: t.categories,
      status: TodoStatusLabel[t.status],
      priority: t.priority,
      due: t.due,
      relatedTo: t.relatedTo?.map((r) => ({ uid: r.uid, reltype: r.reltype })),
      calendarName: t.calendarName,
      url: t.url,
      etag: t.etag,
    })),
  };
}

function aggregateEvents(events: Event[]): EventQueryResult {
  const now = new Date();
  let upcoming = 0;

  for (const e of events) {
    if (new Date(e.start) >= now) upcoming++;
  }

  const truncated = events.length > MAX_EVENTS;
  const sliced = events.slice(0, MAX_EVENTS);

  return {
    total: events.length,
    upcoming,
    truncated,
    events: sliced.map((e) => ({
      summary: e.summary,
      description: e.description,
      start: e.start,
      end: e.end,
      location: e.location,
      calendarName: e.calendarName,
      url: e.url,
      etag: e.etag,
    })),
  };
}

// ── Misc helpers ──

/** Extract ETags from REPORT response for each UID */
function extractEtags(xml: string, _baseUrl: string): Map<string, string> {
  const map = new Map<string, string>();

  // Match <response> or <D:response> blocks containing href and getetag
  const responseRegex = /<(?:D:)?response>([\s\S]*?)<\/(?:D:)?response>/gi;
  let match: RegExpExecArray | null;

  while ((match = responseRegex.exec(xml)) !== null) {
    const block = match[1]!;
    // Extract UID from calendar-data if present, or from href
    const href = extractTagSimple(block, 'href');
    const etag = extractTagSimple(block, 'getetag');
    if (href && etag) {
      // Derive UID from filename (without .ics extension, without path)
      const uid = href.split('/').pop()?.replace(/\.ics$/i, '') || href;
      map.set(uid, etag);
    }
  }

  return map;
}

/** Extract tag content — handles both <tagname> and <D:tagname> / <C:tagname> */
function extractTagSimple(xml: string, tagName: string): string | undefined {
  const regex = new RegExp(
    `<(?:(?:\\w+):)?${tagName}[^>]*>([\\s\\S]*?)<\\/(?:(?:\\w+):)?${tagName}>`,
    'i',
  );
  const match = xml.match(regex);
  return match ? match[1]!.trim() : undefined;
}

function extractCalendarName(url: string): string {
  // Derive from URL path: .../calendars/__uids__/.../calendar-name/todo.ics
  const parts = url.split('/');
  // Look for a segment that might be a calendar name (not UID-like)
  for (let i = parts.length - 2; i >= 0; i--) {
    const p = parts[i]!;
    if (p && !p.startsWith('__') && !p.includes('.')) {
      return p;
    }
  }
  return 'Unknown';
}
