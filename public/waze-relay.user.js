// ==UserScript==
// @name         TeslaNav Waze Relay
// @namespace    https://teslanav.com
// @version      2.0.0
// @description  Fetches Waze alerts inside waze.com and relays them to your self-hosted TeslaNav instance.
// @match        https://www.waze.com/live-map*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      *
// @run-at       document-idle
// ==/UserScript==

/**
 * How it works:
 *
 * Waze's georss API requires a reCAPTCHA Enterprise token minted on waze.com
 * PLUS this browser's (httpOnly) session cookies - so the fetch can only
 * happen right here in the page. This script:
 *
 *   1. Asks your TeslaNav server which map bounds it needs (every 15s)
 *   2. Generates a fresh reCAPTCHA token and fetches georss for those bounds
 *      on waze.com (cookies ride along automatically)
 *   3. POSTs the resulting alert JSON back to your server
 *
 * Only alert data ever leaves the browser - tokens and cookies stay here.
 *
 * Setup:
 *   1. Install Tampermonkey in a browser that can stay open on
 *      https://www.waze.com/live-map (a desktop/laptop that is always on).
 *   2. Install this script, then run "TeslaNav: Configure" from the
 *      Tampermonkey menu and enter your TeslaNav URL and WAZE_RELAY_SECRET.
 *   3. Leave the tab open. Alerts stay ~15-45s fresh.
 */

(function () {
  "use strict";

  const RECAPTCHA_SITE_KEY = "6Lf4WdUqAAAAAEUYUvzyLYIkO3PoFAqi8ZHGiDLW";
  const RECAPTCHA_ACTION = "api";
  const POLL_INTERVAL_MS = 15 * 1000;
  const MAX_PENDING_AGE_MS = 90 * 1000; // ignore bounds older than this (nobody watching)
  const pageWindow = typeof unsafeWindow === "undefined" ? window : unsafeWindow;

  function getConfig() {
    return {
      url: (GM_getValue("teslanav_url") || "").replace(/\/+$/, ""),
      secret: GM_getValue("teslanav_secret") || "",
    };
  }

  function configure() {
    const current = getConfig();
    const url = prompt(
      "TeslaNav base URL (e.g. http://192.168.1.10:3000):",
      current.url || "http://localhost:3000"
    );
    if (url === null) return;
    const secret = prompt("WAZE_RELAY_SECRET (from your TeslaNav server env):", current.secret || "");
    if (secret === null) return;
    GM_setValue("teslanav_url", url.trim());
    GM_setValue("teslanav_secret", secret.trim());
    setStatus("configured", true);
  }

  GM_registerMenuCommand("TeslaNav: Configure", configure);

  // Tiny status pill so you can see the relay is alive
  const pill = document.createElement("div");
  pill.style.cssText =
    "position:fixed;bottom:8px;right:8px;z-index:99999;padding:4px 10px;border-radius:10px;" +
    "font:12px/1.4 system-ui,sans-serif;color:#fff;background:#666;opacity:0.85;pointer-events:none;";
  pill.textContent = "TeslaNav relay: idle";
  document.body.appendChild(pill);

  function setStatus(text, ok) {
    pill.textContent = `TeslaNav relay: ${text}`;
    pill.style.background = ok === undefined ? "#666" : ok ? "#2e7d32" : "#c62828";
  }

  function gmRequest({ method, url, secret, data }) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        data: data ? JSON.stringify(data) : undefined,
        onload: (res) => resolve(res),
        onerror: (err) => reject(err),
      });
    });
  }

  async function getPendingBounds(config) {
    const res = await gmRequest({
      method: "GET",
      url: `${config.url}/api/waze/relay`,
      secret: config.secret,
    });
    if (res.status !== 200) throw new Error(`relay request HTTP ${res.status}`);
    const body = JSON.parse(res.responseText);
    if (!body.bounds) return null;
    if (body.requestedAt && Date.now() - body.requestedAt > MAX_PENDING_AGE_MS) {
      return null; // stale - nobody actively watching
    }
    return body.bounds;
  }

  async function fetchGeorss(bounds) {
    const centerLon = (parseFloat(bounds.left) + parseFloat(bounds.right)) / 2;
    const env = centerLon >= -170 && centerLon <= -30 ? "na" : "row";
    const params = new URLSearchParams({
      top: bounds.top,
      bottom: bounds.bottom,
      left: bounds.left,
      right: bounds.right,
      env,
      types: "alerts",
    });
    const token = await pageWindow.grecaptcha.enterprise.execute(RECAPTCHA_SITE_KEY, {
      action: RECAPTCHA_ACTION,
    });
    const resp = await fetch(`/live-map/api/georss?${params}`, {
      headers: {
        accept: "application/json, text/plain, */*",
        "x-recaptcha-token": token,
      },
    });
    if (!resp.ok) throw new Error(`georss HTTP ${resp.status}`);
    return resp.json();
  }

  let running = false;

  async function tick() {
    if (running) return; // don't overlap ticks
    running = true;
    try {
      const config = getConfig();
      if (!config.url || !config.secret) {
        setStatus("not configured - use TM menu", false);
        return;
      }
      if (!pageWindow.grecaptcha?.enterprise) {
        setStatus("reCAPTCHA not ready", false);
        return;
      }

      const bounds = await getPendingBounds(config);
      if (!bounds) {
        setStatus(`idle ${new Date().toLocaleTimeString()}`, undefined);
        return;
      }

      const data = await fetchGeorss(bounds);

      const res = await gmRequest({
        method: "POST",
        url: `${config.url}/api/waze/relay`,
        secret: config.secret,
        data: { ...bounds, data },
      });
      if (res.status !== 200) throw new Error(`relay POST HTTP ${res.status}`);

      const count = (data.alerts || []).length;
      setStatus(`${count} alerts ${new Date().toLocaleTimeString()}`, true);
    } catch (err) {
      setStatus(`error: ${String(err).slice(0, 50)}`, false);
    } finally {
      running = false;
    }
  }

  // First tick after the page settles, then on the interval
  setTimeout(tick, 8000);
  setInterval(tick, POLL_INTERVAL_MS);
})();
