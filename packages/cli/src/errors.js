export class TessmoraError extends Error {
  constructor(code, message, hint, details) {
    super(message);
    this.name = 'TessmoraError';
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}

export function redact(value, secrets = []) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join('[redacted]');
  }
  return text
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:token|access_token|api_key|signature)=)[^\s&#]+/gi, '$1[redacted]')
    .replace(/\b(?:sk|sk-or-v1)-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/((?:api[_-]?key|authorization|setup[_-]?token|password)["']?\s*[=:]\s*["']?(?:Bearer\s+)?)[^\s,;"'}]+/gi, '$1[redacted]');
}

export function publicError(error, secrets = []) {
  return {
    code: error.code || 'UNEXPECTED_ERROR',
    message: redact(error.message || String(error), secrets),
    ...(error.hint ? { hint: redact(error.hint, secrets) } : {}),
  };
}
