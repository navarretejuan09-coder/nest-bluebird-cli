import type { Diagnostic, ScanResult, Severity } from '../types.js';
import { getVersion, getRepositoryUrl } from './version.js';

/**
 * SARIF 2.1.0 types — subset needed for output.
 * Full spec: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 */
interface SarifLog {
  $schema: string;
  version: '2.1.0';
  runs: SarifRun[];
}

interface SarifRun {
  tool: { driver: SarifDriver };
  results: SarifResult[];
  properties?: Record<string, unknown>;
}

interface SarifDriver {
  name: string;
  version: string;
  informationUri: string;
  rules: SarifRule[];
}

interface SarifRule {
  id: string;
  shortDescription: { text: string };
  helpUri?: string;
  properties?: Record<string, unknown>;
  defaultConfiguration?: { level: SarifLevel };
}

interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: SarifLevel;
  message: { text: string };
  locations?: SarifLocation[];
}

interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region?: { startLine: number; startColumn?: number };
  };
}

type SarifLevel = 'error' | 'warning' | 'note' | 'none';

function toSarifLevel(severity: Severity): SarifLevel {
  return severity === 'error' ? 'error' : 'warning';
}

function collectRules(diagnostics: Diagnostic[]): {
  rules: SarifRule[];
  ruleIndex: Map<string, number>;
} {
  const ruleIndex = new Map<string, number>();
  const rules: SarifRule[] = [];

  for (const d of diagnostics) {
    if (ruleIndex.has(d.rule)) continue;
    ruleIndex.set(d.rule, rules.length);
    const rule: SarifRule = {
      id: d.rule,
      shortDescription: { text: d.help ?? d.message },
      defaultConfiguration: { level: toSarifLevel(d.severity) },
      properties: { category: d.category, confidence: d.confidence },
    };
    rules.push(rule);
  }

  return { rules, ruleIndex };
}

export function formatSarif(result: ScanResult): string {
  const { rules, ruleIndex } = collectRules(result.diagnostics);

  const results: SarifResult[] = result.diagnostics.map((d) => {
    const entry: SarifResult = {
      ruleId: d.rule,
      ruleIndex: ruleIndex.get(d.rule)!,
      level: toSarifLevel(d.severity),
      message: { text: d.message },
    };

    if (d.filePath) {
      const uri = d.filePath.replaceAll('\\', '/');
      const location: SarifLocation = {
        physicalLocation: {
          artifactLocation: { uri },
        },
      };
      if (d.line != null && d.line > 0) {
        location.physicalLocation.region = {
          startLine: d.line,
          ...(d.column != null && d.column > 0 ? { startColumn: d.column } : {}),
        };
      }
      entry.locations = [location];
    }

    return entry;
  });

  const log: SarifLog = {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'bluebird',
            version: getVersion(),
            informationUri: getRepositoryUrl(),
            rules,
          },
        },
        results,
        properties: {
          score: result.score.score,
          label: result.score.label,
          baselinedCount: result.baselinedCount,
        },
      },
    ],
  };

  return JSON.stringify(log, null, 2);
}
