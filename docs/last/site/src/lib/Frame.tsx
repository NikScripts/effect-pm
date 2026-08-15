/**
 * Site frame — `Layout.make` body places {@link ./Tree} only (no HTML).
 */
import { Effect } from "effect";
import * as Document from "last-ts/Document";
import * as Layout from "last-ts/Layout";
import * as Page from "last-ts/Page";
import * as Tree from "./Tree";

/**
 * Product body layout — fulfill page groups with `Layout.provide(Frame.App)`.
 */
export class App extends Layout.make()(
  "last-ts/site/Frame",
  Effect.gen(function* () {
    yield* Page.document(
      Document.titleTransform((t: string) =>
        t === "last.ts" ? t : `${t} · last.ts`,
      ),
    );
    return (
      <Tree.Tree>
        <Layout.Outlet />
      </Tree.Tree>
    );
  }),
) {}
