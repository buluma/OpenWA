import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Bun manifests and locks', () => {
  const repo = join(__dirname, '..', '..');
  const readJson = <T>(file: string): T =>
    JSON.parse(readFileSync(join(repo, file), 'utf8').replace(/,\s*([}\]])/g, '$1')) as T;
  type Manifest = {
    name: string;
    engines?: { node?: string };
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  type Lock = {
    lockfileVersion: number;
    workspaces: Record<
      string,
      { name: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    >;
    packages: Record<string, unknown>;
  };

  it.each([
    ['package.json', 'bun.lock'],
    ['dashboard/package.json', 'dashboard/bun.lock'],
    ['sdk/javascript/package.json', 'sdk/javascript/bun.lock'],
  ])('%s dependencies are represented by %s', (manifestPath, lockPath) => {
    const manifest = readJson<Manifest>(manifestPath);
    const lock = readJson<Lock>(lockPath);
    const workspace = lock.workspaces[''];
    expect(lock.lockfileVersion).toBeGreaterThan(0);
    expect(workspace.name).toBe(manifest.name);
    expect(workspace.dependencies ?? {}).toEqual(manifest.dependencies ?? {});
    expect(workspace.devDependencies ?? {}).toEqual(manifest.devDependencies ?? {});
    // Ensure the parsed lock contains the resolved package graph, not just the workspace header.
    expect(Object.keys(lock.packages).length).toBeGreaterThan(20);
  });

  it('pins one Bun version for local installs, CI and the container', () => {
    const version = readFileSync(join(repo, '.bun-version'), 'utf8').trim();
    const manifest = readJson<Manifest & { packageManager?: string }>('package.json');
    const dockerfile = readFileSync(join(repo, 'Dockerfile'), 'utf8');
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.packageManager).toBe(`bun@${version}`);
    expect(dockerfile).toContain(`FROM --platform=$BUILDPLATFORM oven/bun:${version} AS bun-cli-build`);
    expect(dockerfile).toContain(`FROM oven/bun:${version} AS bun-cli-target`);
    expect(dockerfile).toContain('COPY --from=bun-cli-build /usr/local/bin/bun /usr/local/bin/bun');
    expect(dockerfile).toContain('COPY --from=bun-cli-target /usr/local/bin/bun /usr/local/bin/bun');
  });
});
