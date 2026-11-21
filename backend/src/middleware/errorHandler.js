import { logger } from "../services/logger.js";

/**
 * JSON 404 for unknown API routes so API clients never receive HTML.
 */
export function apiNotFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    message: "API route not found",
  });
}

function resolveStatus(error) {
  if (error?.type === "entity.parse.failed") {
    return 400;
  }

  if (error?.type === "entity.too.large") {
    return 413;
  }

  if (error?.name === "ValidationError" || error?.name === "CastError") {
    return 400;
  }

  const status = Number(error?.status || error?.statusCode);

  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    return status;
  }

  return 500;
}

function resolveMessage(error, status) {
  if (error?.type === "entity.parse.failed") {
    return "Request body must be valid JSON";
  }

  if (error?.type === "entity.too.large") {
    return "Request body is too large";
  }

  // Never leak internal error details (stack traces, driver messages) for
  // unexpected failures. Expected 4xx errors carry user-safe messages.
  if (status >= 500 && status !== 503) {
    return "Internal server error";
  }

  return error?.message || "Request failed";
}

/**
 * Central Express error handler. Express 5 forwards rejected async handlers
 * here automatically.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, next) {
  const status = resolveStatus(error);

  if (status >= 500) {
    logger.error("request_failed", {
      method: req.method,
      path: req.originalUrl?.split("?")[0],
      status,
      errorName: error?.name,
      errorMessage: error?.message,
    });
  }

  if (res.headersSent) {
    return;
  }

  res.status(status).json({
    success: false,
    message: resolveMessage(error, status),
  });
}
