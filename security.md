# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### How to Report

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to: junavarrete@firstam.com

Alternatively, you can report via GitHub's private vulnerability reporting feature if available on this repository.

### What to Include

When reporting a vulnerability, please include:

- A description of the vulnerability
- Steps to reproduce the issue
- Potential impact of the vulnerability
- Any suggested fixes (optional)

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your report within 48 hours
- **Initial Assessment**: We will provide an initial assessment within 7 days
- **Updates**: We will keep you informed of our progress
- **Resolution**: We aim to resolve critical vulnerabilities within 30 days
- **Credit**: We will credit you in the release notes (unless you prefer to remain anonymous)

### Safe Harbor

We consider security research conducted in accordance with this policy to be:

- Authorized under applicable anti-hacking laws
- Exempt from restrictions in our terms of service
- Lawful, helpful to the overall security of the Internet, and conducted in good faith

We will not pursue legal action against researchers who:

- Act in good faith
- Avoid privacy violations
- Do not destroy data
- Do not disrupt our services

## Security Best Practices

When using Bluebird:

1. **Keep Bluebird updated** to receive the latest security fixes
2. **Review SARIF output** in CI pipelines for security-related rules
3. **Enable heuristic rules** for additional security checks:
   ```bash
   bluebird --include-heuristic
   ```
4. **Do not ignore security rules** without documented justification

## Security-Related Rules

Bluebird includes several security-focused rules:

- `no-hardcoded-secrets` - Detects hardcoded credentials
- `no-raw-sql` - Identifies SQL injection risks
- `missing-validation-pipe` - Ensures input validation
- `missing-class-validator` - Validates DTO properties
- `no-any-in-dto` - Prevents type-unsafe DTOs
- `missing-csrf-protection` - Checks CSRF middleware (heuristic)
- `missing-rate-limiting` - Checks rate limiting (heuristic)
- `missing-global-guard` - Checks authentication guards (heuristic)
- `missing-helmet` - Checks security headers (heuristic)

Thank you for helping keep Bluebird and its users safe!