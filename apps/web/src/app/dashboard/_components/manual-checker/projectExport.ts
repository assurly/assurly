import JSZip from 'jszip';
import type { ProjectFile } from './useManualScan';

function sanitizeDownloadName(name: string): string {
  const trimmed = name.trim() || 'project';
  return trimmed
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function downloadProjectZip(
  files: ProjectFile[],
  projectName: string,
  suffix = 'assurly-project',
): Promise<void> {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.path, file.content);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerBrowserDownload(blob, `${sanitizeDownloadName(projectName)}-${suffix}.zip`);
}

function buildUnifiedDiff(path: string, before: string, after: string): string {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');

  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ ${beforeLines.length} lines -> ${afterLines.length} lines @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
  ].join('\n');
}

export function downloadProjectPatch(
  beforeFiles: ProjectFile[],
  afterFiles: ProjectFile[],
  projectName: string,
): void {
  const beforeByPath = new Map(beforeFiles.map((file) => [file.path, file.content]));
  const afterByPath = new Map(afterFiles.map((file) => [file.path, file.content]));
  const allPaths = new Set([...beforeByPath.keys(), ...afterByPath.keys()]);
  const sections: string[] = [];

  for (const path of [...allPaths].sort((a, b) => a.localeCompare(b))) {
    const previous = beforeByPath.get(path);
    const next = afterByPath.get(path);

    if (previous === undefined && next !== undefined) {
      sections.push(
        [`--- /dev/null`, `+++ b/${path}`, ...next.split('\n').map((line) => `+${line}`)].join(
          '\n',
        ),
      );
      continue;
    }

    if (previous !== undefined && next === undefined) {
      sections.push(
        [`--- a/${path}`, `+++ /dev/null`, ...previous.split('\n').map((line) => `-${line}`)].join(
          '\n',
        ),
      );
      continue;
    }

    if (previous !== undefined && next !== undefined && previous !== next) {
      sections.push(buildUnifiedDiff(path, previous, next));
    }
  }

  const patchBody = sections.length > 0 ? sections.join('\n\n') : '# No file changes to export.\n';

  const blob = new Blob([patchBody], { type: 'text/plain;charset=utf-8' });
  triggerBrowserDownload(blob, `${sanitizeDownloadName(projectName)}-assurly.patch`);
}
