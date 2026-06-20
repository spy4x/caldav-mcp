// ── XML body builders for CalDAV/WebDAV requests ──
// We build XML as strings — avoids XML parser dependencies.
// Namespaces: DAV: (WebDAV), urn:ietf:params:xml:ns:caldav (CalDAV)

const XML_PROLOG = '<?xml version="1.0" encoding="utf-8" ?>';

/** PROPFIND body to list calendar collections at a URL */
export function propfindCalendars(): string {
  return `${XML_PROLOG}
<D:propfind xmlns:D="DAV:"
            xmlns:C="urn:ietf:params:xml:ns:caldav"
            xmlns:CS="http://calendarserver.org/ns/">
  <D:prop>
    <D:displayname/>
    <D:resourcetype/>
    <C:supported-calendar-component-set/>
    <CS:getctag/>
  </D:prop>
</D:propfind>`;
}

/** PROPFIND body to get calendar home set */
export function propfindCalendarHomeSet(): string {
  return `${XML_PROLOG}
<D:propfind xmlns:D="DAV:"
            xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <C:calendar-home-set/>
    <D:displayname/>
  </D:prop>
</D:propfind>`;
}

/** REPORT body — calendar-query for VTODO with optional filters */
export function reportTodos(
  statusFilter?: string,
  textFilter?: string,
  dueBefore?: string,
): string {
  const filters: string[] = [];

  if (statusFilter && statusFilter !== 'ALL') {
    filters.push(`<C:prop-filter name="STATUS">
      <C:text-match collation="i;ascii-casemap">${escapeXml(statusFilter)}</C:text-match>
    </C:prop-filter>`);
  }

  if (textFilter) {
    filters.push(`<C:prop-filter name="SUMMARY">
      <C:text-match collation="i;ascii-casemap">${escapeXml(textFilter)}</C:text-match>
    </C:prop-filter>`);
  }

  if (dueBefore) {
    filters.push(`<C:prop-filter name="DUE">
      <C:time-range start="19700101T000000Z" end="${toCalDavDate(dueBefore)}"/>
    </C:prop-filter>`);
  }

  // Priority range filtering is done client-side after fetching
  // CalDAV REPORT doesn't support numeric range text-match properly

  const compFilter = filters.length > 0
    ? `<C:comp-filter name="VCALENDAR"><C:comp-filter name="VTODO">${filters.join('')}</C:comp-filter></C:comp-filter>`
    : `<C:comp-filter name="VCALENDAR"><C:comp-filter name="VTODO"/></C:comp-filter>`;

  return `${XML_PROLOG}
<C:calendar-query xmlns:D="DAV:"
                  xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    ${compFilter}
  </C:filter>
</C:calendar-query>`;
}

/** REPORT body — calendar-query for VEVENT with optional filters */
export function reportEvents(
  dateFrom?: string,
  dateTo?: string,
  textFilter?: string,
): string {
  const filters: string[] = [];

  if (dateFrom || dateTo) {
    const start = dateFrom ? toCalDavDate(dateFrom) : '19700101T000000Z';
    const end = dateTo ? toCalDavDate(dateTo) : '20991231T235959Z';
    filters.push(`<C:prop-filter name="DTSTART">
      <C:time-range start="${start}" end="${end}"/>
    </C:prop-filter>`);
  }

  if (textFilter) {
    filters.push(`<C:prop-filter name="SUMMARY">
      <C:text-match collation="i;ascii-casemap">${escapeXml(textFilter)}</C:text-match>
    </C:prop-filter>`);
  }

  const compFilter = filters.length > 0
    ? `<C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT">${filters.join('')}</C:comp-filter></C:comp-filter>`
    : `<C:comp-filter name="VCALENDAR"><C:comp-filter name="VEVENT"/></C:comp-filter>`;

  return `${XML_PROLOG}
<C:calendar-query xmlns:D="DAV:"
                  xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    ${compFilter}
  </C:filter>
</C:calendar-query>`;
}

/** MKCOL body to create a new calendar */
export function mkcalendar(
  displayName: string,
  components: string[],
  color?: string,
  description?: string,
): string {
  const compSet = components.map((c) =>
    `<C:comp name="${c}"/>`
  ).join('');

  return `${XML_PROLOG}
<C:mkcalendar xmlns:D="DAV:"
              xmlns:C="urn:ietf:params:xml:ns:caldav"
              xmlns:CS="http://calendarserver.org/ns/">
  <D:set>
    <D:prop>
      <D:displayname>${escapeXml(displayName)}</D:displayname>
      <C:supported-calendar-component-set>
        ${compSet}
      </C:supported-calendar-component-set>
      ${color ? `<CS:calendar-color>${escapeXml(color)}</CS:calendar-color>` : ''}
      ${description ? `<D:description>${escapeXml(description)}</D:description>` : ''}
    </D:prop>
  </D:set>
</C:mkcalendar>`;
}

/** PROPPATCH body to update calendar properties */
export function proppatchCalendar(
  displayName?: string,
  color?: string,
  description?: string,
): string {
  const props: string[] = [];
  if (displayName) props.push(`<D:displayname>${escapeXml(displayName)}</D:displayname>`);
  if (color) props.push(`<CS:calendar-color xmlns:CS="http://calendarserver.org/ns/">${escapeXml(color)}</CS:calendar-color>`);
  if (description) props.push(`<D:description>${escapeXml(description)}</D:description>`);

  return `${XML_PROLOG}
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      ${props.join('\n      ')}
    </D:prop>
  </D:set>
</D:propertyupdate>`;
}

// ── Helpers ──

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toCalDavDate(iso: string): string {
  // "2026-06-20T09:00:00.000Z" → "20260620T090000Z"
  const d = new Date(iso);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
