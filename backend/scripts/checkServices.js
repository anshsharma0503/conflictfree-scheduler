// Checks that every service ConflictFree needs is reachable, using the
// settings in backend/.env. Used by setup.ps1 / start.ps1 in the project
// root; also runnable on its own:
//
//   npm run check:services            # MongoDB + Redis + Gemini key presence
//   npm run check:services -- --gemini   # also verify the Gemini key (free ListModels call)
//
// Prints no secrets: hosts are shown without credentials. Exit code 1 when
// MongoDB is unusable (the app cannot run without it); Redis and Gemini are
// optional and only produce warnings.
import "dotenv/config";
import IORedis from "ioredis";
import mongoose from "mongoose";

const checkGemini = process.argv.includes("--gemini");
const results = [];

function report(level, name, detail) {
  const icon = { ok: "✔", warn: "!", fail: "✖" }[level];
  results.push(level);
  console.log(`${icon} ${name.padEnd(9)} ${detail}`);
}

function safeHost(uri) {
  try {
    const url = new URL(uri);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "(unparseable URI)";
  }
}

async function checkMongo() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    report("fail", "MongoDB", "MONGODB_URI is not set in backend/.env");
    return;
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });

    if (!hello.setName) {
      report(
        "fail",
        "MongoDB",
        `${safeHost(uri)} is reachable but is not a replica set (needed for atomic booking). ` +
          "Local: enable `replication: replSetName: rs0`, restart, run `npm run db:init-replset`.",
      );
    } else {
      report("ok", "MongoDB", `${safeHost(uri)} (replica set "${hello.setName}")`);
    }
  } catch (error) {
    const hint = /whitelist|IP/i.test(error.message)
      ? " Check the Atlas Network Access list."
      : " Is MongoDB running? Is the URI correct?";
    report("fail", "MongoDB", `cannot connect to ${safeHost(uri)}: ${error.message.split("\n")[0]}.${hint}`);
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

async function checkRedis() {
  const url = process.env.REDIS_URL;

  if (!url) {
    report("warn", "Redis", "REDIS_URL not set: notifications and reminders will be off");
    return;
  }

  const redis = new IORedis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    retryStrategy: () => null,
    lazyConnect: true,
  });
  redis.on("error", () => {});

  try {
    await redis.connect();
    await redis.ping();

    let policy = "";
    try {
      const [, value] = await redis.config("GET", "maxmemory-policy");
      policy = value;
    } catch {
      // Managed providers may block CONFIG; that is fine.
    }

    if (policy && policy !== "noeviction") {
      report("warn", "Redis", `${safeHost(url)} reachable, but maxmemory-policy is "${policy}" (BullMQ needs "noeviction")`);
    } else {
      report("ok", "Redis", `${safeHost(url)}${policy ? " (noeviction)" : ""}`);
    }
  } catch (error) {
    report("warn", "Redis", `cannot reach ${safeHost(url)}: ${error.message}. Run "docker compose up -d redis".`);
  } finally {
    redis.disconnect();
  }
}

async function checkGeminiKey() {
  const key = (process.env.GEMINI_API_KEY || "").trim();

  if (!key) {
    report("warn", "Gemini", "GEMINI_API_KEY not set: the scheduling assistant will be hidden");
    return;
  }

  if (!checkGemini) {
    report("ok", "Gemini", "GEMINI_API_KEY is set (use --gemini to verify it)");
    return;
  }

  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
      headers: { "x-goog-api-key": key },
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      report("ok", "Gemini", "API key accepted");
    } else {
      report("warn", "Gemini", `API key rejected (HTTP ${response.status}); check GEMINI_API_KEY`);
    }
  } catch (error) {
    report("warn", "Gemini", `could not reach the Gemini API: ${error.message}`);
  }
}

await checkMongo();
await checkRedis();
await checkGeminiKey();

process.exit(results.includes("fail") ? 1 : 0);
