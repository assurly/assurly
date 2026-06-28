import * as fs from 'fs';
import { randomUUID } from 'crypto';

export interface AnnotationProperties {
  title?: string;
  file?: string;
  startLine?: number;
}

const escapeData = (value: string): string =>
  value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (value: string): string =>
  escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');

function command(name: string, message: string, properties: AnnotationProperties = {}): void {
  const metadata = Object.entries(properties)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${escapeProperty(String(value))}`)
    .join(',');
  process.stdout.write(`::${name}${metadata ? ` ${metadata}` : ''}::${escapeData(message)}\n`);
}

export function getInput(name: string): string {
  return process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`]?.trim() ?? '';
}

export function info(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function warning(message: string, properties?: AnnotationProperties): void {
  command('warning', message, properties);
}

export function error(message: string, properties?: AnnotationProperties): void {
  command('error', message, properties);
}

export function setFailed(message: string): void {
  error(message);
  process.exitCode = 1;
}

export function setOutput(name: string, value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) throw new Error('Invalid output name.');
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    const delimiter = `shipready_${randomUUID()}`;
    fs.appendFileSync(outputFile, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, 'utf8');
  } else {
    process.stdout.write(`::set-output name=${escapeProperty(name)}::${escapeData(value)}\n`);
  }
}

class Summary {
  private value = '';

  addHeading(text: string, level = 1): this {
    this.value += `${'#'.repeat(level)} ${text}\n\n`;
    return this;
  }

  addRaw(text: string): this {
    this.value += text;
    return this;
  }

  addTable(rows: Array<Array<string | { data: string; header?: boolean }>>): this {
    const normalized = rows.map((row) =>
      row.map((cell) =>
        (typeof cell === 'string' ? cell : cell.data)
          .replace(/\|/g, '\\|')
          .replace(/\r?\n/g, '<br>'),
      ),
    );
    if (normalized.length === 0) return this;
    this.value += `| ${normalized[0].join(' | ')} |\n`;
    this.value += `| ${normalized[0].map(() => '---').join(' | ')} |\n`;
    for (const row of normalized.slice(1)) this.value += `| ${row.join(' | ')} |\n`;
    return this;
  }

  stringify(): string {
    return this.value;
  }

  async write(): Promise<void> {
    const target = process.env.GITHUB_STEP_SUMMARY;
    if (!target) return;
    await fs.promises.appendFile(target, this.value, 'utf8');
  }
}

export const summary = new Summary();
