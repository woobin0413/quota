/**
 * Shared API request-body validation
 *
 * Standard JSON-parse + Zod-validate step used by API routes, so the
 * error response shape (INVALID_JSON 400 / VALIDATION_ERROR 422) stays
 * identical across endpoints.
 */

import { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";

type ParseJsonBodyResult<T> =
  | { data: T; response?: never }
  | { data?: never; response: NextResponse };

/**
 * Parse and validate a request body against a Zod schema.
 *
 * @returns `{ data }` on success, or `{ response }` holding the error
 *          response to return from the route handler.
 *
 * @example
 * const parsed = await parseJsonBody(request, createWorkItemSchema);
 * if (parsed.response) return parsed.response;
 * const data = parsed.data;
 */
export async function parseJsonBody<S extends z.ZodTypeAny>(
  request: NextRequest,
  schema: S
): Promise<ParseJsonBodyResult<z.infer<S>>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      response: NextResponse.json(
        { success: false, message: "Invalid JSON in request body", code: "INVALID_JSON" },
        { status: 400 }
      ),
    };
  }

  const validation = schema.safeParse(body);

  if (!validation.success) {
    return {
      response: NextResponse.json(
        {
          success: false,
          message: "Validation failed",
          code: "VALIDATION_ERROR",
          errors: validation.error.errors.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        },
        { status: 422 }
      ),
    };
  }

  return { data: validation.data };
}
