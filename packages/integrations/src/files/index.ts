import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

export interface FileStore {
  readonly name: "local" | "s3";
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

function safeKey(key: string): string {
  const k = normalize(key).replace(/^(\.\.(\/|\\|$))+/, "");
  if (k.startsWith("/") || k.includes("..")) throw new Error("invalid file key");
  return k;
}

/** Local disk store for development (git-ignored `.uploads/`). */
export function createLocalFileStore(root: string): FileStore {
  return {
    name: "local",
    async put(key, body) {
      const path = join(root, safeKey(key));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(join(root, safeKey(key))));
      } catch {
        return null;
      }
    },
  };
}

export function createS3FileStore(bucket: string, region: string): FileStore {
  const s3 = new S3Client({ region });
  return {
    name: "s3",
    async put(key, body, contentType) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: safeKey(key), Body: body, ContentType: contentType }));
    },
    async get(key) {
      try {
        const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: safeKey(key) }));
        return out.Body ? await out.Body.transformToByteArray() : null;
      } catch {
        return null;
      }
    },
  };
}
