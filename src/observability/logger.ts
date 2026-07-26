import type { LogFields, LogLevel, Logger } from '../types/logging.js';

const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly base?: LogFields;
  /** Where a formatted line goes. Defaults to `console.log`. */
  readonly sink?: (line: string) => void;
  /** Time source in ms. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * A structured logger that emits one JSON object per line — the format Workers
 * Logs and Logpush ingest natively. Fields are merged (base → per-call) and the
 * level gates output cheaply before any serialisation of a suppressed line.
 */
export function createLogger(options: LoggerOptions): Logger {
  const threshold = LEVEL_WEIGHT[options.level];
  const sink =
    options.sink ??
    ((line: string): void => {
      console.log(line);
    });
  const now = options.now ?? ((): number => Date.now());
  const base = options.base ?? {};

  function emit(level: Exclude<LogLevel, 'silent'>, message: string, fields?: LogFields): void {
    if (LEVEL_WEIGHT[level] < threshold) return;
    const line: Record<string, unknown> = {
      level,
      time: new Date(now()).toISOString(),
      message,
      ...base,
      ...fields,
    };
    sink(JSON.stringify(line));
  }

  return {
    debug: (message, fields): void => {
      emit('debug', message, fields);
    },
    info: (message, fields): void => {
      emit('info', message, fields);
    },
    warn: (message, fields): void => {
      emit('warn', message, fields);
    },
    error: (message, fields): void => {
      emit('error', message, fields);
    },
    child: (fields): Logger =>
      createLogger({
        level: options.level,
        base: { ...base, ...fields },
        sink,
        now,
      }),
  };
}
