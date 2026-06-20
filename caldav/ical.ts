// ── iCal (RFC 5545) parser & generator ──
// No dependencies. Handles line folding, escaping, VTODO/VEVENT.

import type { Todo, Event, RelatedTo } from './types.ts';
import { LabelTodoStatus, TodoStatus } from './types.ts';

// ── Line folding / unfolding ──

/** RFC 5545: fold lines at 75 octets */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += 75) {
    const part = line.slice(i, i + 75);
    if (i === 0) parts.push(part);
    else parts.push(' ' + part);
  }
  return parts.join('\r\n');
}

/** Unfold continuation lines */
function unfold(text: string): string {
  return text.replace(/\r?\n[ \t]/g, '');
}

// ── Escaping / Unescaping ──

function escapeICal(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function unescapeICal(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\N/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

// ── Generator ──

export function buildTodoIcal(todo: {
  summary: string;
  description?: string;
  status?: string;
  priority?: number;
  due?: string;
  percentComplete?: number;
  uid?: string;
}): string {
  const uid = todo.uid || crypto.randomUUID();
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const status = todo.status || 'NEEDS-ACTION';
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//caldav-mcp//EN',
    'BEGIN:VTODO',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `SUMMARY:${escapeICal(todo.summary)}`,
    `STATUS:${status}`,
  ];

  if (todo.description) {
    lines.push(`DESCRIPTION:${escapeICal(todo.description)}`);
  }
  if (todo.priority !== undefined && todo.priority >= 1 && todo.priority <= 9) {
    lines.push(`PRIORITY:${todo.priority}`);
  }
  if (todo.due) {
    lines.push(`DUE;VALUE=DATE-TIME:${toICalDate(todo.due)}`);
  }
  if (todo.percentComplete !== undefined) {
    lines.push(`PERCENT-COMPLETE:${Math.max(0, Math.min(100, todo.percentComplete))}`);
  }
  // Recurrence ID and other fields are optional — not needed for basic CRUD

  lines.push('END:VTODO');
  lines.push('END:VCALENDAR');

  return lines.map(foldLine).join('\r\n');
}

export function buildEventIcal(event: {
  summary: string;
  description?: string;
  start: string;
  end: string;
  location?: string;
  status?: string;
  uid?: string;
}): string {
  const uid = event.uid || crypto.randomUUID();
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//caldav-mcp//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `SUMMARY:${escapeICal(event.summary)}`,
    `DTSTART:${toICalDate(event.start)}`,
    `DTEND:${toICalDate(event.end)}`,
  ];

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeICal(event.description)}`);
  }
  if (event.location) {
    lines.push(`LOCATION:${escapeICal(event.location)}`);
  }
  if (event.status) {
    lines.push(`STATUS:${event.status}`);
  }

  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');

  return lines.map(foldLine).join('\r\n');
}

// ── Parser ──

export interface ParsedIcal {
  component: 'VTODO' | 'VEVENT';
  data: Record<string, string>;
  /** Raw iCal block text for the component (for multi-value properties like RELATED-TO) */
  rawBlock: string;
}

/**
 * Parse one or more iCal objects from text.
 * Returns array of parsed components with their properties.
 */
export function parseIcal(text: string): ParsedIcal[] {
  const unfolded = unfold(text);
  const results: ParsedIcal[] = [];
  const lines = unfolded.split(/\r?\n/);

  let currentComponent: 'VTODO' | 'VEVENT' | null = null;
  let currentData: Record<string, string> | null = null;
  let currentRaw: string[] | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line === 'BEGIN:VTODO' || line === 'BEGIN:VEVENT') {
      currentComponent = line.slice(6) as 'VTODO' | 'VEVENT';
      currentData = {};
      currentRaw = [];
      continue;
    }

    if (line === 'END:VTODO' || line === 'END:VEVENT') {
      if (currentComponent && currentData) {
        // Reconstruct raw block for multi-value property extraction
        const rawBlock = `BEGIN:${currentComponent}\r\n${currentRaw!.join('\r\n')}\r\nEND:${currentComponent}`;
        results.push({ component: currentComponent, data: currentData, rawBlock });
      }
      currentComponent = null;
      currentData = null;
      currentRaw = null;
      continue;
    }

    if (currentData) {
      currentRaw?.push(rawLine);
    }

    if (currentData && line.includes(':')) {
      const colonIdx = line.indexOf(':');
      const namePart = line.slice(0, colonIdx);
      // Extract property name (strip parameters like ;VALUE=DATE-TIME)
      const name = namePart.split(';')[0]!.toUpperCase();
      const value = line.slice(colonIdx + 1).trim();
      if (!currentData[name]) {
        currentData[name] = unescapeICal(value);
      }
    }
  }

  return results;
}

/** Parse iCal text into Todo objects */
export function parseTodos(text: string, calendarName: string, baseUrl: string, etags: Map<string, string>): Todo[] {
  const parsed = parseIcal(text);
  const todos: Todo[] = [];

  for (const item of parsed) {
    if (item.component !== 'VTODO') continue;
    const d = item.data;
    const uid = d['UID'] || '';
    const url = d['URL'] || `${baseUrl}${uid}.ics`;

    const statusStr = d['STATUS'] || 'NEEDS-ACTION';
    const status = LabelTodoStatus[statusStr] || TodoStatus.NEEDS_ACTION;

    const priority = d['PRIORITY'] ? parseInt(d['PRIORITY'], 10) : undefined;
    const due = d['DUE'] ? fromICalDate(d['DUE']) : undefined;
    const completed = d['COMPLETED'] ? fromICalDate(d['COMPLETED']) : undefined;
    const percentComplete = d['PERCENT-COMPLETE'] ? parseInt(d['PERCENT-COMPLETE'], 10) : undefined;

    // Extract RELATED-TO with RELTYPE (PARENT/CHILD/SIBLING)
    const relatedTo: RelatedTo[] = [];
    const relatedRegex = /^RELATED-TO(?:;RELTYPE=(\w+))?:(.*)$/gm;
    let rtMatch: RegExpExecArray | null;
    while ((rtMatch = relatedRegex.exec(item.rawBlock)) !== null) {
      const reltype = (rtMatch[1] || 'PARENT').toUpperCase() as RelatedTo['reltype'];
      const uid = rtMatch[2]!.trim();
      // Deduplicate by uid
      if (!relatedTo.some((r) => r.uid === uid)) {
        relatedTo.push({ uid, reltype });
      }
    }

    todos.push({
      summary: d['SUMMARY'] || 'Untitled',
      description: d['DESCRIPTION'],
      status,
      priority: (priority !== undefined && priority >= 1 && priority <= 9) ? priority : undefined,
      due,
      completed,
      percentComplete,
      relatedTo: relatedTo.length > 0 ? relatedTo : undefined,
      url,
      etag: etags.get(uid) || '',
      calendarName,
      uid,
    });
  }

  return todos;
}

/** Parse iCal text into Event objects */
export function parseEvents(text: string, calendarName: string, baseUrl: string, etags: Map<string, string>): Event[] {
  const parsed = parseIcal(text);
  const events: Event[] = [];

  for (const item of parsed) {
    if (item.component !== 'VEVENT') continue;
    const d = item.data;
    const uid = d['UID'] || '';
    const url = d['URL'] || `${baseUrl}${uid}.ics`;

    events.push({
      summary: d['SUMMARY'] || 'Untitled',
      description: d['DESCRIPTION'],
      start: fromICalDate(d['DTSTART'] || ''),
      end: fromICalDate(d['DTEND'] || d['DTSTART'] || ''),
      location: d['LOCATION'],
      url,
      etag: etags.get(uid) || '',
      calendarName,
      uid,
      status: d['STATUS'],
    });
  }

  return events;
}

// ── Date helpers ──

function toICalDate(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function fromICalDate(ical: string): string {
  // "20260620T090000Z" → ISO 8601
  if (!ical) return new Date().toISOString();
  const year = ical.slice(0, 4);
  const month = ical.slice(4, 6);
  const day = ical.slice(6, 8);
  const hour = ical.slice(9, 11) || '00';
  const min = ical.slice(11, 13) || '00';
  const sec = ical.slice(13, 15) || '00';
  const tz = ical.includes('Z') ? 'Z' : '';
  return `${year}-${month}-${day}T${hour}:${min}:${sec}${tz}`;
}
