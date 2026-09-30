const express = require("express");

const app = express();

// Render is behind a reverse proxy.
app.set("trust proxy", true);

const PORT = Number(process.env.PORT || 7860);

// ============================================================
// STREAM VARIABLES
// ============================================================
//
// In Render Environment:
//
// STREAM_URL_1 = https://....m3u8
// STREAM_URL_2 = https://....m3u8
// STREAM_URL_3 = https://....m3u8
//
// Add as many as you need up to STREAM_URL_10.
//
// Old STREAM_URL is kept as a fallback.
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

const STREAM_URLS =
  configuredUrls.length > 0
    ? configuredUrls
    : [
        (
          process.env.STREAM_URL ||
          "https://sonymtmnew-akamaized.pages.dev/hls/live/2120299/ag_strea2909/ENG/master.m3u8"
        ).trim()
      ];

const CHANNEL_ID = "sonysports";
const CHANNEL_NAME = "Sony Sports";
const STREAM_TITLE = "Live";

// ============================================================
// HEADERS USED FOR SONY UPSTREAM
// ============================================================

const UPSTREAM_HEADERS = {
  Referer: "https://www.sonyliv.com/",
  Origin: "https://www.sonyliv.com",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:155.0) Gecko/20100101 Firefox/155.0"
};

// ============================================================
// ALLOWED HOSTS
// ============================================================
//
// Start with the hosts from STREAM_URL_1...STREAM_URL_10.
// If the CDN redirects, the redirected host is also allowed.
// ============================================================

const allowedHosts = new Set();

for (const url of STREAM_URLS) {
  try {
    const u = new URL(url);

    if (u.protocol === "https:") {
      allowedHosts.add(u.hostname);
    }
  } catch {
    console.error(`[CONFIG] Invalid stream URL: ${url}`);
  }
}

// ============================================================
// CHECK UPSTREAM URL
// ============================================================

function assertAllowedUpstream(url) {
  const u = new URL(url);

  if (u.protocol !== "https:") {
    throw new Error("Only HTTPS upstream URLs are allowed");
  }

  if (!allowedHosts.has(u.hostname)) {
    throw new Error(
      `Upstream host is not allowed: ${u.hostname}`
    );
  }

  return u;
}

// ============================================================
// CREATE OUR PROXY URL
// ============================================================

function proxyUrlFor(upstreamUrl, req) {
  return (
    `${req.protocol}://${req.get("host")}` +
    `/hls-proxy?url=${encodeURIComponent(upstreamUrl)}`
  );
}

// ============================================================
// REWRITE HLS PLAYLIST
// ============================================================

function rewritePlaylist(text, responseUrl, req) {

  // ----------------------------------------------------------
  // Rewrite URI="..."
  //
  // Used by:
  // EXT-X-KEY
  // EXT-X-MAP
  // EXT-X-MEDIA
  // EXT-X-I-FRAMES-ONLY
  // etc.
  // ----------------------------------------------------------

  text = text.replace(
    /URI="([^"]+)"/g,
    (_, uri) => {

      try {
        const absolute = new URL(
          uri,
          responseUrl
        ).toString();

        return `URI="${proxyUrlFor(
          absolute,
          req
        )}"`;

      } catch {
        return `URI="${uri}"`;
      }
    }
  );

  // ----------------------------------------------------------
  // Rewrite normal HLS URLs
  //
  // This catches:
  // variant playlists
  // .ts segments
  // .m4s segments
  // audio
  // subtitles
  // etc.
  // ----------------------------------------------------------

  return text
    .split(/\r?\n/)
    .map(line => {

      const trimmed = line.trim();

      if (
        !trimmed ||
        trimmed.startsWith("#")
      ) {
        return line;
      }

      try {

        const absolute = new URL(
          trimmed,
          responseUrl
        ).toString();

        return proxyUrlFor(
          absolute,
          req
        );

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

  const u = new URL(url);

  console.log(
    `[HLS] GET ${u.href}`
  );

  const response = await fetch(
    u,
    {
      method: "GET",

      headers: UPSTREAM_HEADERS,

      redirect: "follow"
    }
  );

  // ----------------------------------------------------------
  // IMPORTANT:
  //
  // If the CDN redirected to another hostname, allow that
  // hostname for subsequent HLS requests.
  // ----------------------------------------------------------

  try {

    const finalUrl = new URL(
      response.url
    );

    allowedHosts.add(
      finalUrl.hostname
    );

  } catch {}

  console.log(
    `[HLS] ${response.status} ${response.url}`
  );

  return response;
}

// ============================================================
// MANIFEST
// ============================================================

const manifest = {

  id: "community.sonysports.live",

  version: "4.0.0",

  name: CHANNEL_NAME,

  description:
    "Sony Sports live channels",

  resources: [
    "catalog",
    "meta",
    "stream"
  ],

  types: ["tv"],

  idPrefixes: [
    CHANNEL_ID
  ],

  catalogs: [
    {
      type: "tv",

      id:
        "sonysports-catalog",

      name:
        CHANNEL_NAME
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

  description:
    "Sony Sports live"
};

// ============================================================
// CORS
// ============================================================

app.use(
  (req, res, next) => {

    res.set(
      "Access-Control-Allow-Origin",
      "*"
    );

    res.set(
      "Access-Control-Allow-Headers",
      "*"
    );

    res.set(
      "Access-Control-Allow-Methods",
      "GET,HEAD,OPTIONS"
    );

    if (
      req.method === "OPTIONS"
    ) {
      return res.sendStatus(204);
    }

    next();
  }
);

// ============================================================
// ROOT
// ============================================================

app.get(
  "/",
  (req, res) => {
    res.redirect(
      "/manifest.json"
    );
  }
);

// ============================================================
// MANIFEST
// ============================================================

app.get(
  "/manifest.json",
  (req, res) => {
    res.json(
      manifest
    );
  }
);

// ============================================================
// CATALOG
// ============================================================

app.get(
  [
    "/catalog/tv/:id.json",
    "/catalog/tv/:id/:extra.json"
  ],

  (req, res) => {

    res.json({

      metas:
        req.params.id ===
        "sonysports-catalog"

          ? [meta]

          : []
    });
  }
);

// ============================================================
// META
// ============================================================

app.get(
  "/meta/tv/:id.json",

  (req, res) => {

    res.json(

      req.params.id ===
      CHANNEL_ID

        ? { meta }

        : {
            meta: null
          }

    );
  }
);

// ============================================================
// STREAMS
// ============================================================
//
// Every STREAM_URL_n is converted to:
//
// https://YOUR-RENDER-APP.onrender.com/hls-proxy?url=...
//
// So Stremio NEVER directly accesses the Sony CDN.
//
// ============================================================

app.get(
  "/stream/tv/:id.json",

  (req, res) => {

    res.set(
      "Cache-Control",
      "no-store"
    );

    if (
      req.params.id !==
      CHANNEL_ID
    ) {

      return res.json({
        streams: []
      });

    }

    const streams =
      STREAM_URLS.map(
        (url, index) => {

          const proxyUrl =
            proxyUrlFor(
              url,
              req
            );

          console.log(
            `[STREAM] ${index + 1}: ${proxyUrl}`
          );

          return {

            name:
              `${CHANNEL_NAME} ${index + 1}`,

            title:
              STREAM_TITLE,

            url:
              proxyUrl,

            behaviorHints: {

              notWebReady:
                true

            }

          };

        }
      );

    console.log(
      `[STREAM] Returning ${streams.length} streams`
    );

    res.json({
      streams
    });

  }
);

// ============================================================
// HLS PROXY
// ============================================================

app.get(
  "/hls-proxy",

  async (req, res) => {

    try {

      if (
        typeof req.query.url !==
        "string"
      ) {

        return res
          .status(400)
          .send(
            "Missing url"
          );

      }

      const requestedUrl =
        req.query.url;

      // ------------------------------------------------------
      // Validate URL.
      //
      // If this is a configured stream host, it's allowed.
      // Child playlist/segment URLs from the same CDN host
      // are also allowed.
      // ------------------------------------------------------

      const target =
        assertAllowedUpstream(
          requestedUrl
        );

      const upstreamResponse =
        await fetchUpstream(
          target.toString()
        );

      // ------------------------------------------------------
      // UPSTREAM ERROR
      // ------------------------------------------------------

      if (
        !upstreamResponse.ok
      ) {

        const body =
          await upstreamResponse
            .text()
            .catch(
              () => ""
            );

        console.error(
          `[HLS] upstream error ` +
          `${upstreamResponse.status}: ` +
          `${body.slice(0, 500)}`
        );

        return res
          .status(
            upstreamResponse.status
          )
          .send(
            `Upstream returned HTTP ` +
            `${upstreamResponse.status}`
          );

      }

      const contentType =
        upstreamResponse
          .headers
          .get(
            "content-type"
          ) || "";

      // ------------------------------------------------------
      // PLAYLIST
      // ------------------------------------------------------

      const looksLikePlaylist =
        contentType
          .toLowerCase()
          .includes(
            "mpegurl"
          ) ||

        target.pathname
          .toLowerCase()
          .endsWith(
            ".m3u8"
          );

      if (
        looksLikePlaylist
      ) {

        const text =
          await upstreamResponse
            .text();

        const rewritten =
          rewritePlaylist(
            text,

            // Use the FINAL URL because
            // the CDN may have redirected.
            upstreamResponse.url,

            req
          );

        res.status(200);

        res.set(
          "Content-Type",
          "application/vnd.apple.mpegurl"
        );

        res.set(
          "Cache-Control",
          "no-store"
        );

        return res.send(
          rewritten
        );
      }

      // ------------------------------------------------------
      // SEGMENTS / AUDIO / VIDEO / KEYS
      // ------------------------------------------------------

      const buffer =
        Buffer.from(
          await upstreamResponse
            .arrayBuffer()
        );

      if (
        contentType
      ) {

        res.set(
          "Content-Type",
          contentType
        );

      }

      res.set(
        "Cache-Control",
        "no-store"
      );

      res.set(
        "Accept-Ranges",
        "bytes"
      );

      return res
        .status(200)
        .send(buffer);

    } catch (err) {

      console.error(
        "[HLS] proxy error:",
        err
      );

      return res
        .status(502)
        .send(
          `HLS proxy error: ${err.message}`
        );

    }

  }
);

// ============================================================
// TEST STREAM
// ============================================================

app.get(
  "/test-stream",

  async (req, res) => {

    try {

      const results =
        await Promise.all(
          STREAM_URLS.map(
            async (url, index) => {

              try {

                const response =
                  await fetchUpstream(
                    url
                  );

                const contentType =
                  response
                    .headers
                    .get(
                      "content-type"
                    ) || "";

                return {

                  number:
                    index + 1,

                  status:
                    response.status,

                  contentType,

                  finalUrl:
                    response.url,

                  ok:
                    response.ok

                };

              } catch (err) {

                return {

                  number:
                    index + 1,

                  ok:
                    false,

                  error:
                    err.message

                };

              }

            }
          )
        );

      res.json({
        streamCount:
          STREAM_URLS.length,

        streams:
          results
      });

    } catch (err) {

      res.status(500).json({
        error:
          err.message
      });

    }

  }
);

// ============================================================
// HEALTH
// ============================================================

app.get(
  "/health",

  (req, res) => {

    res.json({

      ok: true,

      addon:
        CHANNEL_NAME,

      streamCount:
        STREAM_URLS.length,

      streams:
        STREAM_URLS.map(
          (url, index) => ({

            number:
              index + 1,

            configured:
              Boolean(url)

          })
        )

    });

  }
);

// ============================================================
// 404
// ============================================================

app.use(
  (req, res) => {

    res.status(404).json({

      error:
        "Not found"

    });

  }
);

// ============================================================
// ERROR HANDLER
// ============================================================

app.use(
  (
    err,
    req,
    res,
    next
  ) => {

    console.error(
      err
    );

    res.status(500).json({

      error:
        "Internal error"

    });

  }
);

// ============================================================
// START
// ============================================================

app.listen(
  PORT,
  "0.0.0.0",

  () => {

    console.log(
      `Sony Sports Stremio addon listening on port ${PORT}`
    );

    console.log(
      `Configured streams: ${STREAM_URLS.length}`
    );

    STREAM_URLS.forEach(
      (url, index) => {

        console.log(
          `Stream ${index + 1}: ${url}`
        );

      }
    );

  }
);
