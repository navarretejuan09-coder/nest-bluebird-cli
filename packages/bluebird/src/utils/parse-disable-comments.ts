/**
 * Parser for inline disable comments in source files.
 *
 * Supports the following comment formats:
 * - `// bluebird-disable-next-line` - Disable all rules for the next line
 * - `// bluebird-disable-next-line rule-id` - Disable specific rule for next line
 * - `// bluebird-disable-next-line rule-id, rule-id` - Disable multiple rules
 * - `// bluebird-disable` - Disable all rules for rest of file
 * - `// bluebird-disable rule-id` - Disable specific rule for rest of file
 * - `// bluebird-enable` - Re-enable all rules
 * - `// bluebird-enable rule-id` - Re-enable specific rule
 *
 * Also supports block comments: \/\* bluebird-disable \*\/
 */

const DISABLE_NEXT_LINE_PATTERN = /\/[/*]\s*bluebird-disable-next-line(?:\s+(.+?))?\s*(?:\*\/)?$/;
const DISABLE_PATTERN = /\/[/*]\s*bluebird-disable(?:\s+(.+?))?\s*(?:\*\/)?$/;
const ENABLE_PATTERN = /\/[/*]\s*bluebird-enable(?:\s+(.+?))?\s*(?:\*\/)?$/;

export interface DisabledRange {
  /** Start line (1-indexed, inclusive) */
  startLine: number;
  /** End line (1-indexed, inclusive). undefined means rest of file */
  endLine?: number;
  /** Specific rule IDs, or empty array for all rules */
  rules: string[];
}

export interface ParsedDisableComments {
  /** Lines where specific rules are disabled */
  disabledLines: Map<number, Set<string>>;
  /** Ranges where rules are disabled */
  disabledRanges: DisabledRange[];
}

/**
 * Parse rule IDs from comment text.
 * Handles formats like: "rule-id", "rule-id, rule-id", "bluebird/rule-id"
 */
function parseRuleIds(text: string | undefined): string[] {
  if (!text || text.trim() === '') return [];

  return text
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => {
      // Normalize to full rule ID format
      if (id.startsWith('bluebird/')) return id;
      return `bluebird/${id}`;
    });
}

/**
 * Parse disable comments from source text.
 *
 * @param sourceText - The source file content
 * @returns Parsed disable information
 */
export function parseDisableComments(sourceText: string): ParsedDisableComments {
  const lines = sourceText.split('\n');
  const disabledLines = new Map<number, Set<string>>();
  const disabledRanges: DisabledRange[] = [];

  // Track currently active disable ranges
  const activeDisables = new Map<string, number>(); // rule -> startLine (empty string = all rules)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1; // 1-indexed

    // Check for disable-next-line
    const nextLineMatch = line.match(DISABLE_NEXT_LINE_PATTERN);
    if (nextLineMatch) {
      const rules = parseRuleIds(nextLineMatch[1]);
      const nextLine = lineNumber + 1;

      if (!disabledLines.has(nextLine)) {
        disabledLines.set(nextLine, new Set());
      }

      const disabled = disabledLines.get(nextLine)!;
      if (rules.length === 0) {
        // Disable all rules - use special marker
        disabled.add('*');
      } else {
        for (const rule of rules) {
          disabled.add(rule);
        }
      }
      continue;
    }

    // Check for enable (must check before disable to handle re-enables)
    const enableMatch = line.match(ENABLE_PATTERN);
    if (enableMatch) {
      const rules = parseRuleIds(enableMatch[1]);

      if (rules.length === 0) {
        // Enable all - close all active ranges
        for (const [rule, startLine] of activeDisables.entries()) {
          disabledRanges.push({
            startLine,
            endLine: lineNumber - 1,
            rules: rule === '' ? [] : [rule],
          });
        }
        activeDisables.clear();
      } else {
        // Enable specific rules
        for (const rule of rules) {
          const startLine = activeDisables.get(rule);
          if (startLine !== undefined) {
            disabledRanges.push({
              startLine,
              endLine: lineNumber - 1,
              rules: [rule],
            });
            activeDisables.delete(rule);
          }
        }
      }
      continue;
    }

    // Check for disable
    const disableMatch = line.match(DISABLE_PATTERN);
    if (disableMatch) {
      const rules = parseRuleIds(disableMatch[1]);

      if (rules.length === 0) {
        // Disable all rules
        if (!activeDisables.has('')) {
          activeDisables.set('', lineNumber + 1);
        }
      } else {
        // Disable specific rules
        for (const rule of rules) {
          if (!activeDisables.has(rule)) {
            activeDisables.set(rule, lineNumber + 1);
          }
        }
      }
    }
  }

  // Close any ranges that extend to end of file
  for (const [rule, startLine] of activeDisables.entries()) {
    disabledRanges.push({
      startLine,
      endLine: undefined, // Rest of file
      rules: rule === '' ? [] : [rule],
    });
  }

  return { disabledLines, disabledRanges };
}

/**
 * Check if a diagnostic should be suppressed based on disable comments.
 *
 * @param ruleId - The rule ID (e.g., "bluebird/no-god-controller")
 * @param line - The line number (1-indexed)
 * @param parsed - Parsed disable comments
 * @returns true if the diagnostic should be suppressed
 */
export function isDiagnosticSuppressed(
  ruleId: string,
  line: number | undefined,
  parsed: ParsedDisableComments
): boolean {
  if (line === undefined) return false;

  // Check line-specific disables
  const lineDisables = parsed.disabledLines.get(line);
  if (lineDisables) {
    if (lineDisables.has('*') || lineDisables.has(ruleId)) {
      return true;
    }
  }

  // Check range disables
  for (const range of parsed.disabledRanges) {
    const inRange =
      line >= range.startLine && (range.endLine === undefined || line <= range.endLine);

    if (inRange) {
      // Empty rules array means all rules are disabled
      if (range.rules.length === 0 || range.rules.includes(ruleId)) {
        return true;
      }
    }
  }

  return false;
}
