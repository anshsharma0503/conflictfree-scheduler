// Minimal structured JSON logger. Never pass secrets, tokens, cookies,
// passwords, or full request bodies to it: fields are redacted defensively
// but callers are responsible for choosing safe fields.

const SENSITIVE_KEY_PATTERN =
  /pass(word)?|secret|token|authorization|cookie|api[-_]?key|refresh|credential/i;

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function currentLevel() {
  if (process.env.LOG_LEVEL && LEVELS[process.env.LOG_LEVEL]) {
    return LEVELS[process.env.LOG_LEVEL];
  }

  return process.env.NODE_ENV === "test" ? LEVELS.silent : LEVELS.info;
}

export function redact(value, depth = 0) {
  if (value === null || value === undefined || depth > 4) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  if (typeof value === "object") {
    const output = {};

    for (const [key, nested] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? "[REDACTED]"
        : redact(nested, depth + 1);
    }

    return output;
  }

  return value;
}

function write(level, event, fields = {}) {
  if (LEVELS[level] < currentLevel()) {
    return;
  }

  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    event,
    ...redact(fields),
  });

  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (event, fields) => write("debug", event, fields),
  info: (event, fields) => write("info", event, fields),
  warn: (event, fields) => write("warn", event, fields),
  error: (event, fields) => write("error", event, fields),
};
