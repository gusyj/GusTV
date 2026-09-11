/**
 * GusTV front-end
 * Pulls the real, full channel catalog live from index.m3u in the GitHub
 * repo (so this app can be hosted anywhere — Netlify, Vercel, etc. — while
 * GitHub stays the single source of truth), parses it into channel
 * objects with a derived country, renders country + category filters and
 * a channel list, plays the selected stream with hls.js (falling back to
 * native HLS on Safari/iOS), and can record the currently playing stream
 * to a local file via MediaRecorder.
 */

// --- Where the channel data lives ---
// Update these to match your GitHub username/repo/branch if you fork this.
// GitHub Pages serves files with CORS enabled, so a fetch from any host
// (Netlify, Vercel, wherever) works without extra configuration.
const GITHUB_USER = "gusyj";
const GITHUB_REPO = "GusTV";
const GITHUB_BRANCH = "master";
const PLAYLIST_URL = `https://${GITHUB_USER}.github.io/${GITHUB_REPO}/index.m3u`;

(async function () {
  const video = document.getElementById("player");
  const nowPlaying = document.getElementById("now-playing");
  const countryList = document.getElementById("country-list");
  const categoryList = document.getElementById("category-list");
  const channelList = document.getElementById("channel-list");
  const searchInput = document.getElementById("search");
  const recordBtn = document.getElementById("record-btn");
  const recordTimer = document.getElementById("record-timer");

  let channels = [];
  let activeCountry = "All";
  let activeGroup = "All";
  let activeChannel = null;
  let hls = null;

  // --- Recording state ---
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordStartTime = null;
  let recordTimerInterval = null;

  const countryNamer = (function () {
    try {
      const dn = new Intl.DisplayNames(["en"], { type: "region" });
      return (code) => dn.of(code) || code;
    } catch {
      return (code) => code;
    }
  })();

  // Parses standard #EXTM3U / #EXTINF playlist text into channel objects.
  //
  // This particular catalog's tvg-id looks like "ChannelName.countrycode@quality"
  // (e.g. "AndTV.in@International", "red.ru@SD") — the "@quality" suffix has
  // to be stripped before the trailing ".countrycode" is readable. There's
  // no group-title or tvg-country attribute anywhere in this file (checked
  // directly), so: country comes from the id suffix, and since there's no
  // real category data to show, the quality tag doubles as "category" so
  // the sidebar has something meaningful instead of one giant "Uncategorized" bucket.
  function parseM3U(text) {
    const lines = text.split(/\r?\n/);
    const result = [];
    let pending = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith("#EXTINF")) {
        const attrs = {};
        const attrRe = /([\w-]+)="([^"]*)"/g;
        let m;
        while ((m = attrRe.exec(line))) attrs[m[1]] = m[2];

        const nameMatch = line.match(/,(.*)$/);
        const name = nameMatch ? nameMatch[1].trim() : attrs["tvg-id"] || "Unknown channel";

        const tvgId = attrs["tvg-id"] || "";
        const [idBase, quality] = tvgId.split("@");
        const idParts = (idBase || "").split(".");
        const lastPart = idParts.length > 1 ? idParts[idParts.length - 1] : "";
        const isCountryCode = /^[a-z]{2}$/i.test(lastPart);
        const countryCode = isCountryCode ? lastPart.toUpperCase() : "";
        const country = countryCode ? countryNamer(countryCode) : "International / Other";

        pending = {
          id: tvgId || name,
          name,
          group: attrs["group-title"] || quality || "Uncategorized",
          logo: attrs["tvg-logo"] || "",
          country,
          country_code: countryCode,
        };
      } else if (!line.startsWith("#") && pending) {
        pending.url = line;
        result.push(pending);
        pending = null;
      }
    }
    return result;
  }

  async function loadChannels() {
    nowPlaying.textContent = "Loading global channel list…";
    try {
      const res = await fetch(PLAYLIST_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`GitHub Pages fetch failed: HTTP ${res.status}`);
      const text = await res.text();
      channels = parseM3U(text);
      if (!channels.length) throw new Error("Parsed 0 channels from index.m3u");
    } catch (err) {
      console.warn("Falling back to bundled channels.json —", err.message);
      // Fallback so the app still works if GitHub Pages is unreachable,
      // the repo/branch was renamed, or you're testing locally.
      const res = await fetch("channels.json");
      channels = await res.json();
    }
    channels.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    nowPlaying.textContent = `Loaded ${channels.length.toLocaleString()} channels. Select one to start watching.`;
  }

  function uniqueSorted(values) {
    return Array.from(new Set(values)).sort();
  }

  function countries() {
    return ["All", ...uniqueSorted(channels.map((c) => c.country || "Unassigned"))];
  }

  function groupsFor(country) {
    const pool = channels.filter((c) => country === "All" || c.country === country);
    return ["All", ...uniqueSorted(pool.map((c) => c.group || "Uncategorized"))];
  }

  function flagEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) return "🌐";
    const upper = countryCode.toUpperCase();
    const codePoints = [...upper].map((ch) => 0x1f1e6 - 65 + ch.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  }

  function renderCountries() {
    countryList.innerHTML = "";
    countries().forEach((country) => {
      const sample = channels.find((c) => c.country === country);
      const flag = country === "All" ? "🌍" : flagEmoji(sample && sample.country_code);
      const li = document.createElement("li");
      li.textContent = `${flag}  ${country}`;
      if (country === activeCountry) li.classList.add("active");
      li.addEventListener("click", () => {
        activeCountry = country;
        activeGroup = "All";
        renderCountries();
        renderCategories();
        renderChannels(searchInput.value);
      });
      countryList.appendChild(li);
    });
  }

  function renderCategories() {
    categoryList.innerHTML = "";
    groupsFor(activeCountry).forEach((group) => {
      const li = document.createElement("li");
      li.textContent = group;
      if (group === activeGroup) li.classList.add("active");
      li.addEventListener("click", () => {
        activeGroup = group;
        renderCategories();
        renderChannels(searchInput.value);
      });
      categoryList.appendChild(li);
    });
  }

  // channels is kept globally sorted alphabetically (see loadChannels), so
  // every filtered view below is already in A-Z order — no pagination, the
  // whole matching set renders every time.
  function renderChannels(filterText = "") {
    const query = filterText.trim().toLowerCase();

    const matches = channels
      .filter((c) => activeCountry === "All" || c.country === activeCountry)
      .filter((c) => activeGroup === "All" || c.group === activeGroup)
      .filter((c) => !query || c.name.toLowerCase().includes(query));

    // Build off-DOM, then attach once — much faster than appendChild-ing
    // one at a time when the list can run into the thousands.
    const fragment = document.createDocumentFragment();
    matches.forEach((channel) => {
      const li = document.createElement("li");
      li.textContent = `${flagEmoji(channel.country_code)}  ${channel.name}`;
      li.title = channel.note || "";
      li.addEventListener("click", () => playChannel(channel, li));
      fragment.appendChild(li);
    });
    channelList.innerHTML = "";
    channelList.appendChild(fragment);
  }

  function playChannel(channel, li) {
    stopRecording(); // never carry a recording across a channel switch

    document
      .querySelectorAll("#channel-list li")
      .forEach((el) => el.classList.remove("active"));
    li.classList.add("active");

    activeChannel = channel;
    nowPlaying.textContent = `Now playing: ${channel.name}`;
    recordBtn.disabled = false;

    if (hls) {
      hls.destroy();
      hls = null;
    }

    // Many links in this catalog are simply offline at any given moment —
    // that's a property of the data, not this app. Rather than spin
    // forever, say so plainly after a short timeout or on a hard error.
    let settled = false;
    const markOffline = (reason) => {
      if (settled) return;
      settled = true;
      nowPlaying.textContent = `"${channel.name}" looks offline right now (${reason}) — try another channel.`;
    };
    const markPlaying = () => {
      settled = true;
      nowPlaying.textContent = `Now playing: ${channel.name}`;
    };
    const stallTimer = setTimeout(() => markOffline("timed out"), 12000);

    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls();
      hls.loadSource(channel.url);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        clearTimeout(stallTimer);
        video.play();
        markPlaying();
      });
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          clearTimeout(stallTimer);
          markOffline(data.details || "stream error");
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native HLS support (Safari/iOS)
      video.src = channel.url;
      video.addEventListener("loadedmetadata", () => {
        clearTimeout(stallTimer);
        markPlaying();
      }, { once: true });
      video.addEventListener("error", () => {
        clearTimeout(stallTimer);
        markOffline("playback error");
      }, { once: true });
      video.play();
    } else {
      clearTimeout(stallTimer);
      nowPlaying.textContent = `Your browser can't play HLS streams directly. Try VLC with: ${channel.url}`;
    }
  }

  // --- Recording: captures the <video> element's own output stream and
  // saves it as a local .webm file via a browser download, entirely
  // client-side (nothing is uploaded anywhere). ---

  function pickRecorderMimeType() {
    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    return candidates.find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || "";
  }

  function startRecording() {
    if (!activeChannel) return;
    if (typeof video.captureStream !== "function" && typeof video.mozCaptureStream !== "function") {
      alert("This browser doesn't support capturing video for local recording. Try a recent Chrome, Edge, or Firefox.");
      return;
    }

    const stream = (video.captureStream || video.mozCaptureStream).call(video);
    const mimeType = pickRecorderMimeType();
    recordedChunks = [];

    try {
      mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (err) {
      alert(`Couldn't start the recorder: ${err.message}`);
      return;
    }

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: mimeType || "video/webm" });
      const url = URL.createObjectURL(blob);
      const safeName = activeChannel.name.replace(/[^a-z0-9]+/gi, "-");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeName}-${timestamp}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    };

    mediaRecorder.start();
    recordStartTime = Date.now();
    recordTimer.hidden = false;
    recordTimerInterval = setInterval(updateRecordTimer, 1000);
    updateRecordTimer();

    recordBtn.textContent = "⏹ Stop & save recording";
    recordBtn.classList.add("recording");
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    mediaRecorder = null;
    clearInterval(recordTimerInterval);
    recordTimerInterval = null;
    recordTimer.hidden = true;
    recordBtn.textContent = "⏺ Start recording";
    recordBtn.classList.remove("recording");
  }

  function updateRecordTimer() {
    const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    recordTimer.textContent = `${mm}:${ss}`;
  }

  recordBtn.addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      stopRecording();
    } else {
      startRecording();
    }
  });

  searchInput.addEventListener("input", (e) => renderChannels(e.target.value));

  await loadChannels();
  renderCountries();
  renderCategories();
  renderChannels();
})();
