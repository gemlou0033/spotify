import http from "node:http";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const dataDir = join(repoRoot, "data");
const logPath = join(dataDir, "browser-import.log");
const checkpointPath = join(dataDir, "browser-checkpoint.json");
const artistSeedPath = join(dataDir, "artists.json");
const playlistCsvBackupPath = join(dataDir, "playlist-csv-import-backup.json");
const tokenPath = join(dataDir, "spotify-cli-token.json");
const port = 5174;

await mkdir(dataDir, { recursive: true });
await appendFile(logPath, `\n--- bridge started ${new Date().toISOString()} ---\n`);

const server = http.createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:5173");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "GET" && request.url === "/token") {
    if (!existsSync(tokenPath)) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "No cached token" }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(await readFile(tokenPath, "utf8"));
    return;
  }

  if (request.method === "GET" && request.url === "/backup/latest") {
    const backupPath = existsSync(checkpointPath)
      ? checkpointPath
      : existsSync(playlistCsvBackupPath)
        ? playlistCsvBackupPath
        : artistSeedPath;
    if (!existsSync(backupPath)) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "No local backup found" }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(await readFile(backupPath, "utf8"));
    return;
  }

  if (request.method === "GET" && request.url === "/backup/checkpoint") {
    if (!existsSync(checkpointPath)) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "No browser checkpoint found" }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(await readFile(checkpointPath, "utf8"));
    return;
  }

  if (request.method === "GET" && request.url === "/backup/playlist-artist-seed") {
    if (!existsSync(playlistCsvBackupPath)) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "No playlist CSV backup found" }));
      return;
    }

    const payload = JSON.parse(await readFile(playlistCsvBackupPath, "utf8"));
    const state = payload.state ?? payload;
    const seed = {
      ...payload,
      state: {
        ...state,
        tracks: {},
        ratings: {},
        stats: {
          ...state.stats,
          sourceNote: "Playlist CSV artist seed",
          completedArtistIds: [],
          completedArtistCount: 0,
          trackCount: 0,
          albumCount: 0,
        },
      },
    };

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(seed));
    return;
  }

  if (request.method !== "POST") {
    response.writeHead(404);
    response.end();
    return;
  }

  try {
    const body = await readBody(request);
    const payload = body ? JSON.parse(body) : {};

    if (request.url === "/log") {
      const line = `${new Date().toISOString()} ${payload.level ?? "info"} ${payload.message ?? ""}\n`;
      await appendFile(logPath, line);
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.url === "/checkpoint") {
      await writeFile(
        checkpointPath,
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            app: "spotify-song-rater",
            version: 1,
            state: payload.state,
          },
          null,
          2,
        ),
      );
      const stats = payload.state?.stats ?? {};
      await appendFile(
        logPath,
        `${new Date().toISOString()} checkpoint artists=${stats.artistCount ?? 0} completed=${stats.completedArtistCount ?? 0} tracks=${stats.trackCount ?? 0}\n`,
      );
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.url === "/artist-seed") {
      await writeFile(
        artistSeedPath,
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            app: "spotify-song-rater",
            version: 1,
            artists: payload.artists ?? {},
          },
          null,
          2,
        ),
      );
      await appendFile(
        logPath,
        `${new Date().toISOString()} artist-seed artists=${Object.keys(payload.artists ?? {}).length}\n`,
      );
      response.writeHead(204);
      response.end();
      return;
    }

    response.writeHead(404);
    response.end();
  } catch (err) {
    await appendFile(logPath, `${new Date().toISOString()} bridge-error ${err.message}\n`);
    response.writeHead(500, { "Content-Type": "text/plain" });
    response.end(err.message);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Bridge listening on http://127.0.0.1:${port}`);
  console.log(`Writing logs to ${logPath}`);
  console.log(`Writing checkpoints to ${checkpointPath}`);
});

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}
