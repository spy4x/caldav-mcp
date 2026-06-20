// ── HTTP client for CalDAV (PROPFIND, REPORT, PUT, DELETE, MKCOL, PROPPATCH) ──
// Direct HTTP calls — no tsdav or third-party CalDAV libs.

import type { Env } from '../env.ts';
import { propfindCalendars, propfindCalendarHomeSet, reportTodos, reportEvents, mkcalendar } from './xml.ts';
import type { Calendar } from './types.ts';
import { ComponentType } from './types.ts';

export interface CalDavClientOptions {
  env: Env;
  /** Optional per-request auth override (for multi-user later) */
  username?: string;
  password?: string;
}

/** Shared auth header builder */
function basicAuth(user: string, pass: string): string {
  const encoded = btoa(`${user}:${pass}`);
  return `Basic ${encoded}`;
}

export class CalDavClient {
  private baseUrl: string;
  private username: string;
  private password: string;

  constructor(opts: CalDavClientOptions) {
    this.baseUrl = opts.env.caldavUrl;
    this.username = opts.username ?? opts.env.caldavUsername;
    this.password = opts.password ?? opts.env.caldavPassword;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: basicAuth(this.username, this.password),
    };
  }

  /** PROPFIND — list calendar collections */
  async listCalendars(): Promise<Calendar[]> {
    // Step 1: discover calendar-home-set via PROPFIND on root
    const homeSet = await this.discoverCalendarHomeSet();

    // Step 2: PROPFIND on calendar home set URL to list calendars
    const url = homeSet;
    const body = propfindCalendars();

    const res = await fetch(url, {
      method: 'PROPFIND',
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: '1',
      },
      body,
    });

    if (!res.ok) {
      // Fallback: try /{username}/ (Radicale common pattern)
      const fallbackUrl = `${this.baseUrl}/${encodeURIComponent(this.username)}/`;
      const fallbackRes = await fetch(fallbackUrl, {
        method: 'PROPFIND',
        headers: {
          ...this.authHeaders(),
          'Content-Type': 'application/xml; charset=utf-8',
          Depth: '1',
        },
        body,
      });
      if (!fallbackRes.ok) {
        throw new Error(`PROPFIND failed: ${res.status} ${res.statusText}`);
      }
      const fallbackText = await fallbackRes.text();
      return parsePropfindResponse(fallbackText, this.baseUrl);
    }

    const text = await res.text();
    return parsePropfindResponse(text, this.baseUrl);
  }

  /** Discover calendar-home-set via PROPFIND on root */
  private async discoverCalendarHomeSet(): Promise<string> {
    const url = `${this.baseUrl}/`;
    const body = propfindCalendarHomeSet();

    const res = await fetch(url, {
      method: 'PROPFIND',
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: '0',
      },
      body,
    });

    if (!res.ok) {
      // Fallback to /{username}/ path
      return `${this.baseUrl}/${encodeURIComponent(this.username)}/`;
    }

    const text = await res.text();
    // Extract calendar-home-set — flexible namespace matching
    const homeSetMatch = text.match(
      /<(?:C:)?calendar-home-set[^>]*>\s*<(?:D:)?href[^>]*>([^<]+)<\/(?:D:)?href>/i,
    );
    if (homeSetMatch) {
      const href = homeSetMatch[1]!.trim();
      if (href.startsWith('http')) return href;
      return `${this.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
    }

    // Fallback
    return `${this.baseUrl}/${encodeURIComponent(this.username)}/`;
  }

  /** REPORT — calendar-query for VTODOs */
  queryTodos(
    calendarUrl: string,
    statusFilter?: string,
    textFilter?: string,
    dueBefore?: string,
  ): Promise<string> {
    const body = reportTodos(statusFilter, textFilter, dueBefore);
    return this.report(calendarUrl, body);
  }

  /** REPORT — calendar-query for VEVENTs */
  queryEvents(
    calendarUrl: string,
    dateFrom?: string,
    dateTo?: string,
    textFilter?: string,
  ): Promise<string> {
    const body = reportEvents(dateFrom, dateTo, textFilter);
    return this.report(calendarUrl, body);
  }

  /** Generic REPORT call — returns raw XML response */
  private async report(url: string, body: string): Promise<string> {
    const res = await fetch(url, {
      method: 'REPORT',
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: '1',
      },
      body,
    });

    if (!res.ok) {
      throw new Error(`REPORT failed (${url}): ${res.status} ${res.statusText}`);
    }

    return res.text();
  }

  /** PUT — create or update an iCal resource */
  async putIcal(url: string, icalBody: string, etag?: string): Promise<string> {
    const headers: Record<string, string> = {
      ...this.authHeaders(),
      'Content-Type': 'text/calendar; charset=utf-8',
    };
    if (etag) {
      headers['If-Match'] = etag;
    }

    const res = await fetch(url, {
      method: 'PUT',
      headers,
      body: icalBody,
    });

    if (!res.ok) {
      throw new Error(`PUT failed (${url}): ${res.status} ${res.statusText}`);
    }

    // Return new ETag from response
    return res.headers.get('ETag') || '';
  }

  /** DELETE a resource */
  async deleteResource(url: string, etag?: string): Promise<void> {
    const headers: Record<string, string> = {
      ...this.authHeaders(),
    };
    if (etag) {
      headers['If-Match'] = etag;
    }

    const res = await fetch(url, {
      method: 'DELETE',
      headers,
    });

    if (!res.ok) {
      throw new Error(`DELETE failed (${url}): ${res.status} ${res.statusText}`);
    }
  }

  /** MKCALENDAR — create a new calendar collection (RFC 4791) */
  async makeCalendar(
    parentUrl: string,
    displayName: string,
    components: string[],
    color?: string,
    description?: string,
  ): Promise<string> {
    const body = mkcalendar(displayName, components, color, description);
    const url = `${parentUrl}${encodeURIComponent(displayName)}/`;

    const res = await fetch(url, {
      method: 'MKCALENDAR',
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body,
    });

    if (!res.ok) {
      throw new Error(`MKCOL failed (${url}): ${res.status} ${res.statusText}`);
    }

    return url;
  }

  /** PROPPATCH — update calendar properties */
  async proppatch(url: string, xmlBody: string): Promise<void> {
    const res = await fetch(url, {
      method: 'PROPPATCH',
      headers: {
        ...this.authHeaders(),
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: xmlBody,
    });

    if (!res.ok) {
      throw new Error(`PROPPATCH failed (${url}): ${res.status} ${res.statusText}`);
    }
  }
}

// ── XML response parser for PROPFIND ──
// Handles both prefixed (D:, C:, CS:) and default namespace (no prefix) XML.
// Radicale uses default xmlns="DAV:" for DAV elements. CalDAV/CSS use prefixes.
function parsePropfindResponse(xml: string, baseUrl: string): Calendar[] {
  const calendars: Calendar[] = [];

  // Normalize: strip namespace declarations to simplify matching
  // Keep namespace URIs for detection, but remove xmlns attrs
  const cleaned = xml.replace(/\s+xmlns(:\w+)?="[^"]+"/g, '');

  // Match <response> or <D:response> blocks
  const responseRegex = /<(?:D:)?response>([\s\S]*?)<\/(?:D:)?response>/gi;
  let match: RegExpExecArray | null;

  while ((match = responseRegex.exec(cleaned)) !== null) {
    const block = match[1]!;

    // Extract href — <href> or <D:href>
    const href = extractTagFlex(block, 'href');
    if (!href) continue;

    // Must be a calendar — check for calendar element or supported-calendar-component-set
    if (
      !block.includes('<calendar') &&
      !block.includes('urn:ietf:params:xml:ns:caldav') &&
      !block.includes('supported-calendar-component-set')
    ) {
      continue;
    }

    // Must have a calendar resourcetype
    if (!block.includes('calendar') && !block.includes('supported-calendar-component-set')) {
      continue;
    }
    // Must NOT be just a principal
    if (block.includes('<principal')) {
      continue;
    }

    const displayName = extractTagFlex(block, 'displayname') || 'Unnamed';
    const color = extractTagFlex(block, 'calendar-color');
    const description = extractTagFlex(block, 'description');
    const ctag = extractTagFlex(block, 'getctag');

    // Parse supported components — <comp name="VTODO"/> or <C:comp name="VTODO"/>
    const components: ComponentType[] = [];
    const compRegex = /<(?:C:)?comp[^>]*name="([^"]+)"/g;
    let compMatch: RegExpExecArray | null;
    while ((compMatch = compRegex.exec(block)) !== null) {
      const name = compMatch[1]!;
      if (name === 'VEVENT') components.push(ComponentType.VEVENT);
      else if (name === 'VTODO') components.push(ComponentType.VTODO);
      else if (name === 'VJOURNAL') components.push(ComponentType.VJOURNAL);
    }

    const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href.startsWith('/') ? href : '/' + href}`;

    calendars.push({
      url: fullUrl,
      displayName,
      components: components.length > 0 ? components : [ComponentType.VEVENT, ComponentType.VTODO],
      color: color || undefined,
      description: description || undefined,
      ctag: ctag || undefined,
    });
  }

  return calendars;
}

/** Extract tag content — handles both <tag> and <D:tag> / <C:tag> / <CS:tag> */
function extractTagFlex(xml: string, tagName: string): string | undefined {
  const regex = new RegExp(
    `<(?:(?:\\w+):)?${tagName}[^>]*>([\\s\\S]*?)<\\/(?:(?:\\w+):)?${tagName}>`,
    'i',
  );
  const match = xml.match(regex);
  return match ? match[1]!.trim() : undefined;
}


