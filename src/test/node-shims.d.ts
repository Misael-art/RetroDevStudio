declare module "node:child_process" {
  export interface SpawnSyncOptions {
    cwd?: string;
    encoding?: string;
    env?: Record<string, string | undefined>;
    maxBuffer?: number;
    timeout?: number;
  }

  export interface SpawnSyncReturns {
    error?: Error;
    signal: string | null;
    status: number | null;
    stderr: string;
    stdout: string;
  }

  export function spawnSync(
    command: string,
    args?: readonly string[],
    options?: SpawnSyncOptions
  ): SpawnSyncReturns;
}

declare module "node:fs" {
  export interface MkdirSyncOptions {
    recursive?: boolean;
  }

  export interface RmSyncOptions {
    force?: boolean;
    recursive?: boolean;
  }

  export interface Stats {
    size: number;
  }

  export function mkdtempSync(prefix: string): string;
  export function mkdirSync(
    path: string,
    options?: MkdirSyncOptions
  ): string | undefined;
  export function readFileSync(path: string, encoding: string): string;
  export function rmSync(path: string, options?: RmSyncOptions): void;
  export function statSync(path: string): Stats;
  export function writeFileSync(path: string, data: string | Uint8Array): void;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "node:path" {
  interface PathModule {
    join(...paths: string[]): string;
    resolve(...paths: string[]): string;
  }

  const path: PathModule;
  export default path;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare const process: {
  env: Record<string, string | undefined>;
  platform: string;
};
