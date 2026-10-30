/**
 * Repo style rules, checked by `deno lint` and applied by `deno lint --fix`:
 *
 * - `flow/curly`: every `if`, `else` and loop body is a braced block.
 * - `flow/statement-padding`: statements are grouped by kind (imports,
 *   exports, declarations, assignments, other expressions such as calls,
 *   jumps such as `return`). A blank line separates neighbouring statements
 *   of different kinds, and block-like statements (`if`, loops, `switch`,
 *   `try`, functions, classes) are always set apart by blank lines.
 *
 * @module
 */

type Node = Deno.lint.Node;
type Kind =
  | "import"
  | "export"
  | "declaration"
  | "assignment"
  | "expression"
  | "jump"
  | "block";

/** Which padding group a statement belongs to. */
function kind(node: Node): Kind {
  switch (node.type) {
    case "ImportDeclaration":
      return "import";
    case "ExportAllDeclaration":
      return "export";
    case "ExportNamedDeclaration":
      return node.declaration ? kind(node.declaration) : "export";
    case "VariableDeclaration":
    case "TSTypeAliasDeclaration":
    case "TSDeclareFunction":
      return "declaration";
    case "ExpressionStatement": {
      const type = node.expression.type;

      return type === "AssignmentExpression" || type === "UpdateExpression"
        ? "assignment"
        : "expression";
    }
    case "ReturnStatement":
    case "ThrowStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return "jump";
    default:
      return "block";
  }
}

const BLANK_LINE = /\n[ \t]*\n/;

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

const statementPadding: Deno.lint.Rule = {
  create(ctx) {
    const source = ctx.sourceCode;
    const text = source.text;

    const check = (statements: readonly Node[]) => {
      for (let i = 1; i < statements.length; i++) {
        const prev = statements[i - 1];
        const next = statements[i];
        const prevKind = kind(prev);
        const nextKind = kind(next);
        const apart = prevKind !== nextKind || prevKind === "block";

        if (!apart) {
          continue;
        }

        const between = text.slice(prev.range[1], next.range[0]);

        if (BLANK_LINE.test(between)) {
          continue;
        }

        // The blank line goes above any comments that lead into `next`, but
        // below a comment trailing on the same line as `prev`.
        const prevLineEnd = text.indexOf("\n", prev.range[1]);
        const leading = source.getCommentsBefore(next).find((comment) =>
          prevLineEnd !== -1 && comment.range[0] > prevLineEnd
        );
        const target = leading?.range[0] ?? next.range[0];
        const onNewLine = prevLineEnd !== -1 && prevLineEnd < target;

        ctx.report({
          node: next,
          message:
            `Separate this ${nextKind} from the ${prevKind} above with a blank line.`,
          fix: (fixer) => {
            if (!onNewLine) {
              return fixer.insertTextBeforeRange([target, target], "\n\n");
            }

            const start = lineStart(text, target);

            return fixer.insertTextBeforeRange([start, start], "\n");
          },
        });
      }
    };

    return {
      Program: (node) => check(node.body),
      BlockStatement: (node) => check(node.body),
      StaticBlock: (node) => check(node.body),
      SwitchCase: (node) => check(node.consequent),
      TSModuleBlock: (node) => check(node.body),
    };
  },
};

const curly: Deno.lint.Rule = {
  create(ctx) {
    const requireBlock = (body: Node) => {
      if (body.type === "BlockStatement") {
        return;
      }

      ctx.report({
        node: body,
        message: "Wrap this body in braces.",
        fix: (fixer) =>
          fixer.replaceText(body, `{\n${ctx.sourceCode.getText(body)}\n}`),
      });
    };

    return {
      IfStatement(node) {
        requireBlock(node.consequent);

        if (node.alternate && node.alternate.type !== "IfStatement") {
          requireBlock(node.alternate);
        }
      },
      ForStatement: (node) => requireBlock(node.body),
      ForInStatement: (node) => requireBlock(node.body),
      ForOfStatement: (node) => requireBlock(node.body),
      WhileStatement: (node) => requireBlock(node.body),
      DoWhileStatement: (node) => requireBlock(node.body),
    };
  },
};

export default {
  name: "flow",
  rules: {
    curly,
    "statement-padding": statementPadding,
  },
} satisfies Deno.lint.Plugin;
