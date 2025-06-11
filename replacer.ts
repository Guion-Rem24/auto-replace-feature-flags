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

type ValueMap = Record<string, boolean | string>;

export class BranchReplacer {
  private ReplacementNodeMap = new Map<
    Node<ts.Node>,
    { replacement: string; asCondition: boolean | 'unknown' }
  >();
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

      // AllowFunction or FunctionDeclaration
      for (const refNode of refNodes) {
        const { condition: evaluated, parent: refNodeParent } =
          this.resolveCondition(refNode, varName, expected);
        if (evaluated === undefined) {
          console.warn(
            `Could not resolve condition for variable "${varName}" in file "${decl.getSourceFile().getBaseName()}".`
          );
          continue;
        }

        if (!refNodeParent) {
          continue;
        }

        let parent = refNodeParent;
        let node = refNode;

        while (parent !== undefined) {
          if (this.ReplacementNodeMap.has(parent)) {
            // no longer to evaluate parent
            // when parent has already processed and the evaluation is uniquely determined
            break;
          }
          const evaluatedNode = this.ReplacementNodeMap.get(node);
          if (Node.isIfStatement(parent)) {
            if (
              evaluatedNode
                ? evaluatedNode.asCondition === true
                : evaluated === true
            ) {
              this.ReplacementNodeMap.set(parent, {
                replacement: parent.getThenStatement().getText(),
                asCondition: true,
              });
            } else if (
              evaluatedNode
                ? evaluatedNode.asCondition === false
                : evaluated === false
            ) {
              const elseStmt = parent.getElseStatement();
              if (elseStmt) {
                this.ReplacementNodeMap.set(parent, {
                  replacement: elseStmt.getText(),
                  asCondition: 'unknown', // CHECK: 本当か？
                });
              } else {
                this.ReplacementNodeMap.set(parent, {
                  replacement: '',
                  asCondition: false,
                });
              }
            }
          } else if (Node.isConditionalExpression(parent)) {
            // 三項演算子
            const cond = parent.getCondition();
            const evaluated = this.tryEvaluateCondition(
              cond,
              varName,
              expected
            );
            if (evaluated === true) {
              this.ReplacementNodeMap.set(parent, {
                replacement: parent.getWhenTrue().getText(),
                asCondition: true,
              });
            } else if (evaluated === false) {
              this.ReplacementNodeMap.set(parent, {
                replacement: parent.getWhenFalse().getText(),
                asCondition: false,
              });
            }
          } else if (Node.isBinaryExpression(parent)) {
            const op = parent.getOperatorToken().getKind();
            const [left, right] = [parent.getLeft(), parent.getRight()];

            const leftEval = this.ReplacementNodeMap.has(left)
              ? this.ReplacementNodeMap.get(left)!.asCondition
              : this.tryEvaluateCondition(left, varName, expected);
            const rightEval = this.ReplacementNodeMap.has(right)
              ? this.ReplacementNodeMap.get(right)!.asCondition
              : this.tryEvaluateCondition(right, varName, expected);
            switch (op) {
              case SyntaxKind.AmpersandAmpersandToken:
                if (!!leftEval) {
                  this.ReplacementNodeMap.set(parent, {
                    replacement: right.getText(),
                    asCondition:
                      typeof rightEval === 'undefined' ? 'unknown' : true, //' unknown' かどうかはrightEvalがundefinedかどうかによる
                  });
                } else {
                  this.ReplacementNodeMap.set(parent, {
                    replacement: 'false',
                    asCondition: false,
                  });
                }
                this.ReplacementNodeMap.delete(left);
                this.ReplacementNodeMap.delete(right);
                break;
              case SyntaxKind.BarBarToken:
                if (!leftEval) {
                  this.ReplacementNodeMap.set(parent, {
                    replacement: right.getText(),
                    asCondition:
                      typeof rightEval === 'undefined' ? 'unknown' : true,
                  });
                } else {
                  this.ReplacementNodeMap.set(parent, {
                    replacement:
                      this.ReplacementNodeMap.get(left)?.replacement ??
                      left.getText(),
                    asCondition: leftEval === 'unknown' ? 'unknown' : true,
                  });
                }
                this.ReplacementNodeMap.delete(left);
                this.ReplacementNodeMap.delete(right);
                break;
            }
          } else if (Node.isParenthesizedExpression(parent)) {
            // If the parent is a ParenthesizedExpression, we need to check its parent
            const grandParent = parent.getParent();
            if (grandParent) {
              parent
                .getChildren()
                .filter((node) => this.ReplacementNodeMap.has(node))
                .forEach((child) => {
                  this.ReplacementNodeMap.set(parent, {
                    ...this.ReplacementNodeMap.get(child)!,
                  });
                  this.ReplacementNodeMap.delete(child);
                });
              // CHECK: node = parent; はいらない？
              parent = grandParent;
              continue; // 再度親をチェック
            }
          } else {
            break;
          }

          if (parent.getParent() === undefined) {
            break;
          }
          node = parent;
          parent = parent.getParent()!;
        }
      }
    }
    this.ReplacementNodeMap.forEach((value, node) => {
      if (node.wasForgotten()) return;
      node.replaceWithText(value.replacement);
    });
    declarations.forEach((decl) => {
      // remove declaration if unused
      decl.remove();
      if (!decl.wasForgotten() && decl.findReferences().length === 0) {
        const statement = decl.getVariableStatement();
        if (statement) statement.remove();
      }
    });
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
    // this.trailBracketIfNeeded(node);
    while (parent !== undefined) {
      const parentCondition = this.tryEvaluateCondition(
        parent,
        varName,
        expected
      );
      if (parentCondition === undefined) {
        break;
      }
      // this.trailBracketIfNeeded(parent);
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

  private trailBracketIfNeeded(node: Node<ts.Node>): void {
    if (node.wasForgotten()) return;
    const parent = node.getParent();
    if (!parent) return;
    if (Node.isParenthesizedExpression(parent)) {
      // If the parent is a ParenthesizedExpression, remove it
      parent.replaceWithText(node.getText());
    }
  }
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
