import { describe, it, expect } from 'vitest';
import {
  parseDisableComments,
  isDiagnosticSuppressed,
} from '../src/utils/parse-disable-comments.js';

describe('parseDisableComments', () => {
  describe('disable-next-line', () => {
    it('should parse disable-next-line for all rules', () => {
      const source = `
// bluebird-disable-next-line
@Controller('users')
export class UsersController {}
`;
      const parsed = parseDisableComments(source);
      expect(parsed.disabledLines.get(3)?.has('*')).toBe(true);
    });

    it('should parse disable-next-line for specific rule', () => {
      const source = `
// bluebird-disable-next-line no-god-controller
@Controller('users')
export class UsersController {}
`;
      const parsed = parseDisableComments(source);
      expect(parsed.disabledLines.get(3)?.has('bluebird/no-god-controller')).toBe(true);
    });

    it('should parse disable-next-line for multiple rules', () => {
      const source = `
// bluebird-disable-next-line no-god-controller, no-hardcoded-secrets
@Controller('users')
export class UsersController {}
`;
      const parsed = parseDisableComments(source);
      const disabled = parsed.disabledLines.get(3);
      expect(disabled?.has('bluebird/no-god-controller')).toBe(true);
      expect(disabled?.has('bluebird/no-hardcoded-secrets')).toBe(true);
    });

    it('should handle full rule IDs with bluebird/ prefix', () => {
      const source = `
// bluebird-disable-next-line bluebird/no-god-controller
@Controller('users')
export class UsersController {}
`;
      const parsed = parseDisableComments(source);
      expect(parsed.disabledLines.get(3)?.has('bluebird/no-god-controller')).toBe(true);
    });

    it('should handle block comments', () => {
      const source = `
/* bluebird-disable-next-line no-god-controller */
@Controller('users')
export class UsersController {}
`;
      const parsed = parseDisableComments(source);
      expect(parsed.disabledLines.get(3)?.has('bluebird/no-god-controller')).toBe(true);
    });
  });

  describe('disable/enable ranges', () => {
    it('should parse disable for all rules to end of file', () => {
      const source = `
// bluebird-disable
@Controller('users')
export class UsersController {}
`;
      const parsed = parseDisableComments(source);
      expect(parsed.disabledRanges).toHaveLength(1);
      expect(parsed.disabledRanges[0].startLine).toBe(3);
      expect(parsed.disabledRanges[0].endLine).toBeUndefined();
      expect(parsed.disabledRanges[0].rules).toEqual([]);
    });

    it('should parse disable for specific rule', () => {
      const source = `
// bluebird-disable no-god-controller
@Controller('users')
export class UsersController {}
`;
      const parsed = parseDisableComments(source);
      expect(parsed.disabledRanges).toHaveLength(1);
      expect(parsed.disabledRanges[0].rules).toEqual(['bluebird/no-god-controller']);
    });

    it('should close range with enable', () => {
      const source = `
// bluebird-disable
@Controller('users')
export class UsersController {}
// bluebird-enable
@Controller('posts')
export class PostsController {}
`;
      const parsed = parseDisableComments(source);
      expect(parsed.disabledRanges).toHaveLength(1);
      expect(parsed.disabledRanges[0].startLine).toBe(3);
      expect(parsed.disabledRanges[0].endLine).toBe(4);
    });

    it('should handle enable for specific rule', () => {
      const source = `
// bluebird-disable no-god-controller
@Controller('users')
export class UsersController {}
// bluebird-enable no-god-controller
@Controller('posts')
export class PostsController {}
`;
      const parsed = parseDisableComments(source);
      expect(parsed.disabledRanges).toHaveLength(1);
      expect(parsed.disabledRanges[0].startLine).toBe(3);
      expect(parsed.disabledRanges[0].endLine).toBe(4);
      expect(parsed.disabledRanges[0].rules).toEqual(['bluebird/no-god-controller']);
    });
  });
});

describe('isDiagnosticSuppressed', () => {
  it('should return true for disabled line with wildcard', () => {
    const source = `
// bluebird-disable-next-line
@Controller('users')
`;
    const parsed = parseDisableComments(source);
    expect(isDiagnosticSuppressed('bluebird/no-god-controller', 3, parsed)).toBe(true);
    expect(isDiagnosticSuppressed('bluebird/any-rule', 3, parsed)).toBe(true);
  });

  it('should return true for disabled line with specific rule', () => {
    const source = `
// bluebird-disable-next-line no-god-controller
@Controller('users')
`;
    const parsed = parseDisableComments(source);
    expect(isDiagnosticSuppressed('bluebird/no-god-controller', 3, parsed)).toBe(true);
    expect(isDiagnosticSuppressed('bluebird/other-rule', 3, parsed)).toBe(false);
  });

  it('should return false for non-disabled line', () => {
    const source = `
// bluebird-disable-next-line no-god-controller
@Controller('users')
export class UsersController {}
`;
    const parsed = parseDisableComments(source);
    expect(isDiagnosticSuppressed('bluebird/no-god-controller', 4, parsed)).toBe(false);
  });

  it('should return true within disabled range', () => {
    const source = `
// bluebird-disable
@Controller('users')
export class UsersController {}
// bluebird-enable
@Controller('posts')
`;
    const parsed = parseDisableComments(source);
    expect(isDiagnosticSuppressed('bluebird/no-god-controller', 3, parsed)).toBe(true);
    expect(isDiagnosticSuppressed('bluebird/no-god-controller', 4, parsed)).toBe(true);
    expect(isDiagnosticSuppressed('bluebird/no-god-controller', 6, parsed)).toBe(false);
  });

  it('should return true within range for specific rule only', () => {
    const source = `
// bluebird-disable no-god-controller
@Controller('users')
export class UsersController {}
`;
    const parsed = parseDisableComments(source);
    expect(isDiagnosticSuppressed('bluebird/no-god-controller', 3, parsed)).toBe(true);
    expect(isDiagnosticSuppressed('bluebird/no-hardcoded-secrets', 3, parsed)).toBe(false);
  });

  it('should return false for undefined line', () => {
    const source = `// bluebird-disable-next-line`;
    const parsed = parseDisableComments(source);
    expect(isDiagnosticSuppressed('bluebird/no-god-controller', undefined, parsed)).toBe(false);
  });
});
