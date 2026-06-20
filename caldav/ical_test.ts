// ── iCal parser/generator tests ──

import { buildTodoIcal, buildEventIcal, parseIcal } from './ical.ts';
import { assertEquals } from 'std/assert/mod.ts';

Deno.test('buildTodoIcal — produces valid iCal', () => {
  const ical = buildTodoIcal({
    summary: 'Test task',
    description: 'A description',
    priority: 2,
    status: 'NEEDS-ACTION',
    due: '2026-07-01T12:00:00Z',
  });

  // Must contain expected fields
  assertEquals(ical.includes('BEGIN:VCALENDAR'), true);
  assertEquals(ical.includes('BEGIN:VTODO'), true);
  assertEquals(ical.includes('SUMMARY:Test task'), true);
  assertEquals(ical.includes('STATUS:NEEDS-ACTION'), true);
  assertEquals(ical.includes('PRIORITY:2'), true);

  // Should be parseable
  const parsed = parseIcal(ical);
  assertEquals(parsed.length, 1);
  assertEquals(parsed[0]!.component, 'VTODO');
  assertEquals(parsed[0]!.data['SUMMARY'], 'Test task');
});

Deno.test('buildEventIcal — produces valid iCal', () => {
  const ical = buildEventIcal({
    summary: 'Meeting',
    start: '2026-06-20T13:00:00Z',
    end: '2026-06-20T14:00:00Z',
    location: 'Office',
  });

  assertEquals(ical.includes('BEGIN:VEVENT'), true);
  assertEquals(ical.includes('LOCATION:Office'), true);
});

Deno.test('iCal line folding — long descriptions', () => {
  const longDesc = 'A'.repeat(200);
  const ical = buildTodoIcal({ summary: 'Long desc task', description: longDesc });
  const lines = ical.split('\r\n');

  // First description line should start with DESCRIPTION:
  const firstDesc = lines.find((l) => l.startsWith('DESCRIPTION:'));
  assertEquals(firstDesc !== undefined, true);

  // Some continuation lines should exist (start with space)
  const contLines = lines.filter((l) => l.startsWith(' '));
  assertEquals(contLines.length > 0, true);

  // After unfold, description should be 200 A's
  const unfolded = ical.replace(/\r?\n[ \t]/g, '');
  const descMatch = unfolded.match(/DESCRIPTION:([A-Z]+)/);
  assertEquals(descMatch !== null, true);
  assertEquals(descMatch![1]!.length, 200);
});

Deno.test('parseIcal — handles multiple components', () => {
  const ical = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VTODO
UID:test-1
SUMMARY:Task one
STATUS:NEEDS-ACTION
DTSTAMP:20260601T000000Z
END:VTODO
BEGIN:VTODO
UID:test-2
SUMMARY:Task two
STATUS:COMPLETED
DTSTAMP:20260601T000000Z
END:VTODO
END:VCALENDAR`;

  const parsed = parseIcal(ical);
  assertEquals(parsed.length, 2);
  assertEquals(parsed[0]!.data['SUMMARY'], 'Task one');
  assertEquals(parsed[1]!.data['STATUS'], 'COMPLETED');
});
