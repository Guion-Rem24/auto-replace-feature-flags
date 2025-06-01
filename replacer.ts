// 修正済み tryEvaluateCondition を含むコード
import {
  Node,
  Project,
  SyntaxKind,
  VariableDeclaration,
  Expression,
  SourceFile,
} from "ts-morph";

type ValueMap = Record<string, boolean | string>;

export class BranchReplacer {
  constructor(
    private readonly project: Project,
    private readonly valueMap: ValueMap
  ) {}

  replaceUseValueBranchesWithKey(key: string): void {
    const declarations = this.project.getSourceFiles().flatMap(file => this.findUseValueDeclarations(key, file));

    for (const decl of declarations) {
      const varName = decl.getName();
      const expected = this.valueMap[key];

      const refs = decl.findReferences();
      const refNodes = refs.flatMap(ref =>
        ref.getReferences().map(r => r.getNode())
      );

      for (const refNode of refNodes) {
        const parent = refNode.getParent();

        if (Node.isIfStatement(parent)) {
          const cond = parent.getExpression();
          const evaluated = this.tryEvaluateCondition(cond, varName, expected);
          if (evaluated === true) {
            parent.replaceWithText(parent.getThenStatement().getText());
          } else if (evaluated === false) {
            const elseStmt = parent.getElseStatement();
            if (elseStmt) {
              parent.replaceWithText(elseStmt.getText());
            } else {
              parent.remove();
            }
          }
        } else if (Node.isConditionalExpression(parent)) {
          const cond = parent.getCondition();
          const evaluated = this.tryEvaluateCondition(cond, varName, expected);
          if (evaluated === true) {
            parent.replaceWithText(parent.getWhenTrue().getText());
          } else if (evaluated === false) {
            parent.replaceWithText(parent.getWhenFalse().getText());
          }
        }
      }

      // remove declaration if unused
      decl.remove();
      if (!decl.wasForgotten() && decl.findReferences().length === 0) {
        const statement = decl.getVariableStatement();
        if (statement) statement.remove();
      }
    }
  }

  findUseValueDeclarations(key: string, file: SourceFile): VariableDeclaration[] {
    return file.getVariableDeclarations().filter(decl => {
      const initializer = decl.getInitializer();
      if (!initializer || !Node.isCallExpression(initializer)) return false;

      const callExpr = initializer;
      const exprName = callExpr.getExpression().getText();
      if (exprName !== "useValue") return false;

      const args = callExpr.getArguments();
      return args.length === 1 && args[0].getText().replace(/['"]/g, "") === key;
    });
  }

  private tryEvaluateCondition(
    expr: Expression,
    varName: string,
    expected: boolean | string
  ): boolean | undefined {
    const getConstValue = (node: Expression): string | number | boolean | undefined => {
      if (Node.isStringLiteral(node)) return node.getLiteralText();
      if (Node.isNumericLiteral(node)) return Number(node.getLiteralText());
      if (Node.isTrueLiteral(node)) return true;
      if (Node.isFalseLiteral(node)) return false;
      return undefined;
    };

    if (Node.isBinaryExpression(expr)) {
      const op = expr.getOperatorToken().getText();
      const [left, right] = [expr.getLeft(), expr.getRight()];

      const leftText = left.getText();
      const rightText = right.getText();
      const leftVal = getConstValue(left);
      const rightVal = getConstValue(right);

      if (op === "===" || op === "==") {
        if (leftText === varName && rightVal !== undefined) return expected === rightVal;
        if (rightText === varName && leftVal !== undefined) return expected === leftVal;
      }
      if (op === "!==" || op === "!=") {
        if (leftText === varName && rightVal !== undefined) return expected !== rightVal;
        if (rightText === varName && leftVal !== undefined) return expected !== leftVal;
      }

      if (op === "&&" || op === "||") {
        const leftEval = this.tryEvaluateCondition(left, varName, expected);
        const rightEval = this.tryEvaluateCondition(right, varName, expected);
        if (leftEval === undefined || rightEval === undefined) return undefined;
        return op === "&&" ? leftEval && rightEval : leftEval || rightEval;
      }
    } else if (Node.isPrefixUnaryExpression(expr)) {
      const operand = expr.getOperand().getText();
      if (operand === varName) {
        return !expected;
      }
    } else if (Node.isIdentifier(expr)) {
      if (expr.getText() === varName) return Boolean(expected);
    }
    return undefined;
  }
}
