// Shared posture analysis – used by tracker form (pre-save) and video modal (saved logs)
window.runPostureAnalysis = async function (videoEl, canvasEl, feedbackEl) {
  if (!videoEl || !videoEl.src) return;
  if (!window.Pose) {
    if (feedbackEl) feedbackEl.textContent = "MediaPipe Pose not loaded. Check your network.";
    return;
  }

  let pose = window._boulderTrackPose;
  if (!pose) {
    pose = new window.Pose({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
    });
    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    window._boulderTrackPose = pose;
  }

  const postureSamples = [];
  let rafId = null;
  let analyzing = true;

  function ensureCanvasSize() {
    if (!videoEl || !canvasEl) return;
    const w = videoEl.videoWidth || videoEl.clientWidth || 640;
    const h = videoEl.videoHeight || videoEl.clientHeight || 360;
    if (w && h) {
      canvasEl.width = w;
      canvasEl.height = h;
    }
  }

  function collectSample(landmarks) {
    if (!videoEl || Number.isNaN(videoEl.currentTime)) return;
    const sL = landmarks[11], sR = landmarks[12], hL = landmarks[23], hR = landmarks[24];
    const fL = landmarks[31], fR = landmarks[32];
    if (!sL || !sR || !hL || !hR) return;
    const visible = (lm) => lm && (lm.visibility ?? 1) > 0.4;
    if (!visible(sL) || !visible(sR) || !visible(hL) || !visible(hR)) return;
    const shoulderCenter = { x: (sL.x + sR.x) / 2, y: (sL.y + sR.y) / 2 };
    const hipCenter = { x: (hL.x + hR.x) / 2, y: (hL.y + hR.y) / 2 };
    const dx = shoulderCenter.x - hipCenter.x, dy = shoulderCenter.y - hipCenter.y;
    const trunkAngleDeg = Math.abs((Math.atan2(dx, dy) * 180) / Math.PI);
    let feetY = null;
    if (visible(fL) || visible(fR)) {
      const ys = [];
      if (visible(fL)) ys.push(fL.y);
      if (visible(fR)) ys.push(fR.y);
      feetY = ys.reduce((a, b) => a + b, 0) / ys.length;
    }
    postureSamples.push({ t: videoEl.currentTime, trunkAngleDeg, hipY: hipCenter.y, feetY });
  }

  function drawPose(results) {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext("2d");
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    if (!results?.poseLandmarks?.length) return;
    const lm = results.poseLandmarks;
    const draw = (i, color, label) => {
      const p = lm[i];
      if (!p || p.visibility < 0.4) return null;
      const x = p.x * canvasEl.width, y = p.y * canvasEl.height;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (label) { ctx.font = "11px Instrument Sans,sans-serif"; ctx.fillStyle = "#e5e7eb"; ctx.fillText(label, x + 9, y + 4); }
      return { x, y };
    };
    const hips = [draw(23, "rgba(56,189,248,0.95)", "Hip"), draw(24, "rgba(56,189,248,0.95)", "")].filter(Boolean);
    const shoulders = [draw(11, "rgba(251,191,36,0.95)", "Shoulder"), draw(12, "rgba(251,191,36,0.95)", "")].filter(Boolean);
    const hands = [draw(15, "rgba(244,63,94,0.95)", "Hand"), draw(16, "rgba(244,63,94,0.95)", "")].filter(Boolean);
    const feet = [draw(31, "rgba(96,165,250,0.95)", "Foot"), draw(32, "rgba(96,165,250,0.95)", "")].filter(Boolean);
    ctx.strokeStyle = "rgba(34,211,166,0.75)";
    ctx.lineWidth = 3;
    [shoulders, hips, hands, feet].forEach((g) => {
      if (g.length >= 2) { ctx.beginPath(); ctx.moveTo(g[0].x, g[0].y); g.slice(1).forEach((p) => ctx.lineTo(p.x, p.y)); ctx.stroke(); }
    });
    if (hips[0] && shoulders[0]) {
      const mh = { x: (hips[0].x + (hips[1]?.x ?? hips[0].x)) / 2, y: (hips[0].y + (hips[1]?.y ?? hips[0].y)) / 2 };
      const ms = { x: (shoulders[0].x + (shoulders[1]?.x ?? shoulders[0].x)) / 2, y: (shoulders[0].y + (shoulders[1]?.y ?? shoulders[0].y)) / 2 };
      ctx.strokeStyle = "rgba(34,211,166,0.85)";
      ctx.beginPath();
      ctx.moveTo(mh.x, mh.y);
      ctx.lineTo(ms.x, ms.y);
      ctx.stroke();
    }
    collectSample(lm);
  }

  function summarize() {
    if (!feedbackEl) return;
    if (!postureSamples.length) {
      feedbackEl.innerHTML = "Not enough pose data detected in this video.";
      return;
    }
    const trunkAngles = postureSamples.map((s) => s.trunkAngleDeg);
    const avgTrunk = trunkAngles.reduce((a, b) => a + b, 0) / trunkAngles.length;
    const maxTrunk = Math.max(...trunkAngles);
    const withFeet = postureSamples.filter((s) => s.feetY != null);
    const hipsBelowRatio = withFeet.length ? withFeet.filter((s) => s.hipY > s.feetY - 0.02).length / withFeet.length : 0;
    const lines = [];
    if (avgTrunk < 10) lines.push("Your torso stays mostly stacked over your hips, which is great for efficiency and balance.");
    else if (avgTrunk < 25) lines.push("You climb with a moderate side lean. This is often fine on overhangs, but keep an eye on twisting too much.");
    else lines.push("There is significant torso rotation for long portions of the climb. Try to keep your chest and hips more square to the wall when possible.");
    if (maxTrunk > 35) lines.push("On the hardest moves your torso angle becomes very pronounced, suggesting you may be over‑reaching instead of moving your feet up first.");
    if (hipsBelowRatio > 0.15) lines.push("At several points your hips drop close to the level of your feet. Focusing on driving hips up before reaching could improve body tension.");
    else lines.push("You generally keep your hips above your feet, which helps maintain tension and control.");
    feedbackEl.innerHTML = "<ul>" + lines.map((l) => `<li>${l}</li>`).join("") + "</ul>";
  }

  pose.onResults(drawPose);
  ensureCanvasSize();
  if (feedbackEl) feedbackEl.textContent = "Analyzing…";
  videoEl.currentTime = 0;
  videoEl.playbackRate = 0.75;

  const step = async () => {
    if (!analyzing) return;
    if (videoEl.paused || videoEl.ended) {
      analyzing = false;
      summarize();
      return;
    }
    try {
      await pose.send({ image: videoEl });
    } catch (e) {
      console.error(e);
    }
    rafId = requestAnimationFrame(step);
  };

  await videoEl.play();
  requestAnimationFrame(step);
};
