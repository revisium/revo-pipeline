export const escapeJsonPointerSegment = (value: string): string =>
  value.replaceAll('~', '~0').replaceAll('/', '~1');
