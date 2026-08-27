"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectSqlDialect = detectSqlDialect;
exports.isPostgresSqlSource = isPostgresSqlSource;
const CLICKHOUSE_ENGINE = /\bENGINE\s*=\s*(?:Replicated)?(?:Aggregating|Collapsing|Graphite|Replacing|Summing|VersionedCollapsing)?MergeTree\b|\bENGINE\s*=\s*(?:TinyLog|StripeLog|Log|Memory|Distributed)\b/i;
const CLICKHOUSE_TYPES = /\bLowCardinality\s*\(|\bDateTime64\s*\(|\bUInt(?:8|16|32|64)\b|\bNullable\s*\(/i;
const CLICKHOUSE_PARTITION = /\bPARTITION\s+BY\s+toYYYYMM\b/i;
const MYSQL_DUMP_HEADER = /(?:^|\n)\s*--[^\n]*(?:MySQL|MariaDB)\s+dump/i;
const MYSQL_ENGINE = /\bENGINE\s*=\s*(?:InnoDB|MyISAM|MEMORY|ARCHIVE|CSV)\b/i;
const MYSQL_AUTO_INCREMENT = /\bAUTO_INCREMENT\b/i;
const MYSQL_CHARSET = /\bDEFAULT\s+CHARSET\s*=|\bCOLLATE\s*=\s*utf8mb4_/i;
const MYSQL_DISPLAY_WIDTH = /\b(?:tinyint|smallint|mediumint|int|integer|bigint)\s*\(\s*\d+\s*\)/i;
const MSSQL_GO_BATCH = /(?:^|\n)\s*GO\s*(?:\r?\n|$)/i;
const MSSQL_BRACKETED_IDENT = /\[[^\]]+\]\s*\.\s*\[[^\]]+\]/;
const MSSQL_IDENTITY = /\bIDENTITY\s*\(\s*\d+\s*,\s*\d+\s*\)/i;
const MSSQL_TYPES = /\b(?:NVARCHAR|UNIQUEIDENTIFIER)\b/i;
const MSSQL_CREATE_BRACKET = /\bCREATE\s+TABLE\s+\[/i;
const POSTGRES_RULE_DIALECTS = ['postgres', 'unknown'];
const DOLLAR_QUOTE_TAG = /\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/y;
/**
 * Blanks out SQL comments and literal bodies. Not a SQL parser: it only has to
 * remove the regions where prose and data live, while keeping line breaks so
 * line-anchored signals (GO batches) still match.
 */
function stripCommentsAndLiterals(content) {
    let out = '';
    let index = 0;
    while (index < content.length) {
        const char = content[index];
        if (char === '-' && content[index + 1] === '-') {
            const lineEnd = content.indexOf('\n', index);
            if (lineEnd === -1)
                break;
            index = lineEnd;
            continue;
        }
        if (char === '/' && content[index + 1] === '*') {
            const blockEnd = content.indexOf('*/', index + 2);
            index = blockEnd === -1 ? content.length : blockEnd + 2;
            out += ' ';
            continue;
        }
        if (char === "'") {
            index += 1;
            while (index < content.length) {
                if (content[index] !== "'") {
                    index += 1;
                    continue;
                }
                if (content[index + 1] === "'") {
                    index += 2;
                    continue;
                }
                index += 1;
                break;
            }
            out += "''";
            continue;
        }
        if (char === '$') {
            DOLLAR_QUOTE_TAG.lastIndex = index;
            const tag = DOLLAR_QUOTE_TAG.exec(content);
            if (tag) {
                const bodyEnd = content.indexOf(tag[0], index + tag[0].length);
                index = bodyEnd === -1 ? content.length : bodyEnd + tag[0].length;
                out += ' ';
                continue;
            }
        }
        out += char;
        index += 1;
    }
    return out;
}
function normalizePath(file) {
    return file.replace(/\\/g, '/').toLowerCase();
}
function looksLikeClickHouse(input) {
    if (normalizePath(input.file).includes('clickhouse'))
        return true;
    return (CLICKHOUSE_ENGINE.test(input.code) ||
        CLICKHOUSE_TYPES.test(input.code) ||
        CLICKHOUSE_PARTITION.test(input.code));
}
function looksLikeMySQL(input) {
    return (
    // Intentionally raw: this is the mysqldump/Adminer banner, which only ever
    // appears as a comment. Stripping comments here would let Postgres RLS
    // rules run on MySQL dumps again. Do not "simplify" it onto `code`.
    MYSQL_DUMP_HEADER.test(input.raw) ||
        MYSQL_ENGINE.test(input.code) ||
        MYSQL_AUTO_INCREMENT.test(input.code) ||
        MYSQL_CHARSET.test(input.code) ||
        MYSQL_DISPLAY_WIDTH.test(input.code) ||
        (/\bcreate\s+table\b/i.test(input.code) && /`[^`]+`/.test(input.code)));
}
function looksLikeMSSQL(input) {
    return (MSSQL_GO_BATCH.test(input.code) ||
        MSSQL_BRACKETED_IDENT.test(input.code) ||
        MSSQL_IDENTITY.test(input.code) ||
        MSSQL_TYPES.test(input.code) ||
        MSSQL_CREATE_BRACKET.test(input.code));
}
function looksLikePostgres(input) {
    return (/supabase/i.test(input.file) ||
        /supabase/i.test(input.code) ||
        /auth\.uid\(\)/i.test(input.code) ||
        /auth\.users\b/i.test(input.code) ||
        /create\s+policy\b/i.test(input.code) ||
        /enable\s+row\s+level\s+security/i.test(input.code));
}
/**
 * Classifies a .sql file so Postgres-only rules (RLS, policies, NOT NULL
 * ALTER) do not fire on ClickHouse, MySQL, or MSSQL. Unknown stays on the
 * Postgres path — that is the historical default for `db/migrations/*.sql`.
 * ClickHouse is checked first so mixed ClickHouse/MySQL engine signals stay
 * ClickHouse.
 */
function detectSqlDialect(input) {
    const signals = {
        file: input.file,
        raw: input.content,
        code: stripCommentsAndLiterals(input.content),
    };
    if (looksLikeClickHouse(signals))
        return 'clickhouse';
    if (looksLikeMySQL(signals))
        return 'mysql';
    if (looksLikeMSSQL(signals))
        return 'mssql';
    if (looksLikePostgres(signals))
        return 'postgres';
    return 'unknown';
}
/** True when Postgres-flavoured SQL rules should run on this source. */
function isPostgresSqlSource(input) {
    return POSTGRES_RULE_DIALECTS.includes(detectSqlDialect(input));
}
