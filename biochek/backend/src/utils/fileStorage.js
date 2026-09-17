import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { encryptBuffer, decryptBuffer } from './cipher.js';

function uploadsDir() {
  return process.env.UPLOADS_DIR || join(process.cwd(), 'uploads');
}

export function saveEncryptedFile(base64Data, subdir) {
  const dir = join(uploadsDir(), subdir);
  mkdirSync(dir, { recursive: true });
  const filename = `${crypto.randomUUID()}.enc`;
  const plain = Buffer.from(base64Data, 'base64');
  writeFileSync(join(dir, filename), encryptBuffer(plain));
  return join(subdir, filename);
}

export function readEncryptedFile(relativePath) {
  const payload = readFileSync(join(uploadsDir(), relativePath));
  return decryptBuffer(payload);
}
