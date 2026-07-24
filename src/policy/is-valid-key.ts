import { isValidSemanticName } from './is-valid-semantic-name.js';

export const isValidKey = (value: unknown): value is string =>
  isValidSemanticName(value) && !/[\p{Cc}/~]/u.test(value);
