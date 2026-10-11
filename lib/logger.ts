/**
 * Server-Side Logger
 *
 * Small structured logger for server-side error tracking (API routes,
 * lib/*). Emits one JSON line per call to make failures greppable and
 * easy to ship to a log aggregator later.
 *
 * Usage:
 *   logger.error("Failed to send receipt", { err, quoteId, userId, route: "POST /api/quotes/[id]/payments/[paymentId]/receipt" });
 *   logger.warn("Resend send failed", { result: result.error, quoteId });
 *   logger.info("Quote created", { quoteId, userId });
 *
 * Rules:
 *   - Never pass secrets, full env dumps, email HTML/text bodies, or PDF
 *     buffers in `context`. Ids and recipient addresses are fine.
 *   - Pass caught errors under the `err` key so they get fully serialized
 *     (name, message, stack) — never dropped.
 *
 * @module lib/logger
 */

type LogLevel = "error" | "warn" | "info";

export type LogContext = Record<string, unknown>;

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
}

/**
 * Fully serialize an Error (including its `cause` chain, if present) so
 * the stack trace is never lost. Non-Error values are passed through
 * as-is so callers can still attach arbitrary context under `err`.
 */
function serializeError(err: unknown): SerializedError | unknown {
  if (err instanceof Error) {
    const serialized: SerializedError = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
    if (err.cause !== undefined) {
      serialized.cause = serializeError(err.cause);
    }
    return serialized;
  }
  return err;
}

/**
 * Recursively serialize context values, upgrading any Error instances
 * (most commonly under the `err` key) to their full form.
 */
function serializeContext(context: LogContext): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    out[key] = value instanceof Error ? serializeError(value) : value;
  }
  return out;
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  const line = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ? serializeContext(context) : {}),
  };

  const json = JSON.stringify(line);

  switch (level) {
    case "error":
      console.error(json);
      break;
    case "warn":
      console.warn(json);
      break;
    case "info":
      console.log(json);
      break;
  }
}

export const logger = {
  error(message: string, context?: LogContext): void {
    emit("error", message, context);
  },
  warn(message: string, context?: LogContext): void {
    emit("warn", message, context);
  },
  info(message: string, context?: LogContext): void {
    emit("info", message, context);
  },
};

export default logger;
