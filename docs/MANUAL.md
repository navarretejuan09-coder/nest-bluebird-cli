# Bluebird User Manual

> Static Analysis CLI for NestJS Projects

Bluebird is a purpose-built static analysis tool that catches issues generic linters miss: security vulnerabilities, architectural problems, performance blockers, and NestJS-specific mistakes.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Installation](#installation)
3. [Basic Usage](#basic-usage)
4. [Understanding the Output](#understanding-the-output)
5. [Configuration](#configuration)
6. [Working with Rules](#working-with-rules)
7. [Baseline Workflow](#baseline-workflow)
8. [CI/CD Integration](#cicd-integration)
9. [ESLint Plugin](#eslint-plugin)
10. [Command Reference](#command-reference)
11. [Rule Reference](#rule-reference)
12. [Troubleshooting](#troubleshooting)

---

## Quick Start

```bash
# Run analysis on your NestJS project
npx bluebird-nestjs

# That's it! Bluebird auto-detects your setup and runs 38 purpose-built rules.
```

---

## Installation

### Option 1: Install from GitHub (Recommended)

```bash
# Global installation
npm install -g github:endpointclosing/bluebird

# Then run from any NestJS project
bluebird
```

### Option 2: Project Dependency

```bash
npm install --save-dev github:endpointclosing/bluebird
npx bluebird
```

### Option 3: Clone and Link

```bash
git clone https://github.com/endpointclosing/bluebird.git
cd bluebird
pnpm install
pnpm build
npm link packages/bluebird

# Then run from any NestJS project
bluebird
```

### Requirements

- Node.js 20 or higher
- A NestJS project with TypeScript

---

## Basic Usage

### Analyze Your Project

```bash
# Run from your project root
bluebird

# Or specify a path
bluebird -p /path/to/your/project
```

### Common Options

```bash
# Show all diagnostics (not just summary)
bluebird --verbose

# Only check files changed from main branch
bluebird --diff main

# Output as JSON for scripting
bluebird --format json

# Output as SARIF for GitHub Code Scanning
bluebird --format sarif

# Include optional heuristic rules
bluebird --include-heuristic

# Just show the score
bluebird --score
```

---

## Understanding the Output

### Sample Output

```
🔍 Analyzing NestJS project...

  ✗ no-hardcoded-secrets (2 violations)
    src/auth/auth.service.ts:15:5
      Hardcoded secret in 'jwtSecret' — move to environment variables

  ✗ missing-injectable (1 violation)
    src/users/user.repository.ts:5:1
      Class 'UserRepository' looks like a provider but is missing @Injectable()

  ⚠ no-console-log (3 violations)
    src/app.service.ts:12:5
      'console.log' detected — use NestJS Logger service instead
    ... and 2 more

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Health Score: 87/100 (Great)
  ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  2 errors, 3 warnings
```

### Severity Levels

| Symbol | Severity | Meaning |
|--------|----------|---------|
| `✗` | Error | Must fix — security issues, correctness problems |
| `⚠` | Warning | Should fix — best practice violations |

### Health Score

| Score | Label | What It Means |
|-------|-------|---------------|
| 90-100 | Excellent | Production-ready, minimal issues |
| 75-89 | Great | Good health, minor improvements needed |
| 50-74 | Needs Work | Significant issues requiring attention |
| 0-49 | Critical | Major problems blocking production |

### Score Calculation

The score starts at 100 and decreases based on violations:

| Severity | Base Penalty | Per-Instance (up to 10) |
|----------|-------------|------------------------|
| Error | -1.5 | -0.15 each |
| Warning | -0.75 | -0.08 each |

---

## Configuration

### Creating a Config File

```bash
# Interactive mode
bluebird init

# Non-interactive mode
bluebird init --yes
```

This creates `bluebird.config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/endpointclosing/bluebird/main/packages/bluebird/bluebird.schema.json",
  "ignore": {
    "rules": [],
    "files": []
  },
  "lint": true,
  "deadCode": true,
  "graphAnalysis": true,
  "includeHeuristic": false
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ignore.rules` | `string[]` | `[]` | Rules to disable globally |
| `ignore.files` | `string[]` | `[]` | File patterns to skip (glob) |
| `lint` | `boolean` | `true` | Run file-level analysis |
| `deadCode` | `boolean` | `true` | Run dead code detection |
| `graphAnalysis` | `boolean` | `true` | Run cross-file analysis |
| `includeHeuristic` | `boolean` | `false` | Enable heuristic rules |
| `diff` | `string` | — | Only check changed files from branch |
| `waivers` | `Waiver[]` | `[]` | Per-file rule exemptions |

### Ignoring Rules Globally

```json
{
  "ignore": {
    "rules": [
      "bluebird/no-god-service",
      "bluebird/no-console-log"
    ]
  }
}
```

### Ignoring Files

```json
{
  "ignore": {
    "files": [
      "src/legacy/**",
      "src/generated/**",
      "**/*.generated.ts"
    ]
  }
}
```

### Waivers (Per-File Exemptions)

For intentional deviations that need documentation:

```json
{
  "waivers": [
    {
      "rule": "bluebird/no-console-log",
      "file": "src/main.ts",
      "reason": "Console logging required during bootstrap before Logger is available"
    },
    {
      "rule": "bluebird/no-inconsistent-http-status",
      "file": "src/controllers/legacy.controller.ts",
      "reason": "Legacy API contract requires 200 from DELETE endpoints"
    }
  ]
}
```

### Inline Disable Comments

Suppress rules directly in source code:

```typescript
// Disable for next line
// bluebird-disable-next-line no-hardcoded-secrets
const API_KEY = 'test-key-for-demo';

// Disable block
// bluebird-disable no-raw-sql
await db.query(trustedQuery);
// bluebird-enable

// Disable multiple rules
// bluebird-disable no-console-log, no-process-env-direct
console.log(process.env.DEBUG);
// bluebird-enable
```

---

## Working with Rules

### List All Rules

```bash
bluebird explain --list
```

### Get Rule Details

```bash
bluebird explain no-hardcoded-secrets
```

Output:
```
no-hardcoded-secrets

  Hardcoded secret or credential detected in source code

  Category:    security
  Severity:    error
  Confidence:  deterministic
  Pass:        eslint

  How to fix:
    Move secrets to environment variables and access via ConfigService.

  How to ignore:
    Config:  Add "bluebird/no-hardcoded-secrets" to ignore.rules
    Inline:  // bluebird-disable-next-line no-hardcoded-secrets
    Waiver:  Add a waiver entry with documented reason
```

### Filter by Category

```bash
bluebird explain --category security
bluebird explain --category architecture
bluebird explain --category correctness
```

### Rule Categories

| Category | Description |
|----------|-------------|
| `architecture` | DI patterns, module structure, code size |
| `security` | Secrets, validation, SQL injection |
| `correctness` | Missing decorators, lifecycle hooks |
| `api-design` | Swagger docs, HTTP semantics |
| `performance` | Blocking operations, caching |
| `database` | Indexes, migrations |
| `dead-code` | Unused files, exports, types |
| `graphql` | Resolver decorators |
| `microservices` | Message patterns |
| `websockets` | WebSocket decorators |

### Deterministic vs Heuristic Rules

**Deterministic (25 rules)**: Always accurate, enabled by default
- `no-hardcoded-secrets`
- `missing-injectable`
- `no-raw-sql`

**Heuristic (13 rules)**: Context-dependent, opt-in
- `missing-caching`
- `missing-rate-limiting`
- `no-n-plus-one`

Enable heuristic rules:
```bash
bluebird --include-heuristic
```

Or in config:
```json
{
  "includeHeuristic": true
}
```

---

## Baseline Workflow

Baseline lets you adopt Bluebird on existing projects without drowning in legacy issues.

### Step 1: Create Initial Baseline

```bash
bluebird --baseline
git add .bluebird-baseline.json
git commit -m "chore: add bluebird baseline"
```

### Step 2: Run in CI

Only new violations will fail the build:

```bash
bluebird --fail-on error
```

### Step 3: Fix Issues Over Time

```bash
# After fixing some issues, update the baseline
bluebird --update-baseline
git add .bluebird-baseline.json
git commit -m "chore: update bluebird baseline"
```

### How It Works

- Baseline stores: rule + file path + line number
- Matching diagnostics are excluded from output and score
- New violations (not in baseline) always surface
- Line number changes may cause baseline mismatches

---

## CI/CD Integration

### GitHub Actions

```yaml
name: Bluebird Analysis

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  bluebird:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm ci

      - name: Run Bluebird
        run: npx bluebird-nestjs --format sarif > bluebird.sarif
        continue-on-error: true

      - name: Upload SARIF
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: bluebird.sarif
```

### GitLab CI

```yaml
bluebird:
  stage: test
  image: node:20-alpine
  script:
    - npm ci
    - npx bluebird-nestjs --format json > bluebird.json
    - npx bluebird-nestjs --fail-on error
  artifacts:
    reports:
      codequality: bluebird.json
    paths:
      - bluebird.json
    when: always
```

### Diff Mode for PRs

Only analyze changed files for faster PR checks:

```bash
# Compare against main branch
bluebird --diff main

# Compare against specific commit
bluebird --diff HEAD~1
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | No errors (warnings allowed) |
| 1 | Errors found or score below threshold |

### Score Threshold

Fail if score drops below a threshold:

```bash
bluebird --fail-on-score 80
```

---

## ESLint Plugin

Get real-time feedback in your IDE.

### Setup

```bash
npm install --save-dev bluebird-nestjs
```

### Configure (eslint.config.js)

```javascript
import bluebird from 'bluebird-nestjs/eslint-plugin';

export default [
  {
    plugins: { bluebird },
    rules: {
      // Use recommended preset
      ...bluebird.configs.recommended.rules,

      // Or configure individually
      'bluebird/no-hardcoded-secrets': 'error',
      'bluebird/missing-injectable': 'error',
      'bluebird/no-console-log': 'warn',
    },
  },
];
```

### Available Rules

All file-level rules work in ESLint. Graph-level rules (`no-circular-dependency`, `no-duplicate-route`) require the CLI.

---

## Command Reference

### Main Command

```
bluebird [options]
```

| Option | Description |
|--------|-------------|
| `-V, --version` | Show version |
| `-v, --verbose` | Show all diagnostics |
| `-q, --quiet` | Suppress output, only set exit code |
| `-p, --project <path>` | Path to project (default: cwd) |
| `-s, --score` | Output only numeric score |
| `--diff <branch>` | Only check changed files |
| `--format <fmt>` | Output: `text`, `json`, `sarif` |
| `--fail-on <level>` | Exit threshold: `error`, `warning`, `none` |
| `--fail-on-score <n>` | Exit code 1 if score below n |
| `--no-lint` | Skip file-level analysis |
| `--no-dead-code` | Skip dead code analysis |
| `--no-graph-analysis` | Skip cross-file analysis |
| `--include-heuristic` | Enable heuristic rules |
| `--baseline` | Create baseline snapshot |
| `--update-baseline` | Update baseline after fixes |

### Init Command

```
bluebird init [options]
```

| Option | Description |
|--------|-------------|
| `-f, --force` | Overwrite existing config |
| `-y, --yes` | Non-interactive mode |
| `--heuristic` | Enable heuristic rules (with --yes) |
| `--skip-graph` | Disable graph analysis (with --yes) |
| `--ignore-rules <rules>` | Comma-separated rules to ignore |
| `--ignore-files <patterns>` | Comma-separated file patterns |

### Explain Command

```
bluebird explain [options] [rule]
```

| Option | Description |
|--------|-------------|
| `--list` | List all rules |
| `-c, --category <cat>` | Filter by category |

---

## Rule Reference

### Architecture Rules (4)

| Rule | Severity | Description |
|------|----------|-------------|
| `no-circular-dependency` | error | Circular module imports |
| `no-god-controller` | warning | Controller > 10 routes |
| `no-god-service` | warning | Service > 400 lines |
| `no-hardcoded-dependency` | error | `new Service()` instead of DI |

### Security Rules (9)

| Rule | Severity | Type | Description |
|------|----------|------|-------------|
| `no-hardcoded-secrets` | error | det | Hardcoded credentials |
| `no-raw-sql` | error | det | SQL injection risk |
| `missing-validation-pipe` | warning | det | No global ValidationPipe |
| `missing-class-validator` | warning | det | DTO without validation |
| `no-any-in-dto` | warning | det | DTO typed as `any` |
| `missing-csrf-protection` | warning | heur | No CSRF middleware |
| `missing-rate-limiting` | warning | heur | No throttling |
| `missing-global-guard` | warning | heur | No auth guard |
| `missing-helmet` | warning | heur | No security headers |

### Correctness Rules (10)

| Rule | Severity | Type | Description |
|------|----------|------|-------------|
| `missing-injectable` | error | det | Provider missing @Injectable |
| `no-duplicate-route` | error | det | Duplicate HTTP routes |
| `no-nested-controller-decorator` | error | det | @Controller on nested class |
| `lifecycle-hook-interface` | warning | det | Hook without interface |
| `no-constructor-side-effects` | warning | det | Side effects in constructor |
| `no-console-log` | warning | det | console.log instead of Logger |
| `no-process-env-direct` | warning | det | process.env instead of ConfigService |
| `missing-parse-pipe` | warning | det | Route param without pipe |
| `missing-exception-filter` | warning | heur | No global exception filter |
| `missing-config-validation` | warning | heur | ConfigModule without validation |

### API Design Rules (5)

| Rule | Severity | Type | Description |
|------|----------|------|-------------|
| `missing-swagger-decorators` | warning | det | Missing @ApiOperation/@ApiResponse |
| `no-entity-as-response` | warning | det | ORM entity returned directly |
| `no-generic-exception` | warning | det | Throwing Error instead of HttpException |
| `no-inconsistent-http-status` | warning | heur | Wrong HTTP status for method |
| `prefer-pagination` | warning | heur | List without pagination |

### Performance Rules (4)

| Rule | Severity | Type | Description |
|------|----------|------|-------------|
| `no-sync-fs-operations` | warning | det | Sync fs blocking event loop |
| `no-blocking-crypto` | warning | det | Blocking crypto operations |
| `missing-caching` | warning | heur | No caching strategy |
| `no-n-plus-one` | warning | heur | N+1 query pattern |

### Database Rules (2)

| Rule | Severity | Type | Description |
|------|----------|------|-------------|
| `missing-indexes` | warning | heur | Queries without indexes |
| `missing-migration` | warning | heur | Schema changes without migration |

### Feature-Gated Rules (3)

| Rule | Feature | Description |
|------|---------|-------------|
| `missing-resolver-decorator` | GraphQL | Resolver without @Query/@Mutation |
| `missing-message-pattern` | Microservices | Handler without @MessagePattern |
| `missing-websocket-decorator` | WebSockets | Gateway without @SubscribeMessage |

---

## Troubleshooting

### "Cannot find module" errors

Install project dependencies first:
```bash
npm install
```

### Rules not detecting features

Ensure NestJS packages are in `package.json`:
```json
{
  "dependencies": {
    "@nestjs/swagger": "^7.0.0"
  }
}
```

### Score seems too low

Check all violations:
```bash
bluebird --verbose
```

Common causes:
- Missing `@Injectable()` on services
- Direct `process.env` instead of ConfigService
- Missing validation decorators
- console.log instead of Logger

### Baseline not filtering

Regenerate if file paths changed:
```bash
bluebird --baseline
```

### Analysis is slow

```bash
# Skip dead-code analysis (biggest speedup)
bluebird --no-dead-code

# Only check changed files
bluebird --diff main
```

### Too many false positives

Use waivers with documented reasons:
```json
{
  "waivers": [
    {
      "rule": "bluebird/no-console-log",
      "file": "src/main.ts",
      "reason": "Needed before Logger is available"
    }
  ]
}
```

---

## Getting Help

- **Rule explanation**: `bluebird explain <rule-name>`
- **List all rules**: `bluebird explain --list`
- **Issues**: https://github.com/endpointclosing/bluebird/issues

---

## Version

This manual covers Bluebird v0.1.0 with 38 rules.

**Legend**: det = deterministic, heur = heuristic
