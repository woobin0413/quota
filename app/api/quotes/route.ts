/**
 * Quotes API Route
 *
 * POST /api/quotes - Create a new quote with line items
 * GET /api/quotes - List user's quotes with filtering
 *
 * @module api/quotes
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api-validation";
import { z } from "zod";
import {
  createQuoteAtomic,
  getUserQuotes,
  getQuoteStats,
} from "@/lib/db/quotes";
import { TIER_LABEL } from "@/lib/subscription";
import { logger } from "@/lib/logger";

// =====================================================
// VALIDATION SCHEMAS
// =====================================================

/**
 * Schema for client info in quote creation
 */
const clientInfoSchema = z.object({
  name: z.string().min(1, "Client name is required").max(200),
  email: z.string().email("Invalid email format").optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  company: z.string().max(200).optional().or(z.literal("")),
  address: z.string().max(500).optional().or(z.literal("")),
  city: z.string().max(120).optional().or(z.literal("")),
  state: z.string().max(60).optional().or(z.literal("")),
  zipCode: z.string().max(20).optional().or(z.literal("")),
});

/**
 * Schema for line items in quote creation
 */
const lineItemSchema = z.object({
  description: z.string().min(1, "Description is required").max(500),
  quantity: z.number().positive("Quantity must be positive"),
  unitPrice: z.number().min(0, "Unit price cannot be negative"),
  unit: z.string().max(20).optional(),
  workItemId: z.string().uuid().optional(),
});

/**
 * Schema for POST request body
 */
const createQuoteSchema = z.object({
  clientId: z.string().uuid().optional(),
  clientInfo: clientInfoSchema,
  lineItems: z
    .array(lineItemSchema)
    .min(1, "At least one line item is required"),
  discount: z.number().min(0).optional().default(0),
  isDiscountPercentage: z.boolean().optional().default(false),
  notes: z.string().max(5000).optional(),
  transcript: z.string().max(50000).optional(),
  projectName: z.string().max(200).optional(),
});

/**
 * Schema for GET query parameters
 */
const listQuotesSchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
  search: z.string().optional(),
});

// =====================================================
// POST HANDLER - Create Quote
// =====================================================

export async function POST(request: NextRequest) {
  let userId: string | undefined;
  try {
    // 1. Authentication (auto-provisions user on first login)
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message: "Authentication required",
          code: "UNAUTHORIZED",
        },
        { status: 401 }
      );
    }
    userId = user.id;

    // 2. Parse and validate request body
    const parsed = await parseJsonBody(request, createQuoteSchema);
    if (parsed.response) return parsed.response;

    const data = parsed.data;

    // 3. Generate project name if not provided
    const projectName = data.projectName || `Quote for ${data.clientInfo.name}`;

    // 4. Resolve percentage discounts before entering the atomic DB operation.
    const subtotal = data.lineItems.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0
    );
    const discountAmount = data.isDiscountPercentage
      ? Math.round(subtotal * data.discount) / 100
      : data.discount;

    const result = await createQuoteAtomic(user.id, {
      clientId: data.clientId,
      clientInfo: data.clientInfo,
      projectName,
      discountAmount,
      notes: data.notes,
      internalNotes: data.transcript
        ? `Transcript:\n${data.transcript}`
        : undefined,
      lineItems: data.lineItems,
    });

    if (result.kind === "quotaExceeded") {
      return NextResponse.json(
        {
          success: false,
          code: "QUOTE_LIMIT",
          tier: result.tier,
          limit: result.limit,
          message: `You've used all ${result.limit} quotes this month on your ${TIER_LABEL[result.tier]} plan.`,
        },
        { status: 403 }
      );
    }

    const quote = result.quote;

    // 5. Log success
    logger.info("Quote created", { quoteId: quote.id, userId: user.id });

    // 6. Return success response
    return NextResponse.json(
      {
        success: true,
        id: quote.id,
        quoteNumber: quote.quote_number,
        message: "Quote created successfully",
      },
      { status: 201 }
    );
  } catch (error) {
    // Log the error for debugging
    logger.error("Quote creation error", {
      err: error,
      route: "POST /api/quotes",
      userId,
    });

    // Return generic error (don't expose internal details)
    return NextResponse.json(
      {
        success: false,
        message:
          "An error occurred while creating the quote. Please try again.",
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    );
  }
}

// =====================================================
// GET HANDLER - List Quotes
// =====================================================

export async function GET(request: NextRequest) {
  let userId: string | undefined;
  try {
    // 1. Authentication (auto-provisions user on first login)
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          message: "Authentication required",
          code: "UNAUTHORIZED",
        },
        { status: 401 }
      );
    }
    userId = user.id;

    // 3. Parse query parameters
    const { searchParams } = new URL(request.url);
    const queryParams = {
      limit: searchParams.get("limit") || undefined,
      offset: searchParams.get("offset") || undefined,
      search: searchParams.get("search") || undefined,
    };

    const validation = listQuotesSchema.safeParse(queryParams);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          message: "Invalid query parameters",
          code: "VALIDATION_ERROR",
        },
        { status: 400 }
      );
    }

    const filters = validation.data;

    // 4. Get quotes
    const result = await getUserQuotes(
      user.id,
      {
        search: filters.search,
      },
      {
        limit: filters.limit,
        offset: filters.offset,
      }
    );

    // 5. Get stats
    const stats = await getQuoteStats(user.id);

    // 6. Return response
    return NextResponse.json({
      success: true,
      data: result.data,
      pagination: {
        total: result.total,
        limit: result.limit,
        offset: result.offset,
        hasMore: result.hasMore,
      },
      stats,
    });
  } catch (error) {
    logger.error("Quote list error", {
      err: error,
      route: "GET /api/quotes",
      userId,
    });

    return NextResponse.json(
      {
        success: false,
        message: "An error occurred while fetching quotes.",
        code: "INTERNAL_ERROR",
      },
      { status: 500 }
    );
  }
}
