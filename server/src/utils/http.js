export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`);
export const conflict = (msg) => new HttpError(409, msg);
export const forbidden = (msg = 'You do not have permission for this action') => new HttpError(403, msg);

/** Round to 2 decimals the way money should be rounded. */
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
