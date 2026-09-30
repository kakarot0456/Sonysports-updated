const express = require("express");

const app = express();

const PORT = Number(process.env.PORT || 7860);

// ============================================================
// STREAM CONFIGURATION
// ============================================================
//
// Preferred:
// STREAM_URL_1
// STREAM_URL_2
// STREAM_URL_3
// STREAM_URL_4
// ...
//
// You can add up to STREAM_URL_10 without changing the code.
//
// STREAM_URL is kept as a fallback for compatibility with your
// old Render setup.
// ============================================================

const configuredUrls = [
  process.env.STREAM_URL_1,
  process.env.STREAM_URL_2,
  process.env.STREAM_URL_3,
  process.env.STREAM_URL_4,
  process.env.STREAM_URL_5,
  process.env.STREAM_URL_6,
  process.env.STREAM_URL_7,
  process.env.STREAM_URL_8,
  process.env.STREAM_URL_9,
  process.env.STREAM_URL_10
]
  .map(url => (url || "").trim())
  .filter(Boolean);

// If no STREAM_URL_1...STREAM_URL_10 exist,
// continue using the old STREAM_URL variable.
const STREAM_URLS =
  configuredUrls.length > 0
    ? configuredUrls
    : [(
        process.env.STREAM_URL ||
        "https://sonymtmnew-akamaized.pages.dev/hls/live/2120299/ag_strea2909/ENG/master.m3u8"
      ).trim()];

const CHANNEL_ID = "sonysports";
const CHANNEL_NAME = "Sony Sports";
const STREAM_TITLE = "ENG | Day 12 - 30 Sep 2026";

// ============================================================
// UPSTREAM HEADERS
// ============================================================

const UPSTREAM_HEADERS = {
  "Referer": "https://www.sonyliv.com/",
  "Origin": "https://www.sonyliv.com/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0"
};

// ============================================================
// ALLOWED UPSTREAM HOSTS
// ============================================================
//
// Every configured stream's hostname is automatically allowed.
// This means STREAM_URL_1 and STREAM_URL_2 can even be on
// different CDN hosts.
// ============================================================

const allowedHosts = new Set();

for (const url of STREAM_URLS) {
  try {
    const parsed = new URL(url);

    if (parsed.protocol === "https:") {
      allowedHosts.add(parsed.hostname);
    }
  } catch {
    console.error(`[CONFIG] Invalid STREAM URL: ${url}`);
  }
}

function assertAllowedUpstream(url) {
  const u = new URL(url);

  if (u.protocol !== "https:") {
    throw new Error("Only HTTPS upstream URLs are allowed");
  }

  if (!allowedHosts.has(u.hostname)) {
    throw new Error(`Upstream host is not configured: ${u.hostname}`);
  }

  return u;
}

// ============================================================
// PROXY URL
// ============================================================

function proxyUrlFor(upstreamUrl, req) {
  return `${req.protocol}://${req.get("host")}/hls-proxy?url=${encodeURIComponent(
    upstreamUrl
  )}`;
}

// ============================================================
// HLS PLAYLIST REWRITER
// ============================================================

function rewritePlaylist(text, responseUrl, req) {
  // Rewrite URI="..." attributes such as:
  // EXT-X-KEY
  // EXT-X-MAP
  // EXT-X-MEDIA
  // etc.

  text = text.replace(/URI="([^"]+)"/g, (_, uri) => {
    try {
      const absolute = new URL(uri, responseUrl).toString();

      assertAllowedUpstream(absolute);

      return `URI="${proxyUrlFor(absolute, req)}"`;
    } catch {
      return `URI="${uri}"`;
    }
  });

  // Rewrite normal HLS playlist URLs:
  // variant playlists
  // .ts
  // .m4s
  // .aac
  // etc.

  return text
    .split(/\r?\n/)
    .map(line => {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#")) {
        return line;
      }

      try {
        const absolute = new URL(trimmed, responseUrl).toString();

        assertAllowedUpstream(absolute);

        return proxyUrlFor(absolute, req);
      } catch {
        return line;
      }
    })
    .join("\n");
}

// ============================================================
// FETCH UPSTREAM
// ============================================================

async function fetchUpstream(url) {
  const u = assertAllowedUpstream(url);

  console.log(`[HLS] GET ${u.href}`);

  const response = await fetch(u, {
    method: "GET",
    headers: UPSTREAM_HEADERS,
    redirect: "follow"
  });

  console.log(`[HLS] ${response.status} ${u.href}`);

  return response;
}

// ============================================================
// MANIFEST
// ============================================================

const manifest = {
  id: "community.sonysports.live",
  version: "3.0.0",
  name: CHANNEL_NAME,
  description: "Sony Sports live channel",
  resources: ["catalog", "meta", "stream"],
  types: ["tv"],
  idPrefixes: [CHANNEL_ID],

  catalogs: [
    {
      type: "tv",
      id: "sonysports-catalog",
      name: CHANNEL_NAME
    }
  ]
};

// ============================================================
// META
// ============================================================

const meta = {
  id: CHANNEL_ID,
  type: "tv",
  name: CHANNEL_NAME,
  description: "Sony Sports live"
};

// ============================================================
// CORS
// ============================================================

app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "*");
  res.set("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// ============================================================
// ROOT
// ============================================================

app.get("/", (req, res) => {
  res.redirect("/manifest.json");
});

// ============================================================
// MANIFEST ENDPOINT
// ============================================================

app.get("/manifest.json", (req, res) => {
  res.json(manifest);
});

// ============================================================
// CATALOG
// ============================================================

app.get(
  ["/catalog/tv/:id.json", "/catalog/tv/:id/:extra.json"],
  (req, res) => {
    res.json({
      metas:
        req.params.id === "sonysports-catalog"
          ? [meta]
          : []
    });
  }
);

// ============================================================
// META
// ============================================================

app.get("/meta/tv/:id.json", (req, res) => {
  res.json(
    req.params.id === CHANNEL_ID
      ? { meta }
      : { meta: null }
  );
});

// ============================================================
// STREAM ENDPOINT
// ============================================================
//
// This is where multiple STREAM_URL variables become
// multiple Stremio streams.
//
// Example:
//
// STREAM_URL_1 = link A
// STREAM_URL_2 = link B
// STREAM_URL_3 = link C
//
// Stremio receives:
//
// Sony Sports 1
// Sony Sports 2
// Sony Sports 3
// ============================================================

app.get("/stream/tv/:id.json", (req, res) => {
  res.set("Cache-Control", "no-store");

  if (req.params.id !== CHANNEL_ID) {
    return res.json({
      streams: []
    });
  }

  const streams = STREAM_URLS.map((url, index) => {
    return {
      name: `${CHANNEL_NAME} ${index + 1}`,

      title: STREAM_TITLE,

      url: proxyUrlFor(url, req),

      behaviorHints: {
        notWebReady: true
      }
    };
  });

  console.log(
    `[STREAM] Returning ${streams.length} stream(s)`
  );

  res.json({
    streams
  });
});

// ============================================================
// SERVER-SIDE HLS PROXY
// ============================================================

app.get("/hls-proxy", async (req, res) => {
  try {
    if (typeof req.query.url !== "string") {
      return res.status(400).send("Missing url");
    }

    const target = assertAllowedUpstream(req.query.url);

    const upstreamResponse = await fetchUpstream(
      target.toString()
    );

    if (!upstreamResponse.ok) {
      const body = await upstreamResponse
        .text()
        .catch(() => "");

      console.error(
        `[HLS] upstream error ${upstreamResponse.status}: ${body.slice(
          0,
          500
        )}`
      );

      return res
        .status(upstreamResponse.status)
        .send(
          `Upstream returned HTTP ${upstreamResponse.status}`
        );
    }

    const contentType =
      upstreamResponse.headers.get("content-type") || "";

    const looksLikePlaylist =
      contentType.includes("mpegurl") ||
      target.pathname.toLowerCase().endsWith(".m3u8");

    // ========================================================
    // PLAYLIST
    // ========================================================

    if (looksLikePlaylist) {
      const text = await upstreamResponse.text();

      const rewritten = rewritePlaylist(
        text,
        target.toString(),
        req
      );

      res.status(200);

      res.set(
        "Content-Type",
        "application/vnd.apple.mpegurl"
      );

      res.set("Cache-Control", "no-store");

      return res.send(rewritten);
    }

    // ========================================================
    // VIDEO / AUDIO / SEGMENTS / KEYS
    // ========================================================

    const buffer = Buffer.from(
      await upstreamResponse.arrayBuffer()
    );

    if (contentType) {
      res.set("Content-Type", contentType);
    }

    res.set("Cache-Control", "no-store");
    res.set("Accept-Ranges", "bytes");

    return res.status(200).send(buffer);

  } catch (err) {
    console.error("[HLS] proxy error:", err);

    return res
      .status(502)
      .send(`HLS proxy error: ${err.message}`);
  }
});

// ============================================================
// TEST STREAM
// ============================================================

app.get("/test-stream", async (req, res) => {
  try {
    const target = assertAllowedUpstream(
      STREAM_URLS[0]
    );

    const upstreamResponse = await fetchUpstream(
      target.toString()
    );

    const contentType =
      upstreamResponse.headers.get("content-type") || "";

    const text = await upstreamResponse.text();

    res.json({
      status: upstreamResponse.status,
      contentType,
      isPlaylist:
        contentType.includes("mpegurl") ||
        target.pathname.toLowerCase().endsWith(".m3u8"),
      streamCount: STREAM_URLS.length,
      preview: text.slice(0, 2000)
    });

  } catch (err) {
    console.error("[TEST] error:", err);

    res.status(500).json({
      error: err.message
    });
  }
});

// ============================================================
// HEALTH
// ============================================================

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    addon: CHANNEL_NAME,
    streamCount: STREAM_URLS.length,
    streams: STREAM_URLS.map((url, index) => ({
      number: index + 1,
      configured: Boolean(url)
    }))
  });
});

// ============================================================
// 404
// ============================================================

app.use((req, res) => {
  res.status(404).json({
    error: "Not found"
  });
});

// ============================================================
// ERROR HANDLER
// ============================================================

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    error: "Internal error"
  });
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Sony Sports Stremio addon listening on port ${PORT}`
  );

  console.log(
    `Configured streams: ${STREAM_URLS.length}`
  );

  STREAM_URLS.forEach((url, index) => {
    console.log(
      `Stream ${index + 1}: ${url}`
    );
  });
});
