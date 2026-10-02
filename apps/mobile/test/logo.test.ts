import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appDir = join(__dirname, '..');
const repo = join(appDir, '../..');

/** Width and height from a PNG's header. */
function pngSize(path: string) {
  const b = readFileSync(path);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe('the Wayfinder logo', () => {
  it('has every icon file the app config points at, at the size Android expects', () => {
    const icons = join(appDir, 'assets/icons');
    expect(pngSize(join(icons, 'icon.png'))).toEqual({ w: 1024, h: 1024 });
    expect(pngSize(join(icons, 'adaptive-foreground.png'))).toEqual({ w: 432, h: 432 });
    expect(pngSize(join(icons, 'adaptive-monochrome.png'))).toEqual({ w: 432, h: 432 });
    expect(pngSize(join(icons, 'play-store-icon.png'))).toEqual({ w: 512, h: 512 });
    const config = readFileSync(join(appDir, 'app.config.ts'), 'utf8');
    for (const f of ['icon.png', 'adaptive-foreground.png', 'adaptive-monochrome.png']) {
      expect(config).toContain(`./assets/icons/${f}`);
    }
  });

  it('is shipped for the website, and the web page names the app Wayfinder', () => {
    const pub = join(repo, 'apps/web/public');
    for (const f of [
      'logo-mark.svg',
      'favicon.svg',
      'apple-touch-icon.png',
      'icon-192.png',
      'icon-512.png',
    ]) {
      expect(existsSync(join(pub, f))).toBe(true);
    }
    const manifest = JSON.parse(readFileSync(join(pub, 'manifest.webmanifest'), 'utf8')) as {
      name: string;
    };
    expect(manifest.name).toBe('Wayfinder');
    expect(readFileSync(join(repo, 'apps/web/index.html'), 'utf8')).toContain(
      '<title>Wayfinder</title>',
    );
  });

  it('is not a hexagon, which only the explore index may use', () => {
    const svg = readFileSync(join(repo, 'apps/web/public/logo-mark.svg'), 'utf8');
    expect(svg).not.toContain('28.1 9v14');
    expect(readFileSync(join(repo, 'apps/web/public/favicon.svg'), 'utf8')).toBe(svg);
  });
});
