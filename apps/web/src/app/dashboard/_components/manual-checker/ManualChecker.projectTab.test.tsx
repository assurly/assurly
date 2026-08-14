// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ManualChecker from './ManualChecker';

const { readZipFileMock, readFileListFromInputMock } = vi.hoisted(() => ({
  readZipFileMock: vi.fn(),
  readFileListFromInputMock: vi.fn(),
}));

vi.mock('./projectFiles', async () => {
  const actual = await vi.importActual<typeof import('./projectFiles')>('./projectFiles');
  return {
    ...actual,
    readZipFile: readZipFileMock,
    readFileListFromInput: readFileListFromInputMock,
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  readZipFileMock.mockReset();
  readFileListFromInputMock.mockReset();
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ManualChecker project tab', () => {
  it('renders ZIP / folder CTAs with lucide icons and no emoji copy', () => {
    render(<ManualChecker onToast={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: /Project Folder \/ ZIP/i }));

    const folderBtn = screen.getByRole('button', { name: /Select Project Folder/i });
    const zipBtn = screen.getByRole('button', { name: /Upload ZIP Archive/i });

    expect(folderBtn.textContent).toMatch(/Select Project Folder/);
    expect(zipBtn.textContent).toMatch(/Upload ZIP Archive/);
    expect(folderBtn.textContent).not.toMatch(/📁|📂|📦/);
    expect(zipBtn.textContent).not.toMatch(/📁|📂|📦/);
    expect(folderBtn.querySelector('svg.dashboard-icon')).toBeTruthy();
    expect(zipBtn.querySelector('svg.dashboard-icon')).toBeTruthy();
  });

  it('shows busy loading UI while a ZIP archive is reading', async () => {
    const toast = vi.fn();
    const pending = deferred<Array<{ path: string; content: string }>>();
    readZipFileMock.mockReturnValue(pending.promise);

    render(<ManualChecker onToast={toast} />);
    fireEvent.click(screen.getByRole('tab', { name: /Project Folder \/ ZIP/i }));

    const zipInput = screen.getByLabelText(/Upload ZIP archive/i);
    const archive = new File(['pk'], 'demo-app.zip', { type: 'application/zip' });

    await act(async () => {
      fireEvent.change(zipInput, { target: { files: [archive] } });
    });

    const placeholder = document.querySelector('.empty-project-placeholder');
    expect(placeholder?.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByTestId('project-load-status')).toBeTruthy();
    expect(screen.getByText(/Unpacking ZIP archive/i)).toBeTruthy();
    expect(screen.getByText('demo-app.zip')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Select Project Folder/i })).toBeNull();
    expect((zipInput as HTMLInputElement).disabled).toBe(true);

    await act(async () => {
      pending.resolve([{ path: 'package.json', content: '{"name":"demo"}' }]);
      await pending.promise;
    });

    await waitFor(() => {
      expect(screen.queryByTestId('project-load-status')).toBeNull();
    });
    expect(toast).toHaveBeenCalledWith(
      expect.stringMatching(/Project "demo-app" loaded/),
      'success',
    );
    expect(screen.getByText('demo-app')).toBeTruthy();
  });

  it('shows busy loading UI while a project folder is reading', async () => {
    const pending = deferred<{
      files: Array<{ path: string; content: string }>;
      rootFolderName: string;
    }>();
    readFileListFromInputMock.mockReturnValue(pending.promise);

    render(<ManualChecker onToast={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: /Project Folder \/ ZIP/i }));

    const folderInput = screen.getByLabelText(/Select project folder/i);
    const file = new File(['x'], 'index.ts', { type: 'text/plain' });
    Object.defineProperty(file, 'webkitRelativePath', {
      value: 'my-saas/src/index.ts',
    });

    await act(async () => {
      fireEvent.change(folderInput, { target: { files: [file] } });
    });

    expect(document.querySelector('.empty-project-placeholder')?.getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(screen.getByText(/Reading project folder/i)).toBeTruthy();
    expect(screen.getByText('my-saas')).toBeTruthy();

    await act(async () => {
      pending.resolve({
        files: [{ path: 'src/index.ts', content: 'export {};' }],
        rootFolderName: 'my-saas',
      });
      await pending.promise;
    });

    await waitFor(() => {
      expect(screen.queryByTestId('project-load-status')).toBeNull();
    });
    expect(screen.getByText('my-saas')).toBeTruthy();
  });
});

describe('ManualChecker Ship Loop (snippet autofix)', () => {
  it('records What changed after SQL Auto-Fix and restores content on Undo', async () => {
    vi.useFakeTimers();
    render(<ManualChecker onToast={vi.fn()} />);

    const editor = screen.getByLabelText(/Supabase SQL migration source/i) as HTMLTextAreaElement;
    const sqlBefore = editor.value;
    expect(sqlBefore).toMatch(/create table profiles/i);
    expect(sqlBefore).not.toMatch(/ALTER TABLE profiles ENABLE ROW LEVEL SECURITY/i);

    expect(screen.getByTestId('ship-loop-handoff')).toBeTruthy();

    const autoFix = screen.getByRole('button', {
      name: /Auto-fix error in schema\.sql/i,
    });
    fireEvent.click(autoFix);

    await act(async () => {
      vi.advanceTimersByTime(900);
    });

    expect(screen.getByTestId('ship-loop-what-changed')).toBeTruthy();
    expect(screen.getByText(/Assurly enabled Row-Level Security/i)).toBeTruthy();
    expect(editor.value).toMatch(/ALTER TABLE profiles ENABLE ROW LEVEL SECURITY/i);

    fireEvent.click(screen.getByTestId('ship-loop-undo'));
    expect(editor.value).toBe(sqlBefore);
    expect(screen.queryByTestId('ship-loop-what-changed')).toBeNull();
  });

  it('shows Ship Receipt when the SQL snippet becomes READY TO SHIP', async () => {
    vi.useFakeTimers();
    render(<ManualChecker onToast={vi.fn()} />);

    const autoFixButtons = screen.getAllByRole('button', {
      name: /Auto-fix error in schema\.sql/i,
    });
    fireEvent.click(autoFixButtons[0]!);

    await act(async () => {
      vi.advanceTimersByTime(900);
    });

    // After RLS subsumption there is a single blocker; fixing it should reach READY.
    expect(screen.getByLabelText(/Ship score 100 out of 100/i)).toBeTruthy();
    expect(screen.getByTestId('ship-loop-receipt')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Copy Ship Receipt/i })).toBeTruthy();
  });
});
