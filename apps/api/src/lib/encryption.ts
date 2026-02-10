import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { logger } from "./logger";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getMasterKey(): Buffer {
  const hex = process.env.ENCRYPTION_MASTER_KEY;
  if (!hex) throw new Error("ENCRYPTION_MASTER_KEY env var is not set");
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) throw new Error("ENCRYPTION_MASTER_KEY must be 32 bytes (64 hex chars)");
  return key;
}

export function encryptToken(plaintext: string): Buffer {
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: [iv (12)] [authTag (16)] [ciphertext]
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decryptToken(ciphertext: Buffer): string {
  const key = getMasterKey();
  const iv = ciphertext.subarray(0, IV_LENGTH);
  const authTag = ciphertext.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = ciphertext.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
