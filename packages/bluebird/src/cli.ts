#!/usr/bin/env node
import { Command, InvalidArgumentError, Option } from 'commander';
import { scan } from './scan.js';
import { watch } from './watch.js';
import { initConfig } from './utils/init-config.js';
import { diagnose } from './index.js';
import { saveBaseline, BASELINE_FILE } from './utils/baseline.js';
import { getVersion } from './utils/version.js';
import { getAllRules, getRuleById, getRulesByCategory } from './rules/index.js';
import type { FailOnThreshold, RuleCategory, LayersOutputFormat } from './types.js';
import pc from 'picocolors';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('bluebird')
    .description('Diagnose and improve NestJS project health')
    .version(getVersion());

  program
    .option('-v, --verbose', 'show all diagnostics')
    .option('-q, --quiet', 'suppress output, only set exit code')
    .option('-p, --project <path>', 'path to the NestJS project (default: cwd)')
    .option('-s, --score', 'output only the numeric health score')
    .option('--diff <branch>', 'only check files changed from branch')
    .addOption(
      new Option('--format <format>', 'output format')
        .choices(['text', 'json', 'sarif', 'html'])
        .default('text')
    )
    .addOption(
      new Option('--fail-on <threshold>', 'set exit-code threshold')
        .choices(['error', 'warning', 'none'])
        .default('error')
    )
    .option(
      '--fail-on-score <score>',
      'exit with code 1 when score is below this value (0-100)',
      (v) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 100) {
          throw new InvalidArgumentError('Must be an integer between 0 and 100.');
        }
        return n;
      }
    )
    .option('--no-lint', 'skip lint pass')
    .option('--no-dead-code', 'skip dead code pass')
    .option('--no-graph-analysis', 'skip graph analysis pass')
    .option('--include-heuristic', 'include heuristic rules')
    .option('--baseline', 'generate a baseline snapshot of current diagnostics')
    .option('--update-baseline', 'update the baseline snapshot after fixes')
    .option('-w, --watch', 'watch mode: re-run analysis on file changes')
    .option('--fast', 'run analysis passes in parallel for faster execution')
    .option(
      '--pass-timeout <ms>',
      'timeout in milliseconds for each analysis pass (default: 300000)',
      (v) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1000) {
          throw new InvalidArgumentError('Must be an integer >= 1000 ms.');
        }
        return n;
      }
    )
    .option('-o, --open', 'open HTML report in browser (use with --format html)')
    .option('--calibrate', 'cross-validate diagnostics and output calibration metadata')
    .action(async (opts) => {
      const cwd = opts.project ?? process.cwd();
      const createBaseline = opts.baseline || opts.updateBaseline;

      if (createBaseline) {
        const result = await diagnose({
          cwd,
          lint: opts.lint ?? true,
          deadCode: opts.deadCode ?? true,
          graphAnalysis: opts.graphAnalysis ?? true,
          includeHeuristic: opts.includeHeuristic ?? false,
          useBaseline: false,
        });
        const path = await saveBaseline(cwd, result.diagnostics);
        const count = result.diagnostics.length;
        console.log(`Saved ${count} diagnostic${count === 1 ? '' : 's'} to ${BASELINE_FILE}`);
        console.log(`Path: ${path}`);
        return;
      }

      const scanOptions = {
        cwd,
        verbose: opts.verbose ?? false,
        quiet: opts.quiet ?? false,
        scoreOnly: opts.score ?? false,
        diff: opts.diff,
        format: opts.format ?? 'text',
        failOn: opts.failOn as FailOnThreshold,
        scoreThreshold: opts.failOnScore,
        lint: opts.lint ?? true,
        deadCode: opts.deadCode ?? true,
        graphAnalysis: opts.graphAnalysis ?? true,
        includeHeuristic: opts.includeHeuristic ?? false,
        parallel: opts.fast ?? false,
        passTimeout: opts.passTimeout,
        open: opts.open ?? false,
        calibrate: opts.calibrate ?? false,
      };

      if (opts.watch) {
        await watch(scanOptions);
      } else {
        await scan(scanOptions);
      }
    });

  program
    .command('init')
    .description('Create a bluebird.config.json configuration file')
    .option('-f, --force', 'Overwrite existing config file')
    .option('-y, --yes', 'Skip prompts and use defaults (non-interactive mode)')
    .option('--heuristic', 'Enable heuristic rules in config (with --yes)')
    .option('--skip-graph', 'Disable graph analysis in config (with --yes)')
    .option('--ignore-rules <rules>', 'Comma-separated rules to ignore (with --yes)')
    .option('--ignore-files <patterns>', 'Comma-separated file patterns to ignore (with --yes)')
    .option('--cwd <path>', 'Working directory', process.cwd())
    .action(async (opts, cmd) => {
      // Warn if user passed top-level --include-heuristic instead of init's --heuristic
      const parentOpts = cmd.parent?.opts() ?? {};
      if (parentOpts.includeHeuristic && !opts.heuristic) {
        console.log(
          pc.yellow(
            'Warning: --include-heuristic is a top-level option. For init, use --heuristic instead.'
          )
        );
        console.log(pc.dim('Example: bluebird init --yes --heuristic\n'));
      }
      await initConfig({
        cwd: opts.cwd,
        force: opts.force ?? false,
        yes: opts.yes ?? false,
        includeHeuristic: opts.heuristic ?? false,
        noGraphAnalysis: opts.skipGraph ?? false,
        ignoreRules: opts.ignoreRules?.split(',').map((r: string) => r.trim()) ?? [],
        ignoreFiles: opts.ignoreFiles?.split(',').map((f: string) => f.trim()) ?? [],
      });
    });

  program
    .command('explain [rule]')
    .description('Show detailed information about a rule or list all rules')
    .option('-c, --category <category>', 'Filter rules by category')
    .option('--list', 'List all available rules')
    .action((ruleName?: string, opts?: { category?: string; list?: boolean }) => {
      const allRules = getAllRules();
      const categories: RuleCategory[] = [
        'architecture',
        'security',
        'correctness',
        'api-design',
        'performance',
        'database',
        'testing',
        'graphql',
        'microservices',
        'websockets',
      ];

      // List all rules
      if (opts?.list || (!ruleName && !opts?.category)) {
        console.log(pc.cyan('\nBluebird Rules\n'));
        console.log(pc.dim(`Total: ${allRules.length} rules\n`));

        for (const category of categories) {
          const categoryRules = getRulesByCategory(category);
          if (categoryRules.length === 0) continue;

          console.log(pc.bold(pc.yellow(`${category.toUpperCase()}`)));
          for (const rule of categoryRules) {
            const severityColor = rule.severity === 'error' ? pc.red : pc.yellow;
            const confidenceTag = rule.confidence === 'heuristic' ? pc.dim(' [heuristic]') : '';
            console.log(
              `  ${severityColor(rule.severity === 'error' ? '✖' : '⚠')} ${pc.bold(rule.id)}${confidenceTag}`
            );
            console.log(`    ${pc.dim(rule.description)}`);
          }
          console.log();
        }
        return;
      }

      // Filter by category
      if (opts?.category) {
        const categoryRules = getRulesByCategory(opts.category as RuleCategory);
        if (categoryRules.length === 0) {
          console.log(pc.yellow(`No rules found in category: ${opts.category}`));
          console.log(pc.dim(`Available categories: ${categories.join(', ')}`));
          return;
        }

        console.log(pc.cyan(`\nRules in category: ${opts.category}\n`));
        for (const rule of categoryRules) {
          const severityColor = rule.severity === 'error' ? pc.red : pc.yellow;
          console.log(
            `${severityColor(rule.severity === 'error' ? '✖' : '⚠')} ${pc.bold(rule.id)}`
          );
          console.log(`  ${rule.description}`);
          console.log(`  ${pc.dim(`Fix: ${rule.help}`)}\n`);
        }
        return;
      }

      // Explain specific rule
      if (ruleName) {
        // Support both "rule-name" and "bluebird/rule-name" formats
        const normalizedName = ruleName.replace(/^bluebird\//, '');
        const rule = getRuleById(normalizedName);

        if (!rule) {
          console.log(pc.red(`Rule not found: ${ruleName}`));
          console.log(pc.dim('\nUse "bluebird explain --list" to see all available rules.'));
          process.exitCode = 1;
          return;
        }

        const severityColor = rule.severity === 'error' ? pc.red : pc.yellow;
        const severityIcon = rule.severity === 'error' ? '✖' : '⚠';

        console.log(pc.cyan(`\n${pc.bold(rule.id)}\n`));
        console.log(`${pc.bold('Category:')}    ${rule.category}`);
        console.log(
          `${pc.bold('Severity:')}    ${severityColor(severityIcon + ' ' + rule.severity)}`
        );
        console.log(`${pc.bold('Confidence:')}  ${rule.confidence}`);
        console.log(`${pc.bold('Pass:')}        ${rule.analysisPass}`);
        console.log();
        console.log(`${pc.bold('Description:')}`);
        console.log(`  ${rule.description}`);
        console.log();
        console.log(`${pc.bold('How to fix:')}`);
        console.log(`  ${pc.green(rule.help)}`);
        console.log();

        if (rule.enabledWhen) {
          console.log(
            pc.dim('Note: This rule is conditionally enabled based on project features.')
          );
        }

        console.log(pc.dim('\nTo ignore this rule globally, add to bluebird.config.json:'));
        console.log(pc.dim(`  { "ignore": { "rules": ["bluebird/${rule.id}"] } }`));
        console.log();
        console.log(pc.dim('To ignore inline:'));
        console.log(pc.dim(`  // bluebird-disable-next-line ${rule.id}`));
        console.log();
      }
    });

  program
    .command('layers')
    .description('Analyze NestJS module dependency layers and detect violations')
    .option('-p, --project <path>', 'path to the NestJS project (default: cwd)')
    .addOption(
      new Option('--output <format>', 'output format')
        .choices(['text', 'json', 'mermaid'])
        .default('text')
    )
    .option('--detail', 'show detailed layer breakdown')
    .action(async (opts, cmd) => {
      const { analyseModuleLayers, loadSourceFilesForLayers } = await import('./utils/layers.js');
      const { formatLayers } = await import('./utils/format-layers.js');

      // Get project path from subcommand opts or parent opts (parent captures -p/--project)
      const parentOpts = cmd.parent?.opts() ?? {};
      const cwd = opts.project ?? parentOpts.project ?? process.cwd();
      const format = (opts.output ?? 'text') as LayersOutputFormat;
      const detail = opts.detail ?? false;

      try {
        const sourceFiles = await loadSourceFilesForLayers(cwd);
        const result = await analyseModuleLayers(sourceFiles);
        const output = formatLayers(result, format, detail);
        console.log(output);

        // Exit with code 1 if there are violations
        if (result.violations.length > 0) {
          process.exitCode = 1;
        }
      } catch (error) {
        console.error(pc.red('Error analyzing layers:'), error);
        process.exitCode = 1;
      }
    });

  program
    .command('mcp')
    .description('Start MCP server for AI agent integration')
    .action(async () => {
      const { startMcpServer } = await import('./mcp/index.js');
      await startMcpServer();
    });

  return program;
}

createProgram().parse();
