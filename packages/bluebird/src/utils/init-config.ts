import { writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import prompts from 'prompts';
import pc from 'picocolors';
import type { BluebirdConfig } from '../types.js';
import { discoverProject } from './discover-project.js';

const CONFIG_FILE = 'bluebird.config.json';

export interface InitOptions {
  cwd?: string;
  force?: boolean;
  /** Skip prompts and use defaults (non-interactive mode) */
  yes?: boolean;
  /** Enable heuristic rules in non-interactive mode */
  includeHeuristic?: boolean;
  /** Disable graph analysis in non-interactive mode */
  noGraphAnalysis?: boolean;
  /** Rules to ignore in non-interactive mode */
  ignoreRules?: string[];
  /** File patterns to ignore in non-interactive mode */
  ignoreFiles?: string[];
}

export interface InitResult {
  created: boolean;
  path: string;
  config: BluebirdConfig;
}

/**
 * Check if config file already exists
 */
async function configExists(cwd: string): Promise<boolean> {
  try {
    await access(join(cwd, CONFIG_FILE));
    return true;
  } catch {
    return false;
  }
}

/**
 * Interactive or non-interactive init command to generate a bluebird.config.json file.
 *
 * Use `--yes` for non-interactive mode with defaults.
 * Combine with other flags to customize:
 * - `--include-heuristic` to enable heuristic rules
 * - `--no-graph-analysis` to disable graph analysis
 * - `--ignore-rules <rules>` to ignore specific rules
 * - `--ignore-files <patterns>` to ignore file patterns
 */
export async function initConfig(options: InitOptions = {}): Promise<InitResult> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = join(cwd, CONFIG_FILE);
  const nonInteractive = options.yes ?? false;

  // Check if config already exists
  if (!options.force && (await configExists(cwd))) {
    console.log(pc.yellow(`Config file already exists at ${CONFIG_FILE}`));
    console.log(pc.dim('Use --force to overwrite'));
    return {
      created: false,
      path: configPath,
      config: {},
    };
  }

  let response: {
    includeHeuristic: boolean;
    graphAnalysis: boolean;
    ignoredRules: string[];
    ignoredFiles: string[];
  };

  if (nonInteractive) {
    // Non-interactive mode: use options or defaults
    response = {
      includeHeuristic: options.includeHeuristic ?? false,
      graphAnalysis: !(options.noGraphAnalysis ?? false),
      ignoredRules: options.ignoreRules ?? [],
      ignoredFiles: options.ignoreFiles ?? [],
    };
    console.log(pc.cyan('Creating bluebird.config.json with defaults...'));
  } else {
    // Interactive mode: prompt user
    console.log(pc.cyan('\nBluebird Configuration Setup\n'));

    // Discover project to provide smart defaults
    const project = await discoverProject(cwd);
    const hasSwagger = project.features.swagger;

    // Interactive prompts
    const promptResponse = await prompts(
      [
        {
          type: 'confirm',
          name: 'includeHeuristic',
          message: 'Include heuristic rules? (context-dependent, may have false positives)',
          initial: false,
        },
        {
          type: 'confirm',
          name: 'graphAnalysis',
          message: 'Enable graph analysis? (cross-file checks like circular dependencies)',
          initial: true,
        },
        {
          type: 'multiselect',
          name: 'ignoredRules',
          message: 'Select rules to ignore (if any):',
          choices: [
            { title: 'no-god-controller', value: 'bluebird/no-god-controller' },
            { title: 'no-god-service', value: 'bluebird/no-god-service' },
            {
              title: 'missing-swagger-decorators',
              value: 'bluebird/missing-swagger-decorators',
              disabled: !hasSwagger,
            },
            { title: 'no-sync-fs-operations', value: 'bluebird/no-sync-fs-operations' },
            { title: 'lifecycle-hook-interface', value: 'bluebird/lifecycle-hook-interface' },
          ],
          hint: '- Space to select, Enter to confirm',
        },
        {
          type: 'list',
          name: 'ignoredFiles',
          message:
            'File patterns to ignore (comma-separated, e.g. "src/legacy/**,src/generated/**"):',
          initial: '',
          separator: ',',
        },
      ],
      {
        onCancel: () => {
          console.log(pc.yellow('\nSetup cancelled'));
          process.exit(0);
        },
      }
    );

    response = {
      includeHeuristic: promptResponse.includeHeuristic ?? false,
      graphAnalysis: promptResponse.graphAnalysis ?? true,
      ignoredRules: promptResponse.ignoredRules ?? [],
      ignoredFiles: promptResponse.ignoredFiles ?? [],
    };
  }

  // Build config object
  const config: BluebirdConfig = {};

  if (response.includeHeuristic) {
    config.includeHeuristic = true;
  }

  if (!response.graphAnalysis) {
    config.graphAnalysis = false;
  }

  const ignoredRules = response.ignoredRules?.filter(Boolean) ?? [];
  const ignoredFiles = response.ignoredFiles?.filter(Boolean) ?? [];

  if (ignoredRules.length > 0 || ignoredFiles.length > 0) {
    config.ignore = {};
    if (ignoredRules.length > 0) {
      config.ignore.rules = ignoredRules;
    }
    if (ignoredFiles.length > 0) {
      config.ignore.files = ignoredFiles;
    }
  }

  // Write config file
  const content = JSON.stringify(config, null, 2) + '\n';
  await writeFile(configPath, content, 'utf-8');

  console.log(pc.green(`\nCreated ${CONFIG_FILE}`));
  console.log(pc.dim('\nYou can also add waivers for specific files:'));
  console.log(
    pc.dim(`
{
  "waivers": [
    {
      "rule": "bluebird/no-god-controller",
      "file": "src/legacy/old.controller.ts",
      "reason": "Legacy code, will be refactored in Q2"
    }
  ]
}
`)
  );

  return {
    created: true,
    path: configPath,
    config,
  };
}
