/** Severity levels, ordered; `silent` disables all output. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** Structured fields attached to a log line. Kept to JSON-safe scalars. */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

/**
 * A structured logger. Every line is one JSON object so it is trivially
 * ingestible by Workers Logs, Logpush, or any downstream pipeline.
 */
export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Derive a logger that always includes `fields` (e.g. the request id). */
  child(fields: LogFields): Logger;
}
