import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { ModifiedFiles } from './ModifiedFiles.js';
import type { ModifiedFile } from '../lib/types.js';

function createFile(path: string, additions: number = 10, deletions: number = 5): ModifiedFile {
  return { path, additions, deletions };
}

describe('ModifiedFiles', () => {
  it('should render header', () => {
    const { lastFrame } = render(<ModifiedFiles files={new Map()} />);
    expect(lastFrame()).toContain('Modified');
  });

  it('should render empty state when no files', () => {
    const { lastFrame } = render(<ModifiedFiles files={new Map()} />);
    expect(lastFrame()).toContain('No files modified');
  });

  it('should render file name', () => {
    const files = new Map<string, ModifiedFile>();
    files.set('/src/index.ts', createFile('/src/index.ts'));
    const { lastFrame } = render(<ModifiedFiles files={files} />);
    expect(lastFrame()).toContain('index.ts');
  });

  it('should render additions count', () => {
    const files = new Map<string, ModifiedFile>();
    files.set('/src/index.ts', createFile('/src/index.ts', 25, 10));
    const { lastFrame } = render(<ModifiedFiles files={files} />);
    expect(lastFrame()).toContain('+25');
  });

  it('should render multiple files', () => {
    const files = new Map<string, ModifiedFile>();
    files.set('/src/a.ts', createFile('/src/a.ts'));
    files.set('/src/b.ts', createFile('/src/b.ts'));
    files.set('/src/c.ts', createFile('/src/c.ts'));
    const { lastFrame } = render(<ModifiedFiles files={files} />);
    expect(lastFrame()).toContain('a.ts');
    expect(lastFrame()).toContain('b.ts');
    expect(lastFrame()).toContain('c.ts');
  });

  it('should limit visible files to 6', () => {
    const files = new Map<string, ModifiedFile>();
    for (let i = 0; i < 10; i++) {
      files.set(`/src/file${i}.ts`, createFile(`/src/file${i}.ts`));
    }
    const { lastFrame } = render(<ModifiedFiles files={files} />);
    const frame = lastFrame() || '';
    const matches = frame.match(/file\d+\.ts/g) || [];
    expect(matches.length).toBeLessThanOrEqual(6);
  });

  it('should show overflow count', () => {
    const files = new Map<string, ModifiedFile>();
    for (let i = 0; i < 10; i++) {
      files.set(`/src/file${i}.ts`, createFile(`/src/file${i}.ts`));
    }
    const { lastFrame } = render(<ModifiedFiles files={files} />);
    expect(lastFrame()).toContain('+4 more');
  });

  it('should not show overflow for 6 or fewer files', () => {
    const files = new Map<string, ModifiedFile>();
    for (let i = 0; i < 6; i++) {
      files.set(`/src/file${i}.ts`, createFile(`/src/file${i}.ts`));
    }
    const { lastFrame } = render(<ModifiedFiles files={files} />);
    expect(lastFrame()).not.toContain('more');
  });

  it('should truncate long file names', () => {
    const files = new Map<string, ModifiedFile>();
    const longName = '/src/this-is-a-very-long-file-name-that-should-be-truncated.tsx';
    files.set(longName, createFile(longName));
    const { lastFrame } = render(<ModifiedFiles files={files} />);
    const frame = lastFrame() || '';
    expect(frame.includes('this-is-a-very-long-file-name-that-should-be-truncated.tsx')).toBe(false);
  });

  it('should extract filename from path', () => {
    const files = new Map<string, ModifiedFile>();
    files.set('/deep/nested/path/to/component.tsx', createFile('/deep/nested/path/to/component.tsx'));
    const { lastFrame } = render(<ModifiedFiles files={files} />);
    expect(lastFrame()).toContain('component.tsx');
    expect(lastFrame()).not.toContain('/deep');
  });
});
