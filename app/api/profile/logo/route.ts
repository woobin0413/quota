/**
 * Business Logo Route
 *
 * POST   /api/profile/logo - Upload/replace the business logo (multipart "file")
 * DELETE /api/profile/logo - Remove the logo
 *
 * Storage: public bucket "logos", one object per user at {userId}/logo.<ext>.
 * Validation is magic-byte based (PNG/JPG only, ≤2 MB); SVG and WebP rejected.
 *
 * @module api/profile/logo
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db/core";
import { updateUserLogoUrl } from "@/lib/db/users";
import { validateLogoUpload } from "@/lib/logo-validation";
import { logger } from "@/lib/logger";

const BUCKET = "logos";

// "webp" stays in the cleanup list even though uploads no longer accept it:
// it harmlessly removes any pre-existing logo.webp objects from before the drop.
const LOGO_EXTENSIONS = ["png", "jpg", "webp"] as const;

/** Remove every object under the user's folder (handles ext changes on re-upload). */
async function removeExistingLogos(userId: string): Promise<void> {
  const { data: objects, error: listError } = await supabaseAdmin.storage
    .from(BUCKET)
    .list(userId);
  if (listError) throw listError;
  if (objects?.length) {
    const { error: removeError } = await supabaseAdmin.storage
      .from(BUCKET)
      .remove(objects.map((o) => `${userId}/${o.name}`));
    // Surface the failure: otherwise DELETE claims success while the
    // object stays publicly reachable.
    if (removeError) throw removeError;
  }
}

/**
 * Remove stale logo objects of other extensions (e.g. a previous logo.png
 * when the new upload is logo.webp). Non-fatal: the DB (users.metadata.logoUrl)
 * is authoritative, so a leftover orphan object is harmless if this fails.
 */
async function removeStaleLogoVariants(
  userId: string,
  keepPath: string
): Promise<void> {
  const stalePaths = LOGO_EXTENSIONS.map((ext) => `${userId}/logo.${ext}`).filter(
    (p) => p !== keepPath
  );
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove(stalePaths);
  if (error) {
    logger.error("Logo stale-variant cleanup failed (non-fatal)", {
      err: error,
      route: "POST /api/profile/logo",
      userId,
    });
  }
}

export async function POST(request: NextRequest) {
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

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, message: "No file received", code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const validation = validateLogoUpload(buf);
    if (!validation.ok) {
      return NextResponse.json(
        { success: false, message: validation.message, code: "VALIDATION_ERROR" },
        { status: 400 }
      );
    }

    // Upload-first ordering: upsert to the new path BEFORE touching the DB or
    // removing anything else. If upload fails, the user's existing logo (at
    // whatever path it was) is untouched — failure here is fully benign. Only
    // after the DB is updated do we clean up stale same-user objects of OTHER
    // extensions; if that cleanup fails, we log and still return success,
    // since a leftover orphan object is harmless and the DB row is authoritative.
    const path = `${user.id}/logo.${validation.ext}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buf, { contentType: validation.contentType, upsert: true });
    if (uploadError) throw uploadError;

    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    // Cache-bust so emails/CDNs pick up replacements
    const logoUrl = `${pub.publicUrl}?v=${Date.now()}`;

    await updateUserLogoUrl(user.id, logoUrl);

    await removeStaleLogoVariants(user.id, path);

    return NextResponse.json({ success: true, logoUrl });
  } catch (error) {
    logger.error("Logo upload error", {
      err: error,
      route: "POST /api/profile/logo",
      userId,
    });
    return NextResponse.json(
      { success: false, message: "Failed to upload logo", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
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

    await removeExistingLogos(user.id);
    await updateUserLogoUrl(user.id, null);

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Logo delete error", {
      err: error,
      route: "DELETE /api/profile/logo",
      userId,
    });
    return NextResponse.json(
      { success: false, message: "Failed to remove logo", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
