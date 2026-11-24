import { HttpError } from '../utils/http.js';

const MYSQL = {
  ER_DUP_ENTRY: [409, 'A record with the same unique value already exists'],
  ER_ROW_IS_REFERENCED_2: [409, 'This record is used by other records and cannot be deleted'],
  ER_ROW_IS_REFERENCED: [409, 'This record is used by other records and cannot be deleted'],
  ER_NO_REFERENCED_ROW_2: [400, 'A linked record does not exist'],
  ER_CHECK_CONSTRAINT_VIOLATED: [400, 'A value is outside the allowed range'],
  ER_DATA_TOO_LONG: [400, 'A value is too long'],
  ER_TRUNCATED_WRONG_VALUE: [400, 'A value has the wrong format'],
  ER_WARN_DATA_OUT_OF_RANGE: [400, 'A number is too large'],
};

export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err?.code && MYSQL[err.code]) {
    const [status, msg] = MYSQL[err.code];
    return res.status(status).json({ error: msg });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
  if (err?.name === 'MulterError') return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
}
