/**
 * @module examples/last/router-context/lib/DocsKit
 *
 * Docs group kit — heavy-ish UI stays off the root catalog scope.
 */
import * as Last from "last-ts/Last";
import * as DocsSidebar from "../ui/DocsSidebar";
import * as DocsCopy from "./DocsCopy";

export class DocsKit extends Last.context({
  Sidebar: DocsSidebar.DocsSidebarContext,
  DocsCopy: DocsCopy.DocsCopy,
}) {}
