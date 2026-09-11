/**
 * GusTV front-end
 * Pulls channels.json live from the GitHub repo (so this app can be hosted
 * anywhere — Netlify, Vercel, etc. — while the GitHub repo stays the single
 * source of truth for the channel list), renders country + category
 * filters and a channel list, plays the selected stream with hls.js
 * (falling back to native HLS on Safari/iOS), and can record the currently
 * playing stream to a local file via MediaRecorder.
 */

// --- Where the channel data lives ---
// Update these two values to match your GitHub username/repo/branch.
// raw.githubusercontent.com serves the file with CORS enabled and no
// caching games, so a fetch from any host (Netlify, Vercel, wherever)
// works without extra configuration.
const GITHUB_USER = "gusyj";
const GITHUB_REPO = "GusTV";
const GITHUB_BRANCH = "main";
const CHANNELS_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}/channels.json`;

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

  async function loadChannels() {
    try {
      const res = await fetch(CHANNELS_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`GitHub fetch failed: HTTP ${res.status}`);
      channels = await res.json();
    } catch (err) {
      console.warn("Falling back to bundled channels.json —", err.message);
      // Fallback so the app still works if GitHub is unreachable, the repo
      // is renamed, or you're testing locally before it's pushed.
      const res = await fetch("channels.json");
      channels = await res.json();
    }
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

  function renderChannels(filterText = "") {
    const query = filterText.trim().toLowerCase();
    channelList.innerHTML = "";

    channels
      .filter((c) => activeCountry === "All" || c.country === activeCountry)
      .filter((c) => activeGroup === "All" || c.group === activeGroup)
      .filter((c) => !query || c.name.toLowerCase().includes(query))
      .forEach((channel) => {
        const li = document.createElement("li");
        li.textContent = `${flagEmoji(channel.country_code)}  ${channel.name}`;
        li.title = channel.note || "";
        li.addEventListener("click", () => playChannel(channel, li));
        channelList.appendChild(li);
      });
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

    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls();
      hls.loadSource(channel.url);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => video.play());
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native HLS support (Safari/iOS)
      video.src = channel.url;
      video.play();
    } else {
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
