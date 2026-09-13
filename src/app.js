/**
 * GusTV front-end — simple version.
 * Fetches a channel catalog, parses it, and shows one flat alphabetical
 * list with search. No countries, no categories, no recording — just pick
 * a channel and watch.
 *
 * Extras: a Next-channel button, automatic skip-to-next when a channel
 * fails to load, and a loading-progress indicator tied to real HLS load
 * milestones (there's no true byte-progress for a live stream, so this
 * marks concrete stages instead of faking a smooth animation).
 *
 * Channel source: US channels that are ALSO tagged English — the
 * intersection of iptv-org's own pre-built "United States" and "English"
 * playlists, matched by stream URL (iptv-org's country list alone
 * includes ~184 non-English US channels, e.g. Spanish-language US
 * networks like Telemundo/Univision affiliates, so country alone isn't
 * enough). Both source lists come straight from iptv-org's GitHub Pages
 * rather than the gusyj/GusTV fork, so there's nothing to sync. Comes out
 * to roughly 1,293 channels. To use a different country/language
 * combination, or the full multi-language catalog from the fork instead,
 * see iptv-org's generated playlists: https://github.com/iptv-org/iptv/blob/master/PLAYLISTS.md
 */
import "./main.css";

const US_PLAYLIST_URL = "https://iptv-org.github.io/iptv/countries/us.m3u";
const ENGLISH_PLAYLIST_URL = "https://iptv-org.github.io/iptv/languages/eng.m3u";

// Auto-skip stops after this many consecutive dead channels, so a fully
// dead catalog subset can't loop forever.
const MAX_AUTO_SKIPS = 25;

(async function () {
  const video = document.getElementById("player");
  const nowPlaying = document.getElementById("now-playing");
  const channelList = document.getElementById("channel-list");
  const searchInput = document.getElementById("search");
  const searchForm = document.getElementById("search-form");
  const nextBtn = document.getElementById("next-btn");
  const progressWrap = document.getElementById("load-progress");
  const progressBar = document.getElementById("load-progress-bar");

  let channels = [];
  let currentList = []; // whatever's currently filtered/rendered
  let currentIndex = -1; // position of the playing channel within currentList
  let hls = null;
  let autoSkipStreak = 0;

  // Parses standard #EXTM3U / #EXTINF playlist text into {name, url} pairs.
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

  // blocklist.json is produced by checker.html (run manually in a browser —
  // see that file) and lists stream URLs confirmed dead. Missing/unreadable
  // is fine; it just means nothing gets filtered.
  async function loadBlocklist() {
    try {
      const res = await fetch("blocklist.json", { cache: "no-store" });
      if (!res.ok) return new Set();
      const data = await res.json();
      return new Set(data.dead_urls || []);
    } catch {
      return new Set();
    }
  }

  async function loadChannels() {
    nowPlaying.textContent = "Loading channel list…";
    try {
      const [usRes, engRes] = await Promise.all([
        fetch(US_PLAYLIST_URL, { cache: "no-store" }),
        fetch(ENGLISH_PLAYLIST_URL, { cache: "no-store" }),
      ]);
      if (!usRes.ok) throw new Error(`US list HTTP ${usRes.status}`);
      if (!engRes.ok) throw new Error(`English list HTTP ${engRes.status}`);

      const usChannels = parseM3U(await usRes.text());
      const englishChannels = parseM3U(await engRes.text());
      const englishUrls = new Set(englishChannels.map((c) => c.url));

      channels = usChannels.filter((c) => englishUrls.has(c.url));
      if (!channels.length) throw new Error("Parsed 0 channels after US ∩ English filter");
    } catch (err) {
      console.warn("Falling back to bundled channels.json —", err.message);
      const res = await fetch("channels.json");
      const fallback = await res.json();
      channels = fallback.map((c) => ({ name: c.name, url: c.url }));
    }

    const blocked = await loadBlocklist();
    const beforeCount = channels.length;
    if (blocked.size) {
      channels = channels.filter((c) => !blocked.has(c.url));
    }

    channels.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    const filteredNote = blocked.size ? ` (${(beforeCount - channels.length).toLocaleString()} known-dead filtered out)` : "";
    nowPlaying.textContent = `Loaded ${channels.length.toLocaleString()} channels${filteredNote}. Select one to start watching.`;
    renderChannels();
  }

  function renderChannels(filterText = "") {
    const query = filterText.trim().toLowerCase();
    currentList = channels.filter((c) => !query || c.name.toLowerCase().includes(query));
    currentIndex = -1;

    const fragment = document.createDocumentFragment();
    currentList.forEach((channel, index) => {
      const li = document.createElement("li");
      li.className = "channel-row";
      li.textContent = channel.name;
      li.addEventListener("click", () => playChannelAt(index, { auto: false }));
      fragment.appendChild(li);
    });
    channelList.innerHTML = "";
    channelList.appendChild(fragment);
  }

  function setActiveListItem(index) {
    const items = channelList.querySelectorAll("li");
    items.forEach((el) => el.classList.remove("active"));
    if (items[index]) {
      items[index].classList.add("active");
      items[index].scrollIntoView({ block: "nearest" });
    }
  }

  function showProgress(pct, label) {
    progressWrap.hidden = false;
    progressBar.style.width = `${pct}%`;
    progressBar.textContent = label ? `${label} (${pct}%)` : `${pct}%`;
  }

  function hideProgress() {
    progressWrap.hidden = true;
    progressBar.style.width = "0%";
    progressBar.textContent = "";
  }

  // Plays the channel at `index` in currentList. `auto: true` means this
  // call came from auto-skip-on-failure rather than a direct user click,
  // which is what lets failures chain into the next attempt automatically.
  function playChannelAt(index, { auto = false } = {}) {
    if (!currentList.length) return;
    // Wrap around so Next past the end loops back to the start.
    const wrapped = ((index % currentList.length) + currentList.length) % currentList.length;
    const channel = currentList[wrapped];
    currentIndex = wrapped;
    setActiveListItem(wrapped);

    if (hls) {
      hls.destroy();
      hls = null;
    }

    let settled = false;
    showProgress(5, "Connecting");

    const markOffline = (reason) => {
      if (settled) return;
      settled = true;
      hideProgress();
      nowPlaying.textContent = `"${channel.name}" looks offline right now (${reason}) — skipping to the next channel…`;

      autoSkipStreak += 1;
      if (autoSkipStreak >= MAX_AUTO_SKIPS || autoSkipStreak >= currentList.length) {
        nowPlaying.textContent = `Tried ${autoSkipStreak} channels in a row with no luck — pick one manually to keep going.`;
        autoSkipStreak = 0;
        return;
      }
      setTimeout(() => playChannelAt(currentIndex + 1, { auto: true }), 600);
    };
    const markPlaying = () => {
      settled = true;
      autoSkipStreak = 0;
      showProgress(100, "Playing");
      setTimeout(hideProgress, 600);
      nowPlaying.textContent = `Now playing: ${channel.name}`;
    };
    const stallTimer = setTimeout(() => markOffline("timed out"), 20000);

    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls();
      hls.loadSource(channel.url);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_LOADING, () => showProgress(20, "Loading channel"));
      hls.on(window.Hls.Events.MANIFEST_LOADED, () => showProgress(45, "Reading stream info"));
      hls.on(window.Hls.Events.LEVEL_LOADED, () => showProgress(65, "Buffering"));
      hls.on(window.Hls.Events.FRAG_LOADED, () => showProgress(85, "Buffering"));
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        clearTimeout(stallTimer);
        video.play();
        markPlaying();
      });
      let triedRecovery = false;
      hls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;

        // hls.js can report a "fatal" network/media error on the very first
        // attempt even when the stream is actually fine (a slow first
        // response, a single dropped segment). Give it one recovery attempt
        // before writing the channel off, per hls.js's own recommended
        // pattern — this is likely why channels were getting skipped before
        // they'd had a real chance to load.
        if (!triedRecovery && data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          triedRecovery = true;
          hls.startLoad();
          return;
        }
        if (!triedRecovery && data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          triedRecovery = true;
          hls.recoverMediaError();
          return;
        }

        clearTimeout(stallTimer);
        markOffline(data.details || "stream error");
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = channel.url;
      showProgress(40, "Loading channel");
      video.addEventListener("loadedmetadata", () => {
        showProgress(85, "Buffering");
      }, { once: true });
      video.addEventListener("playing", () => {
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
      hideProgress();
      nowPlaying.textContent = `Your browser can't play HLS streams directly. Try VLC with: ${channel.url}`;
    }
  }

  nextBtn.addEventListener("click", () => {
    autoSkipStreak = 0; // manual click resets the auto-skip budget
    playChannelAt(currentIndex + 1, { auto: false });
  });

  searchInput.addEventListener("input", (e) => renderChannels(e.target.value));

  // The search button/form submit does the same live filter — it mainly
  // exists so a tap on mobile has an explicit target and dismisses the
  // on-screen keyboard, since the list already filters as you type.
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    renderChannels(searchInput.value);
    searchInput.blur();
  });

  await loadChannels();
})();
