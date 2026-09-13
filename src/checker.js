/**
 * GusTV channel checker — run manually, in a real browser, occasionally.
 *
 * Loads the same index.m3u the main app uses, then probes every stream URL
 * with a short-timeout HEAD (falling back to a ranged GET, since some
 * stream servers reject HEAD) at limited concurrency. Anything that fails
 * outright, times out, or comes back 4xx/5xx is added to a downloadable
 * blocklist.json keyed by URL — the main app's app.js filters out any
 * channel whose URL appears in that file.
 *
 * This has to run in a real browser (not a server / sandbox), because it
 * needs open internet access to the thousands of individual stream hosts.
 */

import "./main.css";

// Keep this in sync with src/app.js's source URLs — the checker should
// validate whatever list the site is actually showing (US channels that
// are also tagged English).
const US_PLAYLIST_URL = "https://iptv-org.github.io/iptv/countries/us.m3u";
const ENGLISH_PLAYLIST_URL = "https://iptv-org.github.io/iptv/languages/eng.m3u";

const CONCURRENCY = 30;
const TIMEOUT_MS = 6000;

const startBtn = document.getElementById("start-btn");
const downloadBtn = document.getElementById("download-btn");
const barInner = document.getElementById("bar-inner");
const statTotal = document.getElementById("stat-total");
const statChecked = document.getElementById("stat-checked");
const statGood = document.getElementById("stat-good");
const statBad = document.getElementById("stat-bad");
const logEl = document.getElementById("log");

let badUrls = [];

function log(line) {
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

// Same parser as the main app.
function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  let pendingName = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      const nameMatch = line.match(/,(.*)$/);
      pendingName = nameMatch ? nameMatch[1].trim() : "Unknown channel";
    } else if (!line.startsWith("#") && pendingName) {
      result.push({ name: pendingName, url: line });
      pendingName = null;
    }
  }
  return result;
}

function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function checkOne(channel) {
  try {
    const res = await fetchWithTimeout(channel.url, { method: "GET", cache: "no-store" }, TIMEOUT_MS);
    return res.ok;
  } catch (err) {
    return false;
  }
}

async function runCheck(channels) {
  let checked = 0;
  let good = 0;
  let bad = 0;
  badUrls = [];

  statTotal.textContent = channels.length.toLocaleString();

  let nextIndex = 0;
  async function worker() {
    while (nextIndex < channels.length) {
      const index = nextIndex++;
      const channel = channels[index];
      const ok = await checkOne(channel);
      checked += 1;
      if (ok) {
        good += 1;
      } else {
        bad += 1;
        badUrls.push(channel.url);
        log(`DEAD  ${channel.name}`);
      }
      statChecked.textContent = checked.toLocaleString();
      statGood.textContent = good.toLocaleString();
      statBad.textContent = bad.toLocaleString();
      barInner.style.width = `${Math.round((checked / channels.length) * 100)}%`;
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, worker);
  await Promise.all(workers);

  log(`\nDone. ${good.toLocaleString()} working, ${bad.toLocaleString()} dead out of ${channels.length.toLocaleString()}.`);
  downloadBtn.disabled = false;
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  log("Loading channel list…");
  const [usRes, engRes] = await Promise.all([
    fetch(US_PLAYLIST_URL, { cache: "no-store" }),
    fetch(ENGLISH_PLAYLIST_URL, { cache: "no-store" }),
  ]);
  const usChannels = parseM3U(await usRes.text());
  const englishChannels = parseM3U(await engRes.text());
  const englishUrls = new Set(englishChannels.map((c) => c.url));
  const channels = usChannels.filter((c) => englishUrls.has(c.url));
  log(`Loaded ${channels.length.toLocaleString()} channels. Checking (this takes a while)…\n`);
  await runCheck(channels);
  startBtn.disabled = false;
});

downloadBtn.addEventListener("click", () => {
  const payload = {
    generated_at: new Date().toISOString(),
    dead_urls: badUrls,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "blocklist.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});
