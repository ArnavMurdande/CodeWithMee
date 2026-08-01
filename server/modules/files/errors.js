'use strict';

class FileError extends Error {
  constructor(code, status, details = null) {
    super(code);
    this.name = 'FileError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isFileError(error) {
  return error instanceof FileError;
}

module.exports = { FileError, isFileError };
