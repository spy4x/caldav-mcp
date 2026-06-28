// ── CalDAV domain types ──

export enum ComponentType {
  VEVENT = 1,
  VTODO = 2,
  VJOURNAL = 3,
}

export interface Calendar {
  url: string;
  displayName: string;
  components: ComponentType[];
  color?: string;
  description?: string;
  ctag?: string;
}

export interface RelatedTo {
  uid: string;
  reltype: 'PARENT' | 'CHILD' | 'SIBLING';
}

export interface Todo {
  summary: string;
  description?: string;
  categories?: string[]; // RFC 5545 CATEGORIES
  status: TodoStatus;
  priority?: number; // 1-9, RFC 5545
  due?: string; // ISO 8601
  completed?: string; // ISO 8601
  percentComplete?: number; // 0-100
  relatedTo?: RelatedTo[]; // Related tasks (RFC 5545 RELATED-TO)
  url: string;
  etag: string;
  calendarName: string;
  uid: string;
}

export enum TodoStatus {
  NEEDS_ACTION = 1,
  IN_PROCESS = 2,
  COMPLETED = 3,
  CANCELLED = 4,
}

export const TodoStatusLabel: Record<TodoStatus, string> = {
  [TodoStatus.NEEDS_ACTION]: 'NEEDS-ACTION',
  [TodoStatus.IN_PROCESS]: 'IN-PROCESS',
  [TodoStatus.COMPLETED]: 'COMPLETED',
  [TodoStatus.CANCELLED]: 'CANCELLED',
};

export const LabelTodoStatus: Record<string, TodoStatus> = {
  'NEEDS-ACTION': TodoStatus.NEEDS_ACTION,
  'IN-PROCESS': TodoStatus.IN_PROCESS,
  'COMPLETED': TodoStatus.COMPLETED,
  'CANCELLED': TodoStatus.CANCELLED,
};

export interface Event {
  summary: string;
  description?: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
  location?: string;
  url: string;
  etag: string;
  calendarName: string;
  uid: string;
  status?: string;
}

export interface TodoQueryResult {
  total: number;
  byStatus: Record<string, number>;
  byPriority: { high: number; medium: number; low: number; none: number };
  overdue: number;
  truncated: boolean;
  todos: TodoSummary[];
}

export interface TodoSummary {
  summary: string;
  description?: string;
  categories?: string[];
  status: string;
  priority?: number;
  due?: string;
  relatedTo?: string[] | { uid: string; reltype: string }[];
  calendarName: string;
  url: string;
  etag: string;
}

export interface EventQueryResult {
  total: number;
  upcoming: number;
  truncated: boolean;
  events: EventSummary[];
}

export interface EventSummary {
  summary: string;
  description?: string;
  start: string;
  end: string;
  location?: string;
  calendarName: string;
  url: string;
  etag: string;
}

export interface PriorityFilter {
  min?: number;
  max?: number;
}
