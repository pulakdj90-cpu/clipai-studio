/* ClipAI Studio - Browser Clip Engine */
window.ClipEngine = (() => {
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  function getMimeType() {
    const types = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm"
    ];

    return types.find(type => MediaRecorder.isTypeSupported(type)) || "";
  }

  async function exportClip(video, options = {}) {
    const start = Math.max(0, Number(options.start || 0));
    const end = Number(options.end || video.duration);

    if (!video || !video.src) {
      throw new Error("Video load kijiye.");
    }

    if (end <= start) {
      throw new Error("End time, start time se bada hona chahiye.");
    }

    const vertical = options.vertical !== false;
    const width = vertical ? 720 : 1280;
    const height = vertical ? 1280 : 720;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    const captions = options.captions || "";
    const mimeType = getMimeType();

    if (!mimeType) {
      throw new Error("Is browser mein video export supported nahi hai.");
    }

    const drawFrame = () => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;

      if (!vw || !vh) return;

      const scale = Math.max(width / vw, height / vh);
      const sw = width / scale;
      const sh = height / scale;
      const sx = (vw - sw) / 2;
      const sy = (vh - sh) / 2;

      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);

      if (captions) {
        ctx.font = "bold 42px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";

        const text = captions.substring(0, 100);
        const x = width / 2;
        const y = height - 100;

        ctx.lineWidth = 7;
        ctx.strokeStyle = "#000000";
        ctx.fillStyle = "#ffffff";
        ctx.strokeText(text, x, y);
        ctx.fillText(text, x, y);
      }
    };

    const canvasStream = canvas.captureStream(30);

    // Video ke audio tracks bhi export mein jodne ki koshish.
    if (video.captureStream) {
      const originalStream = video.captureStream();
      originalStream.getAudioTracks().forEach(track => {
        canvasStream.addTrack(track);
      });
    }

    const recorder = new MediaRecorder(canvasStream, {
      mimeType,
      videoBitsPerSecond: 5000000
    });

    const chunks = [];

    recorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    const finished = new Promise((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error("Recording failed."));
    });

    const wasPaused = video.paused;
    const oldTime = video.currentTime;

    video.pause();

    await new Promise(resolve => {
      video.onseeked = resolve;
      video.currentTime = start;
    });

    drawFrame();
    recorder.start();

    video.muted = false;
    await video.play();

    const frameLoop = () => {
      if (video.currentTime >= end || video.ended) {
        video.pause();
        recorder.stop();
        return;
      }

      drawFrame();
      requestAnimationFrame(frameLoop);
    };

    requestAnimationFrame(frameLoop);
    await finished;

    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);

    if (!wasPaused) video.play().catch(() => {});
    video.currentTime = oldTime;

    return {
      blob,
      url,
      type: mimeType,
      filename: "clipai-clip.webm"
    };
  }

  function download(result, filename = "clipai-clip.webm") {
    const a = document.createElement("a");
    a.href = result.url;
    a.download = filename;
    a.click();
  }

  return {
    exportClip,
    download
  };
})();
