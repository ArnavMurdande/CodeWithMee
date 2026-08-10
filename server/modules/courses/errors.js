'use strict';

class CourseError extends Error {
  constructor(code, status = 400, details = null) {
    super(code);
    this.name = 'CourseError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

module.exports = { CourseError };
