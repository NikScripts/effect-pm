// URL-slug / data-file-key helpers — the canonical copy lives in the docgen (it owns the naming
// scheme); this re-export keeps gen-api (writer), gen-hovers, and api-data (reader) on that one copy.
export { slugForEntry, symbolFileKey } from "@nikscripts/docgen/Slug";
