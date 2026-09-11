/**
 * GusTV front-end
 * Loads channels.json, renders category + channel lists, and plays the
 * selected stream with hls.js (falling back to native HLS on Safari/iOS).
 */
(async function () {
  const video = document.getElementById("player");
  const nowPlaying = document.getElementById("now-playing");
  const categoryList = document.getElementById("category-list");
  const channelList = document.getElementById("channel-list");
  const searchInput = document.getElementById("search");

  let channels = [];
  let activeGroup = "All";
  let hls = null;

  async function loadChannels() {
    const res = await fetch("channels.json");
    channels = await res.json();
  }

  function groups() {
    const set = new Set(channels.map((c) => c.group || "Uncategorized"));
    return ["All", ...Array.from(set).sort()];
  }

  function renderCategories() {
    categoryList.innerHTML = "";
    groups().forEach((group) => {
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
      .filter((c) => activeGroup === "All" || c.group === activeGroup)
      .filter((c) => !query || c.name.toLowerCase().includes(query))
      .forEach((channel) => {
        const li = document.createElement("li");
        li.textContent = channel.name;
        li.title = channel.note || "";
        li.addEventListener("click", () => playChannel(channel, li));
        channelList.appendChild(li);
      });
  }

  function playChannel(channel, li) {
    document
      .querySelectorAll("#channel-list li")
      .forEach((el) => el.classList.remove("active"));
    li.classList.add("active");

    nowPlaying.textContent = `Now playing: ${channel.name}`;

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

  searchInput.addEventListener("input", (e) => renderChannels(e.target.value));

  await loadChannels();
  renderCategories();
  renderChannels();
})();
