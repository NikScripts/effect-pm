/**
 * Renders a type to LINKED display parts — the text the compiler would print, with every named
 * reference resolved to its doc page through the {@link LinkResolver}. `printType` synthesizes a
 * full-grammar `TypeNode` via `checker.typeToTypeNode` (the Phase 1 finding: every reference on it
 * resolves exactly, 20/20); the walker emits parts for the node kinds it knows and falls back to the
 * plain `ts.createPrinter` text for the rest — a missing link beats a wrong one, and the subset
 * expands as real hovers show need (D3).
 *
 * @since 1.0.0
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import ts from "typescript";
import * as LinkResolver from "./LinkResolver.js";
import * as TsProgram from "./TsProgram.js";

const TypeId = "~docgen/TypePrinter";

/**
 * One run of display text; `url` is the doc page the text references, when it references one.
 * Adjacent unlinked runs are merged, so a rendered type is a small list of parts.
 *
 * @category models
 * @since 1.0.0
 */
export interface Part {
  readonly text: string;
  readonly url: Option.Option<string>;
}

/**
 * Renders types to linked display parts.
 *
 * @category models
 * @since 1.0.0
 */
export interface TypePrinter {
  readonly [TypeId]: typeof TypeId;
  /**
   * Print a checker type as seen from `enclosing` (the declaration whose scope names the type —
   * alias names stay aliases). Falls back to the checker's plain string when the compiler cannot
   * synthesize a node for the type.
   */
  readonly printType: (type: ts.Type, enclosing: ts.Node) => ReadonlyArray<Part>;
  /** Print a type annotation node from PARSED source (a synthesized node belongs to `printType`). */
  readonly printNode: (node: ts.TypeNode) => ReadonlyArray<Part>;
}

/**
 * The `TypePrinter` service tag.
 *
 * @category tags
 * @since 1.0.0
 */
export const TypePrinter: Context.Service<TypePrinter, TypePrinter> =
  Context.Service("docgen/TypePrinter");

// Alias-preserving synthesis: keep named types (`Layer.Layer<…>`) instead of expanding their
// structure — the NodeBuilder twins of the Extractor's TypeFormatFlags.
const builderFlags =
  ts.NodeBuilderFlags.NoTruncation |
  ts.NodeBuilderFlags.UseAliasDefinedOutsideCurrentScope |
  ts.NodeBuilderFlags.UseSingleQuotesForStringLiteralType |
  ts.NodeBuilderFlags.WriteArrayAsGenericType |
  ts.NodeBuilderFlags.WriteTypeArgumentsOfSignature;

const formatFlags =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
  ts.TypeFormatFlags.WriteTypeArgumentsOfSignature |
  ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType |
  ts.TypeFormatFlags.WriteArrayAsGenericType;

// typeToString emits `import("/abs/path").Name` — strip the wrapper (as gen-api does).
const strip = (text: string): string => text.replace(/import\("[^"]*"\)\./g, "");

type Parts = ReadonlyArray<Part>;

const plain = (text: string): Part => ({
  text,
  url: Option.none(),
});

const joinParts = (lists: ReadonlyArray<Parts>, separator: string): Parts =>
  lists.flatMap((parts, index) => (index === 0 ? parts : [plain(separator), ...parts]));

// Merge adjacent unlinked runs (and drop empties) so consumers see `text·link·text`, not confetti.
const normalize = (parts: Parts): Parts => {
  const out: Array<Part> = [];
  for (const part of parts) {
    if (part.text === "") continue;
    const last = out[out.length - 1];
    if (last !== undefined && Option.isNone(last.url) && Option.isNone(part.url)) {
      out[out.length - 1] = plain(last.text + part.text);
    } else {
      out.push(part);
    }
  }
  return out;
};

const nameText = (name: ts.EntityName): string =>
  ts.isIdentifier(name) ? name.text : `${nameText(name.left)}.${name.right.text}`;

const operatorText = (operator: ts.TypeOperatorNode["operator"]): string => {
  switch (operator) {
    case ts.SyntaxKind.KeyOfKeyword:
      return "keyof ";
    case ts.SyntaxKind.ReadonlyKeyword:
      return "readonly ";
    case ts.SyntaxKind.UniqueKeyword:
      return "unique ";
  }
};

const isReadonly = (modifiers: ts.NodeArray<ts.ModifierLike> | undefined): boolean =>
  modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword) === true;

const isAbstract = (modifiers: ts.NodeArray<ts.ModifierLike> | undefined): boolean =>
  modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AbstractKeyword) === true;

// The recursive part emitter over one synthesized (or parsed) type node. Every helper closes over
// `walk`, so the whole family is built per call site pair (resolve, fallbackText). `onRef` is
// called once per named reference with whether it resolved — the home-retry's signal.
const makeWalk = (
  resolve: (node: ts.Node) => Option.Option<string>,
  fallbackText: (node: ts.Node) => string,
  onRef?: (linked: boolean) => void
): ((node: ts.TypeNode) => Parts) => {
  // Resolve the whole entity name; a qualified name (`Effect.Effect`) that doesn't resolve as a
  // unit still resolves at its rightmost identifier — the symbol the reference IS.
  const refPart = (name: ts.EntityName): Part => {
    const url = resolve(name).pipe(
      Option.orElse(() => (ts.isQualifiedName(name) ? resolve(name.right) : Option.none()))
    );
    onRef?.(Option.isSome(url));
    return {
      text: nameText(name),
      url,
    };
  };

  const propertyNameText = (name: ts.PropertyName): string =>
    ts.isIdentifier(name) || ts.isPrivateIdentifier(name) ? name.text : fallbackText(name);

  const typeArgumentsParts = (typeArguments: ts.NodeArray<ts.TypeNode> | undefined): Parts =>
    typeArguments === undefined || typeArguments.length === 0
      ? []
      : [plain("<"), ...joinParts(typeArguments.map(walk), ", "), plain(">")];

  const typeParameterParts = (typeParameter: ts.TypeParameterDeclaration): Parts => [
    plain(typeParameter.name.text),
    ...(typeParameter.constraint !== undefined
      ? [plain(" extends "), ...walk(typeParameter.constraint)]
      : []),
    ...(typeParameter.default !== undefined ? [plain(" = "), ...walk(typeParameter.default)] : []),
  ];

  const typeParametersParts = (
    typeParameters: ts.NodeArray<ts.TypeParameterDeclaration> | undefined
  ): Parts =>
    typeParameters === undefined || typeParameters.length === 0
      ? []
      : [plain("<"), ...joinParts(typeParameters.map(typeParameterParts), ", "), plain(">")];

  const parameterParts = (parameter: ts.ParameterDeclaration): Parts => [
    ...(parameter.dotDotDotToken !== undefined ? [plain("...")] : []),
    plain(ts.isIdentifier(parameter.name) ? parameter.name.text : fallbackText(parameter.name)),
    ...(parameter.questionToken !== undefined ? [plain("?")] : []),
    ...(parameter.type !== undefined ? [plain(": "), ...walk(parameter.type)] : []),
  ];

  const parameterListParts = (parameters: ts.NodeArray<ts.ParameterDeclaration>): Parts => [
    plain("("),
    ...joinParts(parameters.map(parameterParts), ", "),
    plain(")"),
  ];

  const memberParts = (member: ts.TypeElement): Parts => {
    if (ts.isPropertySignature(member) && member.type !== undefined) {
      return [
        ...(isReadonly(member.modifiers) ? [plain("readonly ")] : []),
        plain(propertyNameText(member.name)),
        ...(member.questionToken !== undefined ? [plain("?")] : []),
        plain(": "),
        ...walk(member.type),
      ];
    }
    if (ts.isMethodSignature(member) && member.type !== undefined) {
      return [
        plain(propertyNameText(member.name)),
        ...(member.questionToken !== undefined ? [plain("?")] : []),
        ...typeParametersParts(member.typeParameters),
        ...parameterListParts(member.parameters),
        plain(": "),
        ...walk(member.type),
      ];
    }
    if (ts.isCallSignatureDeclaration(member) && member.type !== undefined) {
      return [
        ...typeParametersParts(member.typeParameters),
        ...parameterListParts(member.parameters),
        plain(": "),
        ...walk(member.type),
      ];
    }
    if (ts.isConstructSignatureDeclaration(member) && member.type !== undefined) {
      return [
        plain("new "),
        ...typeParametersParts(member.typeParameters),
        ...parameterListParts(member.parameters),
        plain(": "),
        ...walk(member.type),
      ];
    }
    if (ts.isIndexSignatureDeclaration(member)) {
      return [
        ...(isReadonly(member.modifiers) ? [plain("readonly ")] : []),
        plain("["),
        ...joinParts(member.parameters.map(parameterParts), ", "),
        plain("]"),
        plain(": "),
        ...walk(member.type),
      ];
    }
    return [plain(fallbackText(member))];
  };

  const walk = (node: ts.TypeNode): Parts => {
    if (ts.isTypeReferenceNode(node)) {
      return [refPart(node.typeName), ...typeArgumentsParts(node.typeArguments)];
    }
    if (ts.isTypeQueryNode(node)) {
      return [plain("typeof "), refPart(node.exprName), ...typeArgumentsParts(node.typeArguments)];
    }
    // The builder names a symbol with no import in scope `import("/abs/path").Name` — the wrapper
    // is noise in display text (gen-api strips it), so print the qualified name alone.
    if (ts.isImportTypeNode(node) && node.qualifier !== undefined && !node.isTypeOf) {
      return [refPart(node.qualifier), ...typeArgumentsParts(node.typeArguments)];
    }
    if (ts.isUnionTypeNode(node)) return joinParts(node.types.map(walk), " | ");
    if (ts.isIntersectionTypeNode(node)) return joinParts(node.types.map(walk), " & ");
    if (ts.isArrayTypeNode(node)) return [...walk(node.elementType), plain("[]")];
    if (ts.isTupleTypeNode(node)) {
      return node.elements.length === 0
        ? [plain("[]")]
        : [plain("["), ...joinParts(node.elements.map(walk), ", "), plain("]")];
    }
    if (ts.isNamedTupleMember(node)) {
      return [
        ...(node.dotDotDotToken !== undefined ? [plain("...")] : []),
        plain(node.name.text),
        ...(node.questionToken !== undefined ? [plain("?")] : []),
        plain(": "),
        ...walk(node.type),
      ];
    }
    if (ts.isOptionalTypeNode(node)) return [...walk(node.type), plain("?")];
    if (ts.isRestTypeNode(node)) return [plain("..."), ...walk(node.type)];
    if (ts.isParenthesizedTypeNode(node)) return [plain("("), ...walk(node.type), plain(")")];
    if (ts.isTypeOperatorNode(node))
      return [plain(operatorText(node.operator)), ...walk(node.type)];
    if (ts.isIndexedAccessTypeNode(node)) {
      return [...walk(node.objectType), plain("["), ...walk(node.indexType), plain("]")];
    }
    if (ts.isConditionalTypeNode(node)) {
      return [
        ...walk(node.checkType),
        plain(" extends "),
        ...walk(node.extendsType),
        plain(" ? "),
        ...walk(node.trueType),
        plain(" : "),
        ...walk(node.falseType),
      ];
    }
    if (ts.isInferTypeNode(node)) {
      return [plain("infer "), ...typeParameterParts(node.typeParameter)];
    }
    if (ts.isFunctionTypeNode(node)) {
      return [
        ...typeParametersParts(node.typeParameters),
        ...parameterListParts(node.parameters),
        plain(" => "),
        ...walk(node.type),
      ];
    }
    if (ts.isConstructorTypeNode(node)) {
      return [
        ...(isAbstract(node.modifiers) ? [plain("abstract ")] : []),
        plain("new "),
        ...typeParametersParts(node.typeParameters),
        ...parameterListParts(node.parameters),
        plain(" => "),
        ...walk(node.type),
      ];
    }
    if (ts.isTypeLiteralNode(node)) {
      return node.members.length === 0
        ? [plain("{}")]
        : [plain("{ "), ...joinParts(node.members.map(memberParts), "; "), plain(" }")];
    }
    if (ts.isTemplateLiteralTypeNode(node)) {
      return [
        plain(`\`${node.head.text}`),
        ...node.templateSpans.flatMap((span) => [
          plain("${"),
          ...walk(span.type),
          plain(`}${span.literal.text}`),
        ]),
        plain("`"),
      ];
    }
    if (ts.isTypePredicateNode(node)) {
      return [
        ...(node.assertsModifier !== undefined ? [plain("asserts ")] : []),
        plain(ts.isIdentifier(node.parameterName) ? node.parameterName.text : "this"),
        ...(node.type !== undefined ? [plain(" is "), ...walk(node.type)] : []),
      ];
    }
    // Everything else (literals, keywords, mapped types, …) prints plainly — correct text, no
    // links inside; promote a kind above when its links start to matter.
    return [plain(fallbackText(node))];
  };

  return walk;
};

/**
 * A {@link TypePrinter} over the current {@link TsProgram} and {@link LinkResolver}.
 *
 * @category layers
 * @since 1.0.0
 */
export const layer: Layer.Layer<
  TypePrinter,
  never,
  TsProgram.TsProgram | LinkResolver.LinkResolver
> = Layer.effect(TypePrinter)(
  Effect.gen(function* () {
    const program = yield* TsProgram.TsProgram;
    const resolver = yield* LinkResolver.LinkResolver;
    const printer = ts.createPrinter({ removeComments: true });
    // `context` anchors the fallback printer (synthesized nodes have no source of their own).
    const partsOf = (node: ts.TypeNode, context: ts.SourceFile): ReadonlyArray<Part> =>
      normalize(
        makeWalk(resolver.resolve, (n) => printer.printNode(ts.EmitHint.Unspecified, n, context))(
          node
        )
      );
    // One print attempt at `enclosing`, with reference-resolution stats for the home-retry.
    interface Attempt {
      readonly parts: ReadonlyArray<Part>;
      readonly refs: number;
      readonly linked: number;
    }
    const attemptType = (type: ts.Type, enclosing: ts.Node): Attempt | undefined => {
      const node = program.checker.typeToTypeNode(type, enclosing, builderFlags);
      if (node === undefined) return undefined;
      let refs = 0;
      let linked = 0;
      const parts = normalize(
        makeWalk(
          resolver.resolve,
          (n) => printer.printNode(ts.EmitHint.Unspecified, n, enclosing.getSourceFile()),
          (ok) => {
            refs += 1;
            if (ok) linked += 1;
          }
        )(node)
      );
      return {
        parts,
        refs,
        linked,
      };
    };
    return {
      [TypeId]: TypeId,
      printType: (type, enclosing) => {
        const first = attemptType(type, enclosing);
        if (first === undefined) {
          return [plain(strip(program.checker.typeToString(type, enclosing, formatFlags)))];
        }
        if (first.linked === first.refs) return first.parts;
        // HOME RETRY: the node builder only attaches symbols to references whose names are in
        // scope at `enclosing` — a use site in another file misses most library-internal names.
        // Re-print from the type's own declaration (all its names are in scope there) and keep
        // whichever print PROVES more references; both prints are exact, so zero-guess holds.
        // Side effect when the retry wins: names print as the declaring module writes them.
        const home = (type.aliasSymbol ?? type.getSymbol())?.getDeclarations()?.[0];
        if (home === undefined || home === enclosing) return first.parts;
        const second = attemptType(type, home);
        return second !== undefined && second.linked > first.linked ? second.parts : first.parts;
      },
      printNode: (node) => partsOf(node, node.getSourceFile()),
    };
  })
);
