import type { DefinitionFaultCode } from '../../errors/index.js';
import {
  escapeJsonPointerSegment,
  isValidKey,
  isValidSemanticName,
  PIPELINE_LIMITS,
} from '../../policy/index.js';

type RecordValue = Record<string, unknown>;
type MutableFault = { code: DefinitionFaultCode; path: string; message: string };

export class DefinitionValidationContext {
  readonly faults: MutableFault[] = [];

  isRecord(value: unknown): value is RecordValue {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  addFault(code: DefinitionFaultCode, path: string, message: string): void {
    this.faults.push({ code, path, message });
  }

  unknownFields(value: RecordValue, allowed: readonly string[], path: string): void {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) {
        this.addFault(
          'DEF_UNKNOWN_FIELD',
          `${path}/${escapeJsonPointerSegment(key)}`,
          'Unknown field.',
        );
      }
    }
  }

  requireKey(value: unknown, path: string): value is string {
    if (!isValidKey(value)) {
      this.addFault('DEF_KEY', path, 'Invalid key.');
      return false;
    }
    return true;
  }

  requireName(value: unknown, path: string): value is string {
    if (!isValidSemanticName(value)) {
      this.addFault('DEF_KEY', path, 'Invalid semantic name.');
      return false;
    }
    return true;
  }

  requireDisplayString(value: unknown, path: string): value is string {
    if (
      typeof value !== 'string' ||
      Array.from(value.normalize('NFC')).length > PIPELINE_LIMITS.portable.displayCodePoints
    ) {
      this.addFault('DEF_TYPE', path, 'Expected a bounded string.');
      return false;
    }
    return true;
  }

  requireArray(value: unknown, path: string, maximum: number): value is unknown[] {
    if (!Array.isArray(value)) {
      this.addFault('DEF_TYPE', path, 'Expected an array.');
      return false;
    }
    if (value.length > maximum) {
      this.addFault('DEF_LIMIT', path, 'Collection limit exceeded.');
      return false;
    }
    return true;
  }

  validateExactRoutes(
    value: unknown,
    outcomes: readonly string[],
    path: string,
  ): value is Record<string, string> {
    if (!this.isRecord(value)) {
      this.addFault('DEF_TYPE', path, 'Expected route object.');
      return false;
    }
    this.unknownFields(value, outcomes, path);
    let valid = true;
    for (const outcome of outcomes) {
      if (!this.requireKey(value[outcome], `${path}/${outcome}`)) {
        valid = false;
      }
    }
    return valid;
  }
}
