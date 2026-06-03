import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes
} from "node:crypto";

export function encryptSecret(value: string, appSecret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(appSecret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(":");
}

export function decryptSecret(value: string, appSecret: string): string {
  const [version, iv, tag, encrypted] = value.split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) {
    throw new Error("Unsupported encrypted secret format");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(appSecret),
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function encryptAead(value: string, appSecret = defaultAppSecret()): string {
  return encryptSecret(value, appSecret);
}

export function decryptAead(value: string, appSecret = defaultAppSecret()): string {
  return decryptSecret(value, appSecret);
}

export function hmacSecret(value: string, appSecret = defaultAppSecret()): string {
  return createHmac("sha256", key(appSecret)).update(value).digest("hex");
}

function key(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function defaultAppSecret(): string {
  const value = process.env.APP_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_SECRET is required in production");
  }
  return "dev-app-secret-change-me-please-32chars";
}
