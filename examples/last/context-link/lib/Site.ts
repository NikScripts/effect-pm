/**
 * @module examples/last/context-link/lib/Site
 *
 * Nest region contexts — Views stay on the region bag (`NavBar.View`), never
 * flattened onto `Site`.
 */
import * as Last from "last-ts/Last";
import * as NavBar from "../ui/NavBar";
import * as SiteCopy from "./SiteCopy";

export class Site extends Last.context({
  NavBar: NavBar.NavBarContext,
  SiteCopy: SiteCopy.SiteCopy,
}) {}
