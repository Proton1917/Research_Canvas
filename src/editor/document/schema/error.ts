import { BlockSuiteError, ErrorCode } from '@editor/platform/exceptions';

export class SchemaValidateError extends BlockSuiteError {
  constructor(flavour: string, message: string) {
    super(
      ErrorCode.SchemaValidateError,
      `Invalid schema for ${flavour}: ${message}`
    );
  }
}
