/**
 * GusTV front-end — simple version.
 * Fetches the real channel catalog from GitHub Pages, parses it, and shows
 * one flat alphabetical list with search. No countries, no categories, no
 * recording — just pick a channel and watch.
 */

const GITHUB_USER = "gusyj";
const GITHUB_REPO = "GusTV";
const GITHUB_BRANCH = "master";
const PLAYLIST_URL = `https://${GITHUB_USER}.github.io/${GITHUB_REPO}/index.m3u`;

(async function () {
  const video = document.getElementById("player");
  const nowPlaying = document.getElementById("now-playing");
  const channelList = document.getElementById("channel-list");
  const searchInput = document.getElementById("search");

  let channels = [];
  let hls = null;

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

  async function loadChannels() {
    nowPlaying.textContent = "Loading channel list…";
    try {
      const res = await fetch(PLAYLIST_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      channels = parseM3U(text);
      if (!channels.length) throw new Error("Parsed 0 channels");
    } catch (err) {
      console.warn("Falling back to bundled channels.json —", err.message);
      const res = await fetch("channels.json");
      const fallback = await res.json();
      channels = fallback.map((c) => ({ name: c.name, url: c.url }));
    }
    channels.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    nowPlaying.textContent = `Loaded ${channels.length.toLocaleString()} channels. Select one to start watching.`;
    renderChannels();
  }

  function renderChannels(filterText = "") {
    const query = filterText.trim().toLowerCase();
    const matches = channels.filter((c) => !query || c.name.toLowerCase().includes(query));

    const fragment = document.createDocumentFragment();
    matches.forEach((channel) => {
      const li = document.createElement("li");
      li.textContent = channel.name;
      li.addEventListener("click", () => playChannel(channel, li));
      fragment.appendChild(li);
    });
    channelList.innerHTML = "";
    channelList.appendChild(fragment);
  }

  function playChannel(channel, li) {
    document.querySelectorAll("#channel-list li").forEach((el) => el.classList.remove("active"));
    li.classList.add("active");

    if (hls) {
      hls.destroy();
      hls = null;
    }

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

  searchInput.addEventListener("input", (e) => renderChannels(e.target.value));

  await loadChannels();
})();
