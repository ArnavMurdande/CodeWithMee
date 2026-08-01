'use strict';

const PROBLEM_BASE_URI = 'https://codewithmee.dev/problems/';

function problemDetails({ code, detail, instance, issues, meta, requestId, status, title }) {
  const document = {
    code,
    status,
    title,
    type: `${PROBLEM_BASE_URI}${encodeURIComponent(code)}`,
  };
  if (detail) document.detail = detail;
  if (instance) document.instance = instance;
  if (requestId) document.requestId = requestId;
  if (meta) document.meta = Object.freeze({ ...meta });
  if (issues?.length) {
    document.errors = issues.map(({ code: issueCode, pointer }) => ({
      code: issueCode,
      pointer: pointer || '/',
    }));
  }
  return Object.freeze(document);
}

function sendProblem(response, input) {
  const document = problemDetails(input);
  return response.status(document.status).type('application/problem+json').json(document);
}

module.exports = { PROBLEM_BASE_URI, problemDetails, sendProblem };
