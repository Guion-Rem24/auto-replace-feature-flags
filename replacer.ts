// 修正済み tryEvaluateCondition を含むコード
import {
  Node,
  Project,
  SyntaxKind,
  VariableDeclaration,
  Expression,
  SourceFile,
  ts,
} from 'ts-morph';
import { Identifier, Statement, textChangeRangeIsUnchanged } from 'typescript';

type ValueMap = Record<string, boolean | string>;

export class BranchReplacer {
  constructor(
    private readonly project: Project,
    private readonly valueMap: ValueMap
  ) {}

  replaceUseValueBranchesWithKey(key: string): void {
    const declarations = this.project
      .getSourceFiles()
      .flatMap((file) => this.findUseValueDeclarations(key, file));

    for (const decl of declarations) {
      const varName = decl.getName();
      const expected = this.valueMap[key];

      const refs = decl.findReferences();
      const refNodes = refs
        .flatMap((ref) => ref.getReferences())
        .map((r) => r.getNode())
        .filter((node) => node.getParent() !== decl);

      for (const refNode of refNodes) {
        const { condition: evaluated, parent } = this.resolveCondition(
          refNode,
          varName,
          expected
        );
        if (evaluated === undefined) {
          console.warn(
            `Could not resolve condition for variable "${varName}" in file "${decl.getSourceFile().getBaseName()}".`
          );
          continue;
        }

        if (!parent) {
          continue;
        }

        if (Node.isIfStatement(parent)) {
          // const cond = parent.getExpression();
          // const evaluated = this.tryEvaluateCondition(cond, varName, expected);
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
          // const cond = parent.getCondition();
          // const evaluated = this.tryEvaluateCondition(cond, varName, expected);
          if (evaluated === true) {
            parent.replaceWithText(parent.getWhenTrue().getText());
          } else if (evaluated === false) {
            parent.replaceWithText(parent.getWhenFalse().getText());
          }
        } else if (Node.isBinaryExpression(parent)) {
          const op = parent.getOperatorToken().getKind();
          const [left, right] = [parent.getLeft(), parent.getRight()];
          const leftEval = this.tryEvaluateCondition(left, varName, expected);
          // const rightEval = this.tryEvaluateCondition(right, varName, expected);
          switch (op) {
            case SyntaxKind.AmpersandAmpersandToken:
              if (!!leftEval) {
                parent.replaceWithText(right.getText());
              } else {
                parent.replaceWithText('false');
                // this.trailBracket(parent);
              }
              break;
            case SyntaxKind.BarBarToken:
              if (!leftEval) {
                parent.replaceWithText(right.getText());
              } else {
                parent.replaceWithText('false');
                // this.trailBracket(parent);
              }
              break;
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

  trailBracket(node: Node<ts.Node>): void {
    if (node.wasForgotten()) return;
    const parent = node.getParent();
    if (!parent) return;
    if (Node.isParenthesizedExpression(parent)) {
      parent.replaceWithText('');
    }
  }

  findUseValueDeclarations(
    key: string,
    file: SourceFile
  ): VariableDeclaration[] {
    return file.getVariableDeclarations().filter((decl) => {
      const initializer = decl.getInitializer();
      if (!initializer || !Node.isCallExpression(initializer)) return false;

      const callExpr = initializer;
      const exprName = callExpr.getExpression().getText();
      if (exprName !== 'useValue') return false;

      const args = callExpr.getArguments();
      return (
        args.length === 1 && args[0].getText().replace(/['"]/g, '') === key
      );
    });
  }

  /**
   * 再帰的に親を探索して条件を評価
   */
  resolveCondition(
    node: Node<ts.Node>,
    varName: string,
    expected: string | boolean
  ): { condition: boolean | undefined; parent: Node<ts.Node> | undefined } {
    let parent = node.getParent();
    if (parent) {
      const condition = this.tryEvaluateCondition(node, varName, expected);
      // parent.condition is undefined, the node should be treated as Identifier
      if (
        condition !== undefined &&
        this.tryEvaluateCondition(parent, varName, condition) === undefined
      ) {
        return {
          condition,
          parent,
        };
      }
    }
    const tmp = this.tryEvaluateCondition(node, varName, expected);
    if (tmp === undefined) {
      return { condition: undefined, parent: node };
    }
    let condition: boolean = tmp;
    while (parent !== undefined) {
      const parentCondition = this.tryEvaluateCondition(
        parent,
        varName,
        expected
      );
      if (parentCondition === undefined) {
        break;
      }
      condition = parentCondition;
      parent = parent.getParent();
    }

    return { condition, parent };
    // if (!parent) {
    //   return condition;
    // }
    // if (
    //   Node.isBinaryExpression(parent) ||
    //   Node.isPrefixUnaryExpression(parent) ||
    //   Node.isIdentifier(parent)
    // ) {
    //   const condition = this.tryEvaluateCondition(parent, varName, expected);
    //   if (typeof condition === 'undefined') {
    //     return undefined; // 条件が評価できない場合は undefined を返す
    //   }
    //   // TODO: condition を渡すで合っているか確認
    //   const parentCondition = this.resolveCondition(parent, varName, condition);

    //   return parentCondition;
    // }
  }

  private getConstValue = (
    node: Expression
  ): string | number | boolean | undefined => {
    if (Node.isStringLiteral(node)) return node.getLiteralText();
    if (Node.isNumericLiteral(node)) return Number(node.getLiteralText());
    if (Node.isTrueLiteral(node)) return true;
    if (Node.isFalseLiteral(node)) return false;
    return undefined;
  };

  private tryEvaluateCondition(
    node: Node<ts.Node>,
    varName: string,
    expected: boolean | string
  ): boolean | undefined {
    if (Node.isBinaryExpression(node)) {
      const op = node.getOperatorToken().getKind();
      const [left, right] = [node.getLeft(), node.getRight()];

      const leftText = left.getText();
      const rightText = right.getText();
      const leftVal = this.getConstValue(left);
      const rightVal = this.getConstValue(right);

      switch (op) {
        case SyntaxKind.EqualsEqualsToken:
        case SyntaxKind.EqualsEqualsEqualsToken:
          if (leftText === varName && rightVal !== undefined)
            return expected === rightVal;
          if (rightText === varName && leftVal !== undefined)
            return expected === leftVal;
          break;
        case SyntaxKind.ExclamationEqualsToken:
        case SyntaxKind.ExclamationEqualsEqualsToken:
          if (leftText === varName && rightVal !== undefined)
            return expected !== rightVal;
          if (rightText === varName && leftVal !== undefined)
            return expected !== leftVal;
          break;
        // case SyntaxKind.AmpersandAmpersandToken:
        // case SyntaxKind.BarBarToken:
        //   const leftEval = this.tryEvaluateCondition(left, varName, expected);
        //   const rightEval = this.tryEvaluateCondition(right, varName, expected);
        //   if (leftEval === undefined || rightEval === undefined)
        //     return undefined;
        //   return op === SyntaxKind.AmpersandAmpersandToken
        //     ? leftEval && rightEval
        //     : leftEval || rightEval;
        default:
      }
    } else if (Node.isPrefixUnaryExpression(node)) {
      // if (!/* <- */ result)
      const operand = node.getOperand().getText();
      if (operand === varName) {
        return !expected;
      }
    } else if (Node.isIdentifier(node)) {
      // if (result)
      if (node.getText() === varName) return Boolean(expected);
    }
    return undefined;
  }
}
