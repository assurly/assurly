export interface GitHubAutoFix {
  statement: string;
  description: string;
  title: string;
}

const POSTGRES_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
const ENVIRONMENT_VARIABLE = /^[A-Z_][A-Z0-9_]{0,127}$/;

function quotePostgresIdentifier(value: string): string {
  const segments = value.split('.');
  if (
    segments.length < 1 ||
    segments.length > 2 ||
    !segments.every((part) => POSTGRES_IDENTIFIER.test(part))
  ) {
    throw new Error('The finding contains an unsafe PostgreSQL identifier.');
  }
  return segments.map((part) => `"${part.replaceAll('"', '""')}"`).join('.');
}

export function buildGitHubAutoFix(filePath: string, message: string): GitHubAutoFix | null {
  const lowerPath = filePath.toLowerCase();
  const lowerMessage = message.toLowerCase();
  if (lowerPath.endsWith('.sql') && lowerMessage.includes('row-level security')) {
    const tableName =
      message.match(/table\s+'([^']+)'/i)?.[1] ?? message.match(/supabase table\s+'([^']+)'/i)?.[1];
    if (!tableName) throw new Error('The finding does not contain a PostgreSQL table name.');
    const quotedTableName = quotePostgresIdentifier(tableName);
    return {
      statement: `ALTER TABLE ${quotedTableName} ENABLE ROW LEVEL SECURITY;`,
      description: `Enable Row-Level Security (RLS) on table \`${tableName}\`.`,
      title: `security(rls): enable row level security on ${tableName}`,
    };
  }

  if (lowerPath.endsWith('.env.example') && lowerMessage.includes('environment variable')) {
    const variable = message.match(/variable\s+'process\.env\.([^']+)'/i)?.[1];
    if (!variable || !ENVIRONMENT_VARIABLE.test(variable)) {
      throw new Error('The finding contains an unsafe environment variable name.');
    }
    return {
      statement: `${variable}=`,
      description: `Document environment variable \`${variable}\` in \`.env.example\`.`,
      title: `docs(env): document variable ${variable} in .env.example`,
    };
  }

  return null;
}

export interface AutoFixFindingInput {
  file_path: string;
  message: string;
}

/** Combines multiple allowlisted fixes in the same file into one commit/PR. */
export function buildGitHubAutoFixBatch(
  findings: readonly AutoFixFindingInput[],
): GitHubAutoFix | null {
  if (findings.length === 0) return null;

  const filePath = findings[0]?.file_path;
  if (!filePath || !findings.every((finding) => finding.file_path === filePath)) return null;

  const statements: string[] = [];
  const tableNames: string[] = [];

  for (const finding of findings) {
    const fix = buildGitHubAutoFix(finding.file_path, finding.message);
    if (!fix) return null;
    if (statements.includes(fix.statement)) continue;
    statements.push(fix.statement);
    const tableName =
      finding.message.match(/table\s+'([^']+)'/i)?.[1] ??
      finding.message.match(/supabase table\s+'([^']+)'/i)?.[1];
    if (tableName) tableNames.push(tableName);
  }

  if (statements.length === 0) return null;

  if (statements.length === 1 && tableNames[0]) {
    return buildGitHubAutoFix(filePath, findings[0]?.message ?? '');
  }

  const tableList = tableNames.map((name) => `\`${name}\``).join(', ');
  return {
    statement: statements.join('\n'),
    description: `Enable Row-Level Security (RLS) on ${tableList}.`,
    title: `security(rls): enable row level security on ${tableNames.length} tables`,
  };
}

export function isAutoFixableFinding(finding: {
  severity: 'error' | 'warning';
  file_path: string;
  message: string;
}): boolean {
  if (finding.severity !== 'error') return false;
  const filePath = finding.file_path.toLowerCase();
  const message = finding.message.toLowerCase();
  const isSqlRls = filePath.endsWith('.sql') && message.includes('row-level security');
  const isEnvEx = filePath.endsWith('.env.example') && message.includes('environment variable');
  return isSqlRls || isEnvEx;
}
