import { crossSiteError, jsonError } from "@/lib/http";
import { getOrg } from "@/lib/org";
import { buildPreview, NO_HEADER } from "@/lib/projects/import";
import { PROJECT_NOT_FOUND } from "@/lib/projects/inputs";
import { findProject, getExistingUnits } from "@/lib/projects/queries";
import { readSheets, SheetError, sheetKind, UNSUPPORTED_SHEET } from "@/lib/projects/sheet";

const MAX_BYTES = 5 * 1024 * 1024;
const TOO_LARGE = "Price lists can be up to 5 MB. Remove pictures or extra sheets and try again.";
// Room for the form fields and boundaries around the file itself.
const FORM_OVERHEAD_BYTES = 64 * 1024;

// Reads an uploaded price list and says what importing it would do. Nothing is saved here;
// the page sends the rows back to /units/import once the admin agrees.
export async function POST(req: Request, ctx: RouteContext<"/api/projects/[id]/units/preview">) {
  const blocked = crossSiteError(req);
  if (blocked) return blocked;
  const { id } = await ctx.params;

  const length = req.headers.get("content-length");
  if (length === null) return jsonError("Send the upload with its size (a Content-Length header).", 411);
  if (Number(length) > MAX_BYTES + FORM_OVERHEAD_BYTES) return jsonError(TOO_LARGE, 413);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError("Send the price list as a form upload.");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return jsonError("Choose a CSV or Excel file to upload.");
  if (!sheetKind(file.name)) return jsonError(UNSUPPORTED_SHEET);
  if (file.size > MAX_BYTES) return jsonError(TOO_LARGE, 413);

  const org = await getOrg();
  if (!(await findProject(org.id, id))) return jsonError(PROJECT_NOT_FOUND, 404);

  try {
    const sheets = await readSheets(Buffer.from(await file.arrayBuffer()), file.name);
    const preview = buildPreview(file.name, sheets, await getExistingUnits(org.id, id));
    return Response.json({ preview });
  } catch (err) {
    if (err instanceof SheetError) return jsonError(err.message);
    if (err instanceof Error && err.message === NO_HEADER) return jsonError(NO_HEADER);
    throw err;
  }
}
