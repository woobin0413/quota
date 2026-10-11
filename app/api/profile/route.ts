/**
 * Profile API Route
 *
 * GET   /api/profile - Current user's business profile
 * PATCH /api/profile - Update business profile (company info used in quote emails/PDFs)
 *
 * @module api/profile
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAdminEmail } from "@/lib/admin";
import { getCurrentUser } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api-validation";
import { updateUserProfile } from "@/lib/db/users";
import { NotFoundError } from "@/types/database";
import {
  hasNoNewlines,
  isValidPhone,
  isValidWebsite,
  NO_NEWLINES_ERROR,
  PHONE_ERROR,
  WEBSITE_ERROR,
} from "@/lib/profile-validation";
import { logger } from "@/lib/logger";

const updateProfileSchema = z.object({
  // All three can reach the From header: quote-pdf.ts resolves the display
  // name company_name || fullName || email, and fullName is first + last.
  firstName: z
    .string()
    .max(100)
    .refine(hasNoNewlines, NO_NEWLINES_ERROR)
    .nullable()
    .optional(),
  lastName: z
    .string()
    .max(100)
    .refine(hasNoNewlines, NO_NEWLINES_ERROR)
    .nullable()
    .optional(),
  companyName: z
    .string()
    .max(255)
    .refine(hasNoNewlines, NO_NEWLINES_ERROR)
    .nullable()
    .optional(),
  phone: z
    .string()
    .max(50)
    .refine(isValidPhone, PHONE_ERROR)
    .nullable()
    .optional(),
  companyAddress: z.string().max(500).nullable().optional(),
  companyWebsite: z
    .string()
    .max(255)
    .refine(isValidWebsite, WEBSITE_ERROR)
    .nullable()
    .optional(),
});

function toProfile(user: {
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  phone: string | null;
  metadata: Record<string, unknown> | null;
  email: string;
}) {
  return {
    firstName: user.first_name,
    lastName: user.last_name,
    companyName: user.company_name,
    phone: user.phone,
    companyAddress: (user.metadata?.companyAddress as string | undefined) ?? null,
    companyWebsite: (user.metadata?.companyWebsite as string | undefined) ?? null,
    logoUrl: (user.metadata?.logoUrl as string | undefined) ?? null,
    email: user.email,
  };
}

export async function GET() {
  let userId: string | undefined;
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { success: false, message: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }
    userId = user.id;

    return NextResponse.json({
      success: true,
      profile: toProfile(user),
      isAdmin: isAdminEmail(user.email),
    });
  } catch (error) {
    logger.error("Profile load error", { err: error, route: "GET /api/profile", userId });
    return NextResponse.json(
      { success: false, message: "Failed to load profile", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  let userId: string | undefined;
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { success: false, message: "Authentication required", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }
    userId = user.id;

    const parsed = await parseJsonBody(request, updateProfileSchema);
    if (parsed.response) return parsed.response;

    const updated = await updateUserProfile(user.id, parsed.data);

    return NextResponse.json({ success: true, profile: toProfile(updated) });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json(
        { success: false, message: error.message, code: "NOT_FOUND" },
        { status: 404 }
      );
    }
    logger.error("Profile update error", { err: error, route: "PATCH /api/profile", userId });
    return NextResponse.json(
      { success: false, message: "Failed to update profile", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
