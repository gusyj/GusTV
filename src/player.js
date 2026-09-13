/**
 * GusTV — Direct URL Player.
 * A VLC "Open Network Stream"-style page: paste any direct stream URL and
 * it plays here, no channel list involved. Shares the same hls.js loading
 * logic (timeout + one retry on fatal errors) as the main app's player, so
 * a link behaves consistently whether you find it through the channel
 * list or paste it in yourself.
 */

import "./main.css";

const LOAD_TIMEOUT_MS = 20000;

(function () {
  const video = document.getElementById("player");
  const status = document.getElementById("status");
  const urlForm = document.getElementById("url-form");
  const urlInput = document.getElementById("url-input");
  const playBtn = document.getElementById("play-btn");
  const progressWrap = document.getElementById("load-progress");
  const progressBar = document.getElementById("load-progress-bar");

  let hls = null;

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

  function playUrl(rawUrl) {
    const url = rawUrl.trim();
    if (!url) return;

    if (hls) {
      hls.destroy();
      hls = null;
    }

    playBtn.disabled = true;
    let settled = false;
    showProgress(5, "Connecting");
    status.textContent = "Connecting…";

    const markOffline = (reason) => {
      if (settled) return;
      settled = true;
      hideProgress();
      playBtn.disabled = false;
      status.textContent = `That link looks offline right now (${reason}). Same link would fail in VLC too — try a different one, or wait and retry.`;
    };
    const markPlaying = () => {
      settled = true;
      playBtn.disabled = false;
      showProgress(100, "Playing");
      setTimeout(hideProgress, 600);
      status.textContent = "Now playing your pasted URL.";
    };
    const stallTimer = setTimeout(() => markOffline("timed out"), LOAD_TIMEOUT_MS);

    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_LOADING, () => showProgress(20, "Loading stream"));
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

        // Same one-shot recovery as the main channel player: hls.js can
        // report "fatal" on the very first attempt even when the stream
        // is fine.
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
      video.src = url;
      showProgress(40, "Loading stream");
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
      playBtn.disabled = false;
      status.textContent = `Your browser can't play HLS streams directly. Try VLC with: ${url}`;
    }
  }

  urlForm.addEventListener("submit", (e) => {
    e.preventDefault();
    playUrl(urlInput.value);
  });
})();
