import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { isFixable, applySingleFix, setupBackup } from './fixer';
import { Finding } from './types';

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

vi.mock('child_process', () => {
  return {
    execSync: vi.fn(),
  };
});

describe('CLI Auto-Fixer & Git Rollback Backup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isFixable', () => {
    it('returns true for undocumented environment variables', () => {
      const finding: Finding = {
        ruleId: 'env-vars-validator',
        severity: 'error',
        message:
          "Environment variable 'process.env.DB_URL' is used in code but not documented in '.env.example'",
      };
      expect(isFixable(finding)).toBe(true);
    });

    it('returns false for other findings', () => {
      const finding: Finding = {
        ruleId: 'supabase-security-checks',
        severity: 'error',
        message: 'RLS is disabled.',
      };
      expect(isFixable(finding)).toBe(false);
    });
  });

  describe('applySingleFix', () => {
    it('appends undocumented variable to .env.example', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('EXISTING_VAR=some_val\n');

      const finding: Finding = {
        ruleId: 'env-vars-validator',
        severity: 'error',
        message:
          "Environment variable 'process.env.NEW_SECRET_KEY' is used in code but not documented in '.env.example'",
      };

      const result = applySingleFix('.', finding);

      expect(result).toBe(true);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('.env.example'),
        'EXISTING_VAR=some_val\nNEW_SECRET_KEY=\n',
        'utf8',
      );
    });

    it('does not append if already present in .env.example', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('EXISTING_VAR=some_val\nNEW_SECRET_KEY=\n');

      const finding: Finding = {
        ruleId: 'env-vars-validator',
        severity: 'error',
        message:
          "Environment variable 'process.env.NEW_SECRET_KEY' is used in code but not documented in '.env.example'",
      };

      const result = applySingleFix('.', finding);

      expect(result).toBe(false);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('setupBackup', () => {
    it('returns none if not in a Git repository', () => {
      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd.toString().includes('rev-parse')) {
          throw new Error('Not a git repository');
        }
        return Buffer.from('');
      });

      const backup = setupBackup('.');
      expect(backup.type).toBe('none');
    });

    it('returns clean if Git repository has no dirty changes', () => {
      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd.toString().includes('rev-parse')) {
          return Buffer.from('true');
        }
        if (cmd.toString().includes('status')) {
          return Buffer.from(''); // empty means clean
        }
        return Buffer.from('');
      });

      const backup = setupBackup('.');
      expect(backup.type).toBe('clean');
    });

    it('creates a stash backup and returns stash reference if Git is dirty', () => {
      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd.toString().includes('rev-parse')) {
          return Buffer.from('true');
        }
        if (cmd.toString().includes('status')) {
          return Buffer.from('M packages/cli/src/fixer.ts'); // dirty
        }
        return Buffer.from('');
      });

      const backup = setupBackup('.');
      expect(backup.type).toBe('stash');
      expect(backup.reference).toContain('shipready-backup-');
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('git stash push'),
        expect.any(Object),
      );
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('git stash apply'),
        expect.any(Object),
      );
    });
  });
});
