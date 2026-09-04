/**
 * Root site kit — nests region contexts (Views stay on region bags).
 */
import * as Last from "last-ts/Last";
import * as Footer from "../ui/Footer";
import * as LayoutGrid from "../ui/LayoutGrid";
import * as Main from "../ui/Main";
import * as NavBar from "../ui/NavBar";
import * as Sidebar from "../ui/Sidebar";
import * as Site from "../ui/Site";

export class SiteKit extends Last.context({
  Site: Site.SiteContext,
  NavBar: NavBar.NavBarContext,
  Sidebar: Sidebar.SidebarContext,
  Main: Main.MainContext,
  Footer: Footer.FooterContext,
  LayoutGrid: LayoutGrid.LayoutGridContext,
}) {}
