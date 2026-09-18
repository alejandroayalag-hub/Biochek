import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

function uploadsDir() {
  return process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');
}

export function savePlainFile(content, subdir, extension = 'csv') {
  const dir = join(uploadsDir(), subdir);
  mkdirSync(dir, { recursive: true });
  const filename = `${crypto.randomUUID()}.${extension}`;
  writeFileSync(join(dir, filename), content, 'utf8');
  return join(subdir, filename);
}

export function readPlainFile(relativePath) {
  return readFileSync(join(uploadsDir(), relativePath), 'utf8');
}
