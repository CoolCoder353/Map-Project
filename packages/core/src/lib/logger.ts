import pino from 'pino';

export type Logger = pino.Logger;

export function createLogger(service: string, level = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino({
    name: service,
    level,
    // Never log coordinates, tokens or passwords.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.refreshToken',
        '*.accessToken',
        '*.lat',
        '*.lon',
        '*.points',
      ],
      censor: '[redacted]',
    },
  });
}
