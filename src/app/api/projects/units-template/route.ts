import { TEMPLATE_CSV } from "@/lib/projects/import";

// A starter price list with the columns the import recognises. The BOM lets Excel read it as UTF-8 (for Arabic).
export async function GET() {
  return new Response(`﻿${TEMPLATE_CSV}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="leadsprint-units-template.csv"',
    },
  });
}
