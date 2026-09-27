import { describe, expect, it } from 'vitest';
import { runCommand, stepsToSkip } from '../../src/pipeline/refresh.js';

describe('choosing refresh steps', () => {
  it('runs only the named steps', () => {
    expect(stepsToSkip(['places'], '')).toEqual(['download', 'graph', 'tiles']);
    expect(stepsToSkip(['graph', 'tiles'], 'places')).toEqual(['download', 'places']);
  });

  it('falls back to OSM_REFRESH_SKIP with no names', () => {
    expect(stepsToSkip([], ' tiles, download ,')).toEqual(['tiles', 'download']);
    expect(stepsToSkip([], '')).toEqual([]);
  });

  it('refuses a step that doesn’t exist', () => {
    expect(() => stepsToSkip(['places', 'teleport'], '')).toThrow('Unknown step(s): teleport. Steps: download, graph, tiles, places');
  });
});

describe('running a pipeline command', () => {
  it('streams stdout and stderr line by line, including a last line without a newline', async () => {
    const lines: string[] = [];
    await runCommand('sh', ['-c', 'echo one; echo two >&2; printf three'], (l) => lines.push(l));
    expect(lines.sort()).toEqual(['one', 'three', 'two']);
  });

  it('fails with the exit code', async () => {
    await expect(runCommand('sh', ['-c', 'exit 3'], () => undefined)).rejects.toThrow('sh exited with code 3');
  });

  it('fails when the program is missing', async () => {
    await expect(runCommand('definitely-not-a-program-wf', [], () => undefined)).rejects.toThrow(/ENOENT/);
  });
});
