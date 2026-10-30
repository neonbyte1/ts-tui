/**
 * Checks that every public symbol of `@neonbyte/tui` is documented the way JSR
 * renders it and the Deno standard library requires it:
 *
 * - `deno doc --lint` passes: every exported symbol and public member has a
 *   JSDoc comment, explicit types, and no references to unexported types.
 * - Every entrypoint in the package's `exports` has a module doc with
 *   TypeScript examples.
 * - Every exported symbol has an `@category` from {@link CATEGORIES}, which
 *   groups the symbol list on jsr.io.
 * - Functions, public methods and constructors have an `@param` with a
 *   description for every parameter (and none for parameters that do not
 *   exist), `@typeParam` for every type parameter, and `@returns` when they
 *   return something.
 * - Exported functions and classes, and public methods users call, have a
 *   titled `@example` with a TypeScript snippet. The methods of the
 *   `Component` contract (`render`, `invalidate`, `handleInput`,
 *   `handleMouse`) are exempt: the TUI calls them, not users.
 * - Snippets assert their result with `@std/assert` unless marked
 *   `no-assert` (run but nothing to assert) or `ignore` (needs a real
 *   terminal). `deno test --doc` type-checks and runs every snippet not marked
 *   `ignore`.
 * - `@deprecated` tags say what to use instead.
 *
 * Usage: `deno run -A tools/check_docs.ts [path-filter...]`, e.g.
 * `tools/check_docs.ts src/components/box.ts` to report one file only.
 *
 * @module
 */

/** Allowed `@category` values, in the order jsr.io should list them. */
export const CATEGORIES: readonly string[] = [
  "Core",
  "Terminal",
  "Input",
  "Text",
  "Layout",
  "Controls",
  "Overlays",
  "Progress & status",
  "Images",
  "Styling",
  "Text utilities",
  "Testing",
  "Reactivity",
  "Composables",
  "JSX",
];

const PACKAGE_DIR = new URL("../", import.meta.url);
/** Every module the package exports, from the `exports` map of its `deno.json`. */
const ENTRYPOINTS: readonly URL[] = Object.values(
  JSON.parse(
    Deno.readTextFileSync(new URL("deno.json", PACKAGE_DIR)),
  ).exports as Record<string, string>,
).map((path) => new URL(path, PACKAGE_DIR));
const CONTRACT: Record<string, true> = {
  render: true,
  invalidate: true,
  handleInput: true,
  handleMouse: true,
};
const SNIPPET = /```ts([^\n]*)\n([\s\S]*?)```/g;
const ASSERTION_IMPORT =
  /from "@std\/(assert|expect|testing\/(mock|snapshot|types))(\/[a-z-]+)?"/;

interface Tag {
  readonly kind: string;
  readonly name?: string;
  readonly doc?: string;
}

interface JsDoc {
  readonly doc?: string;
  readonly tags?: readonly Tag[];
}

interface Location {
  readonly filename: string;
  readonly line: number;
}

interface TsType {
  readonly repr?: string;
  readonly kind?: string;
  readonly value?: unknown;
}

interface Param {
  readonly kind: string;
  readonly name?: string;
  readonly arg?: Param;
  readonly left?: Param;
}

interface FunctionDef {
  readonly params: readonly Param[];
  readonly typeParams?: readonly { readonly name: string }[];
  readonly returnType?: TsType;
  readonly hasBody?: boolean;
}

interface Method {
  readonly name: string;
  readonly kind: string;
  readonly accessibility?: string;
  readonly jsDoc?: JsDoc;
  readonly functionDef: FunctionDef;
  readonly location: Location;
}

interface Constructor {
  readonly accessibility?: string;
  readonly jsDoc?: JsDoc;
  readonly params: readonly Param[];
  readonly location: Location;
}

interface ClassDef {
  readonly typeParams?: readonly { readonly name: string }[];
  readonly methods?: readonly Method[];
  readonly constructors?: readonly Constructor[];
}

interface Declaration {
  readonly kind: string;
  readonly declarationKind: string;
  readonly jsDoc?: JsDoc;
  readonly location: Location;
  readonly def?: unknown;
}

interface DocSymbol {
  readonly name: string;
  readonly declarations: readonly Declaration[];
}

interface DocOutput {
  readonly nodes: Record<
    string,
    { readonly module_doc?: JsDoc; readonly symbols: readonly DocSymbol[] }
  >;
}

interface Problem {
  readonly at: Location;
  readonly symbol: string;
  readonly message: string;
}

const problems: Problem[] = [];

function report(at: Location, symbol: string, message: string): void {
  problems.push({ at, symbol, message });
}

function tags(jsDoc: JsDoc | undefined, kind: string): readonly Tag[] {
  return jsDoc?.tags?.filter((tag) => tag.kind === kind) ?? [];
}

function hasText(text: string | undefined): boolean {
  return text !== undefined && text.trim() !== "";
}

/** Name of a parameter as `@param` documents it, or undefined for destructured ones. */
function paramName(param: Param): string | undefined {
  if (param.kind === "identifier") {
    return param.name;
  }

  if (param.kind === "rest" && param.arg !== undefined) {
    return paramName(param.arg);
  }

  if (param.kind === "assign" && param.left !== undefined) {
    return paramName(param.left);
  }

  return undefined;
}

function returnsSomething(type: TsType | undefined): boolean {
  if (type === undefined) {
    return false;
  }

  const repr = type.repr ?? "";

  if (repr === "void" || repr === "never" || type.kind === "typePredicate") {
    return false;
  }

  if (repr !== "Promise" || type.kind !== "typeRef") {
    return true;
  }

  const value = type.value as { typeParams?: readonly TsType[] } | undefined;

  return value?.typeParams?.[0]?.repr !== "void";
}

function checkSnippets(doc: string, at: Location, symbol: string): void {
  const snippets = [...doc.matchAll(SNIPPET)];

  if (snippets.length === 0) {
    report(at, symbol, "example needs a ```ts code snippet");
  }

  for (const [, attributes, code] of snippets) {
    const exempt = attributes.includes("ignore") ||
      attributes.includes("no-assert");

    if (!exempt && !ASSERTION_IMPORT.test(code)) {
      report(
        at,
        symbol,
        "snippet must assert with @std/assert (or be marked `no-assert` / `ignore`)",
      );
    }
  }
}

function checkExamples(
  jsDoc: JsDoc | undefined,
  at: Location,
  symbol: string,
): void {
  const examples = tags(jsDoc, "example");

  if (examples.length === 0) {
    report(at, symbol, "needs an @example");
  }

  for (const example of examples) {
    const doc = example.doc ?? "";

    if (doc.trimStart().startsWith("```") || !hasText(doc.split("\n")[0])) {
      report(at, symbol, "@example needs a title on its first line");
    }

    checkSnippets(doc, at, symbol);
  }
}

function checkParams(
  params: readonly Param[],
  jsDoc: JsDoc | undefined,
  at: Location,
  symbol: string,
): void {
  const documented = tags(jsDoc, "param");
  const names = params.map(paramName);

  for (const name of names) {
    if (name === undefined) {
      continue;
    }

    const tag = documented.find((t) => t.name === name);

    if (tag === undefined) {
      report(at, symbol, `needs @param ${name}`);
    } else if (!hasText(tag.doc)) {
      report(at, symbol, `@param ${name} needs a description`);
    }
  }

  for (const tag of documented) {
    const name = tag.name ?? "";

    if (!name.includes(".") && !names.includes(name)) {
      report(at, symbol, `@param ${name} has no such parameter`);
    }
  }
}

function checkFunction(
  def: FunctionDef,
  jsDoc: JsDoc | undefined,
  at: Location,
  symbol: string,
  needsExample: boolean,
): void {
  checkParams(def.params, jsDoc, at, symbol);

  for (const typeParam of def.typeParams ?? []) {
    const tag = tags(jsDoc, "template").find((t) => t.name === typeParam.name);

    if (tag === undefined || !hasText(tag.doc)) {
      report(
        at,
        symbol,
        `needs @typeParam ${typeParam.name} with a description`,
      );
    }
  }

  if (returnsSomething(def.returnType)) {
    const returns = tags(jsDoc, "return");

    if (returns.length === 0 || !hasText(returns[0].doc)) {
      report(at, symbol, "needs @returns with a description");
    }
  }

  if (needsExample) {
    checkExamples(jsDoc, at, symbol);
  }
}

function checkClass(def: ClassDef, decl: Declaration, symbol: string): void {
  checkExamples(decl.jsDoc, decl.location, symbol);

  for (const typeParam of def.typeParams ?? []) {
    const tag = tags(decl.jsDoc, "template").find((t) =>
      t.name === typeParam.name
    );

    if (tag === undefined || !hasText(tag.doc)) {
      report(
        decl.location,
        symbol,
        `needs @typeParam ${typeParam.name} with a description`,
      );
    }
  }

  for (const ctor of def.constructors ?? []) {
    if (ctor.accessibility !== "private") {
      checkParams(
        ctor.params,
        ctor.jsDoc,
        ctor.location,
        `${symbol} constructor`,
      );
    }
  }

  for (const method of def.methods ?? []) {
    if (method.accessibility === "private" || method.kind !== "method") {
      continue;
    }

    checkFunction(
      method.functionDef,
      method.jsDoc,
      method.location,
      `${symbol}.${method.name}`,
      CONTRACT[method.name] !== true,
    );
  }
}

function checkDeclaration(symbol: DocSymbol, decl: Declaration): void {
  const categories = tags(decl.jsDoc, "category");

  if (
    categories.length !== 1 ||
    !CATEGORIES.includes((categories[0].doc ?? "").trim())
  ) {
    report(
      decl.location,
      symbol.name,
      `needs one @category of: ${CATEGORIES.join(", ")}`,
    );
  }

  for (const deprecated of tags(decl.jsDoc, "deprecated")) {
    if (!hasText(deprecated.doc)) {
      report(decl.location, symbol.name, "@deprecated needs a description");
    }
  }

  if (decl.kind === "function") {
    checkFunction(
      decl.def as FunctionDef,
      decl.jsDoc,
      decl.location,
      symbol.name,
      true,
    );
  } else if (decl.kind === "class") {
    checkClass(decl.def as ClassDef, decl, symbol.name);
  }
}

function checkSymbol(symbol: DocSymbol): void {
  const declarations = symbol.declarations.filter((decl) =>
    decl.declarationKind !== "private" && decl.kind !== "reference"
  );
  const overloads = declarations.length > 1 &&
    declarations.every((decl) => decl.kind === "function");

  for (const decl of declarations) {
    // The implementation signature of an overloaded function is not public.
    if (overloads && (decl.def as FunctionDef).hasBody === true) {
      continue;
    }

    checkDeclaration(symbol, decl);
  }
}

async function denoDoc(args: readonly string[]): Promise<Deno.CommandOutput> {
  return await new Deno.Command(Deno.execPath(), {
    args: ["doc", ...args, ...ENTRYPOINTS.map((url) => url.pathname)],
    cwd: PACKAGE_DIR.pathname,
    stdout: "piped",
    stderr: "piped",
  }).output();
}

function matchesFilter(filename: string, filters: readonly string[]): boolean {
  return filters.length === 0 ||
    filters.some((filter) => filename.includes(filter));
}

async function main(filters: readonly string[]): Promise<number> {
  const lint = await denoDoc(["--lint"]);
  const lintText = new TextDecoder().decode(lint.stderr);
  const lintErrors = lintText.split("\n\n").filter((block) =>
    block.includes("error[") && matchesFilter(block, filters)
  );

  for (const block of lintErrors) {
    console.error(block.trim() + "\n");
  }

  const json = await denoDoc(["--json"]);
  const output = JSON.parse(new TextDecoder().decode(json.stdout)) as DocOutput;

  for (const entrypoint of ENTRYPOINTS) {
    const entry = output.nodes[entrypoint.href];
    const moduleDoc = entry.module_doc?.doc ?? "";
    const moduleAt = { filename: entrypoint.href, line: 1 };
    const name = entrypoint.href.replace(PACKAGE_DIR.href, "");

    if (tags(entry.module_doc, "module").length === 0 || !hasText(moduleDoc)) {
      report(moduleAt, name, "needs a module doc (`@module`)");
    }

    checkSnippets(
      moduleDoc +
        tags(entry.module_doc, "example").map((t) => t.doc).join("\n"),
      moduleAt,
      name,
    );

    for (const symbol of entry.symbols) {
      checkSymbol(symbol);
    }
  }

  const shown = problems.filter((p) => matchesFilter(p.at.filename, filters));
  const root = PACKAGE_DIR.href;

  for (const problem of shown) {
    const file = problem.at.filename.replace(root, "");

    // `deno doc --json` locations are 0-based; editors and `deno doc --lint` count from 1.
    console.error(
      `${file}:${problem.at.line + 1}  ${problem.symbol}: ${problem.message}`,
    );
  }

  const total = lintErrors.length + shown.length;

  console.error(
    total === 0
      ? "docs: ok"
      : `docs: ${lintErrors.length} deno doc --lint errors, ${shown.length} problems`,
  );

  return total === 0 ? 0 : 1;
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
