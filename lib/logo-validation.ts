/**
 * Logo Upload Validation
 *
 * Pure validation for business-logo uploads: type by magic bytes
 * (never trust Content-Type or filename) and a size ceiling.
 * SVG is deliberately rejected — script-in-SVG XSS and no
 * @react-pdf/renderer support. WebP is rejected for the same PDF
 * reason: @react-pdf v4 cannot render it (silent branding gap).
 */

export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

export type LogoImageType = "png" | "jpeg";

const TYPE_INFO: Record<
  LogoImageType,
  { ext: "png" | "jpg"; contentType: string }
> = {
  png: { ext: "png", contentType: "image/png" },
  jpeg: { ext: "jpg", contentType: "image/jpeg" },
};

/**
 * Identify PNG/JPEG by file signature; null for anything else.
 * WebP is deliberately not accepted — @react-pdf/renderer v4 cannot
 * render it, which would silently drop the logo from PDFs.
 */
export function sniffImageType(buf: Buffer): LogoImageType | null {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return "jpeg";
  return null;
}

export type LogoValidation =
  | { ok: true; type: LogoImageType; ext: "png" | "jpg"; contentType: string }
  | { ok: false; message: string };

export function validateLogoUpload(buf: Buffer): LogoValidation {
  if (buf.length === 0) {
    return { ok: false, message: "No file received" };
  }
  if (buf.length > MAX_LOGO_BYTES) {
    return { ok: false, message: "Logo must be 2 MB or smaller" };
  }
  const type = sniffImageType(buf);
  if (!type) {
    return { ok: false, message: "Logo must be a PNG or JPG image" };
  }
  return { ok: true, type, ...TYPE_INFO[type] };
}
