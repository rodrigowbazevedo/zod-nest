import type { z } from 'zod';

/**
 * Reads the fields a check needs off a platform file object. Multer names the
 * client filename `originalname`, `@fastify/multipart` names it `filename`,
 * and only multer reports a `size` — so each platform supplies its own
 * accessors instead of the library inventing a common shape.
 */
export interface FileAccessors<TFile> {
  readonly mimeType: (file: TFile) => string;
  readonly fileName: (file: TFile) => string;
  readonly size?: (file: TFile) => number;
}

export interface MimeTypeCheckOptions {
  readonly mimeTypes: readonly string[];
}

export interface ExtensionCheckOptions {
  readonly extensions: readonly string[];
}

export interface SizeCheckOptions {
  readonly maxSize: number;
}

export type FileCheck<TFile> = (payload: z.core.ParsePayload<TFile>) => void;

const normalizeExtension = (extension: string): string =>
  extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;

export const mimeTypeCheck = <TFile>(
  accessors: FileAccessors<TFile>,
  options: MimeTypeCheckOptions,
): FileCheck<TFile> => {
  const allowed = new Set(options.mimeTypes.map((mimeType) => mimeType.toLowerCase()));
  return (payload) => {
    const mimeType = accessors.mimeType(payload.value).toLowerCase();
    if (allowed.has(mimeType)) {
      return;
    }
    payload.issues.push({
      code: 'custom',
      input: payload.value,
      message: `Expected one of ${options.mimeTypes.join(', ')}, received ${mimeType}`,
    });
  };
};

export const extensionCheck = <TFile>(
  accessors: FileAccessors<TFile>,
  options: ExtensionCheckOptions,
): FileCheck<TFile> => {
  const allowed = new Set(options.extensions.map(normalizeExtension));
  return (payload) => {
    const fileName = accessors.fileName(payload.value).toLowerCase();
    const matched = [...allowed].some((extension) => fileName.endsWith(extension));
    if (matched) {
      return;
    }
    payload.issues.push({
      code: 'custom',
      input: payload.value,
      message: `Expected a file ending in ${options.extensions.map(normalizeExtension).join(', ')}, received ${fileName}`,
    });
  };
};

export const sizeCheck = <TFile>(
  readSize: (file: TFile) => number,
  options: SizeCheckOptions,
): FileCheck<TFile> => {
  return (payload) => {
    const size = readSize(payload.value);
    if (size <= options.maxSize) {
      return;
    }
    payload.issues.push({
      code: 'custom',
      input: payload.value,
      message: `Expected at most ${options.maxSize} bytes, received ${size}`,
    });
  };
};
