export class ZodNestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZodNestError';
  }
}

export class ZodNestUnrepresentableError extends ZodNestError {
  readonly path: ReadonlyArray<string | number>;

  constructor(path: ReadonlyArray<string | number>) {
    super(
      `Unrepresentable schema at ${formatPath(path)}: no override produced a JSON Schema body. ` +
        `Set strict: false to emit \`{}\` instead, or supply an \`override\` that handles this Zod type.`,
    );
    this.name = 'ZodNestUnrepresentableError';
    this.path = path;
  }
}

const formatPath = (path: ReadonlyArray<string | number>): string => {
  if (path.length === 0) {
    return '<root>';
  }
  return '/' + path.map(String).join('/');
};
