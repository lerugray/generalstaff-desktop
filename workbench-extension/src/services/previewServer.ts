import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as path from 'node:path';
import { requireAllowedPath } from '../security/paths.js';

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

interface PreviewMount {
  root: string;
  entry: string;
}

export class PreviewServer {
  private readonly mounts = new Map<string, PreviewMount>();
  private server: http.Server | undefined;
  private port: number | undefined;

  async urlFor(file: string): Promise<string> {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error('Only local files can be previewed.');
    const token = crypto.randomBytes(18).toString('hex');
    const entry = path.basename(file);
    this.mounts.set(token, { root: path.dirname(file), entry });
    await this.ensureStarted();
    return `http://127.0.0.1:${this.port as number}/${token}/${encodeURIComponent(entry)}`;
  }

  dispose(): void {
    this.mounts.clear();
    this.server?.close();
    this.server = undefined;
    this.port = undefined;
  }

  private async ensureStarted(): Promise<void> {
    if (this.server && this.port) return;
    this.server = http.createServer((request, response) => void this.respond(request, response));
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('The local preview server could not start.');
    this.port = address.port;
  }

  private async respond(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self' data:; connect-src 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      const segments = requestUrl.pathname.split('/').filter(Boolean);
      const token = segments.shift();
      const mount = token ? this.mounts.get(token) : undefined;
      if (!mount) throw new Error('Unknown preview.');
      const relative = segments.length ? segments.map((segment) => decodeURIComponent(segment)).join(path.sep) : mount.entry;
      const candidate = requireAllowedPath(path.join(mount.root, relative), [mount.root]);
      const stat = await fs.stat(candidate);
      if (!stat.isFile()) throw new Error('Preview asset not found.');
      const body = await fs.readFile(candidate);
      response.statusCode = 200;
      response.setHeader('Content-Type', contentTypes[path.extname(candidate).toLowerCase()] ?? 'application/octet-stream');
      response.setHeader('Cache-Control', 'no-store');
      response.end(body);
    } catch {
      response.statusCode = 404;
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end('Preview not found.');
    }
  }
}
