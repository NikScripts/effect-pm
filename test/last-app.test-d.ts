/**
 * Last.app / Last.router / Last.toProvider — type surface.
 */
import { Layer } from "effect";
import type * as React from "react";
import * as Last from "last-ts/Last";
import * as Route from "last-ts/Route";
import * as Router from "last-ts/Router";

const site = Route.make("site").add(Route.get("home", "/home"));
const memory = Router.unsafeService(site, "Memory");

const Provider = Last.app(Layer.empty).pipe(Last.router(memory)).Provider;
const _childrenOnly: (props: {
  readonly children: React.ReactNode;
}) => React.ReactElement = Provider;
void _childrenOnly;

const _oneShot: typeof Provider = Last.toProvider(Layer.empty, memory);
void _oneShot;

// @ts-expect-error Provider must not require runtime / value props
const _noRuntimeProp: (props: {
  readonly runtime: unknown;
}) => React.ReactElement = Provider;
void _noRuntimeProp;
