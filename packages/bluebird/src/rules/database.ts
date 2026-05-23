import ts from 'typescript';
import type { RuleContext } from '../types.js';
import {
  getDecorators,
  getDecoratorName,
  getDecoratorCallArgs,
  getLine,
  getColumn,
  hasDecorator,
  findDecorator,
} from './ast-helpers.js';

/**
 * **Rule `missing-indexes`** (database / warning / heuristic)
 *
 * Flags TypeORM entity classes where columns used in query patterns
 * (foreign keys, frequently filtered columns) lack `@Index()` decorators.
 *
 * This is a heuristic check that flags:
 * - `@ManyToOne` / `@ManyToMany` relations without corresponding `@Index`
 * - Properties named with common filter patterns (e.g., `status`, `createdAt`)
 *   that lack indexes
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
/**
 * Property names referenced by entity-level @Index(['a','b']) decorators.
 */
function getClassLevelIndexedPropertyNames(classDecl: ts.ClassDeclaration): Set<string> {
  const names = new Set<string>();
  for (const dec of getDecorators(classDecl)) {
    if (getDecoratorName(dec) !== 'Index') continue;
    const args = getDecoratorCallArgs(dec);
    if (!args) continue;

    const collectFromArrayLiteral = (arr: ts.ArrayLiteralExpression) => {
      for (const el of arr.elements) {
        if (ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el)) {
          names.add(el.text);
        }
      }
    };

    if (args.length === 1 && ts.isArrayLiteralExpression(args[0])) {
      collectFromArrayLiteral(args[0]);
    } else if (args.length >= 2 && ts.isArrayLiteralExpression(args[1])) {
      collectFromArrayLiteral(args[1]);
    }
  }
  return names;
}

export function checkMissingIndexes(sf: ts.SourceFile, filePath: string, ctx: RuleContext): void {
  // ManyToMany uses a join table with FK indexes; only ManyToOne benefits from relation indexes here
  const RELATION_DECORATORS = new Set(['ManyToOne']);
  const INDEXABLE_PATTERNS =
    /^(status|state|type|kind|createdAt|updatedAt|deletedAt|isActive|isDeleted)$/;

  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;
    if (!hasDecorator(stmt, 'Entity')) continue;

    const className = stmt.name?.text ?? '<anonymous>';
    const isChildEntity = hasDecorator(stmt, 'ChildEntity');
    const classLevelIndexedProps = getClassLevelIndexedPropertyNames(stmt);

    for (const member of stmt.members) {
      if (!ts.isPropertyDeclaration(member)) continue;
      if (!ts.isIdentifier(member.name)) continue;

      const propName = member.name.text;
      const decorators = getDecorators(member);
      const decoratorNames = new Set(decorators.map(getDecoratorName).filter(Boolean));

      // @JoinColumn FK columns often match a composite / class-level @Index on the same entity
      const joinColDec = findDecorator(member, 'JoinColumn');
      let joinColumnDbName: string | undefined;
      if (joinColDec) {
        const jArgs = getDecoratorCallArgs(joinColDec);
        if (jArgs?.[0] && ts.isObjectLiteralExpression(jArgs[0])) {
          for (const prop of jArgs[0].properties) {
            if (!ts.isPropertyAssignment(prop)) continue;
            if (!ts.isIdentifier(prop.name) || prop.name.text !== 'name') continue;
            if (ts.isStringLiteral(prop.initializer)) {
              joinColumnDbName = prop.initializer.text;
            }
          }
        }
      }

      // Check for relation decorators without @Index
      const hasRelation = [...RELATION_DECORATORS].some((d) => decoratorNames.has(d));
      const hasIndex = decoratorNames.has('Index') || decoratorNames.has('PrimaryColumn');

      if (hasRelation && !hasIndex) {
        if (isChildEntity) {
          continue;
        }

        if (classLevelIndexedProps.has(propName)) {
          continue;
        }

        if (
          joinColumnDbName &&
          stmt.members.some((m) => {
            if (!ts.isPropertyDeclaration(m) || !ts.isIdentifier(m.name)) return false;
            if (m === member) return false;
            const colDec = findDecorator(m, 'Column');
            if (!colDec) return false;
            const cArgs = getDecoratorCallArgs(colDec);
            if (!cArgs?.[0]) return false;
            if (!ts.isObjectLiteralExpression(cArgs[0])) return false;
            for (const prop of cArgs[0].properties) {
              if (!ts.isPropertyAssignment(prop)) continue;
              if (!ts.isIdentifier(prop.name) || prop.name.text !== 'name') continue;
              if (
                ts.isStringLiteral(prop.initializer) &&
                prop.initializer.text === joinColumnDbName
              ) {
                const mDecs = getDecorators(m);
                if (mDecs.some((d) => getDecoratorName(d) === 'Index')) {
                  return true;
                }
              }
            }
            return false;
          })
        ) {
          continue;
        }

        ctx.report({
          filePath,
          message: `Relation property '${propName}' in '${className}' may benefit from an @Index() decorator`,
          line: getLine(sf, member),
          column: getColumn(sf, member),
        });
      }

      // Check for common filter columns without @Index
      if (INDEXABLE_PATTERNS.test(propName) && decoratorNames.has('Column') && !hasIndex) {
        ctx.report({
          filePath,
          message: `Column '${propName}' in '${className}' is commonly filtered — consider adding @Index()`,
          line: getLine(sf, member),
          column: getColumn(sf, member),
        });
      }
    }
  }
}

/**
 * **Rule `missing-migration`** (database / warning / heuristic)
 *
 * This rule flags when a project uses TypeORM entities with `synchronize: true`
 * which is dangerous in production as it auto-alters the database schema.
 *
 * Projects should use migrations instead of schema synchronization for
 * production deployments.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkMissingMigration(sf: ts.SourceFile, filePath: string, ctx: RuleContext): void {
  const text = sf.getFullText();

  // Look for TypeOrmModule configuration with synchronize: true
  if (!text.includes('TypeOrmModule') && !text.includes('DataSource')) return;

  // Search for synchronize: true pattern
  const syncPattern = /synchronize\s*:\s*true/g;
  let match: RegExpExecArray | null;

  while ((match = syncPattern.exec(text)) !== null) {
    const pos = match.index;
    const lineInfo = sf.getLineAndCharacterOfPosition(pos);

    ctx.report({
      filePath,
      message: 'synchronize: true is unsafe for production — use migrations instead',
      line: lineInfo.line + 1,
      column: lineInfo.character + 1,
    });
  }
}
