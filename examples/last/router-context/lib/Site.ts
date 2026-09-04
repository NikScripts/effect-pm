/**
 * @module examples/last/router-context/lib/Site
 *
 * Root kit — thin shared chrome (NavBar + Frame + copy).
 */
import * as Last from "last-ts/Last";
import * as Frame from "../ui/Frame";
import * as NavBar from "../ui/NavBar";
import * as SiteCopy from "./SiteCopy";

export class Site extends Last.context({
  NavBar: NavBar.NavBarContext,
  Frame: Frame.FrameContext,
  SiteCopy: SiteCopy.SiteCopy,
}) {}
