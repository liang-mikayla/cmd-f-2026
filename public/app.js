(function () {
  const form = document.getElementById("trackerForm");
  const errorEl = document.getElementById("trackerError");
  const tbody = document.getElementById("climbTableBody");
  const emptyState = document.getElementById("emptyState");
  const highestGradeEl = document.getElementById("highestGrade");
  const gradeDistributionEl = document.getElementById("gradeDistribution");

  const gradeOrder = ["V0", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V10"];
  let climbs = [];

  // ── API helpers ───────────────────────────────────────────────────────────

  async function fetchClimbs() {
    const res = await fetch("/api/climbs");
    if (!res.ok) throw new Error("Failed to load climbs");
    return res.json();
  }

  async function postClimb(climb) {
    const res = await fetch("/api/climbs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(climb),
    });
    if (!res.ok) throw new Error("Failed to save climb");
    return res.json();
  }

  async function deleteAllClimbs() {
    const res = await fetch("/api/climbs", { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete climbs");
  }

  async function uploadVideo(climbId, file) {
    const fd = new FormData();
    fd.append("video", file);
    const res = await fetch(`/api/videos/${climbId}`, { method: "POST", body: fd });
    if (!res.ok) throw new Error("Failed to upload video");
  }

  async function fetchVideoBlob(climbId) {
    const res = await fetch(`/api/videos/${climbId}`);
    if (!res.ok) throw new Error("Video not found");
    return res.blob();
  }

  async function deleteAllVideos() {
    await fetch("/api/videos", { method: "DELETE" });
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  function normalizeDate(value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function renderSummary() {
    if (!climbs.length) {
      highestGradeEl.textContent = "—";
      gradeDistributionEl.innerHTML = '<p class="empty-copy">Log a climb to see how your sessions stack up.</p>';
      return;
    }

    const completed = climbs.filter((c) => c.completed);
    let highestIndex = -1;
    const counts = Object.fromEntries(gradeOrder.map((g) => [g, 0]));

    for (const climb of climbs) {
      if (gradeOrder.includes(climb.grade)) {
        counts[climb.grade] += 1;
      }
    }
    for (const climb of completed) {
      const idx = gradeOrder.indexOf(climb.grade);
      if (idx > highestIndex) highestIndex = idx;
    }

    highestGradeEl.textContent = highestIndex >= 0 ? gradeOrder[highestIndex] : "—";

    const heroHighest = document.getElementById("heroHighestGrade");
    const heroTotal   = document.getElementById("heroTotalClimbs");
    if (heroHighest) heroHighest.textContent = highestIndex >= 0 ? gradeOrder[highestIndex] : "—";
    if (heroTotal)   heroTotal.textContent   = climbs.length;

    gradeDistributionEl.innerHTML = "";

    const maxCount = Math.max(...Object.values(counts), 0);
    gradeOrder.forEach((grade) => {
      const count = counts[grade] || 0;
      const barWidth = maxCount ? Math.max(8, (count / maxCount) * 100) : 8;
      const pill = document.createElement("div");
      pill.className = "grade-bar-row";
      pill.innerHTML = `
        <span class="grade-bar-label">${grade}</span>
        <div class="grade-bar-track">
          <div class="grade-bar-fill" style="width: ${barWidth}%;"></div>
        </div>
        <span class="grade-bar-count">${count}</span>
      `;
      gradeDistributionEl.appendChild(pill);
    });
  }

  function renderTable() {
    tbody.innerHTML = "";
    if (!climbs.length) {
      emptyState.style.display = "block";
      return;
    }
    emptyState.style.display = "none";

    const sorted = [...climbs].sort((a, b) => {
      const aDate = a.started || a.completed || "";
      const bDate = b.started || b.completed || "";
      return (bDate || "").localeCompare(aDate || "");
    });

    for (const climb of sorted) {
      const tr = document.createElement("tr");
      const statusTagClass = climb.completed ? "tag tag-sent" : "tag tag-project";
      const statusLabel = climb.completed ? "Sent" : "Projecting";

      const videoCell = climb.hasVideo
        ? `<td class="log-video-cell"><button type="button" class="btn-watch-video" data-climb-id="${climb.id}">Watch</button></td>`
        : "<td>—</td>";

      tr.innerHTML = `
        <td>${climb.grade}</td>
        <td>${climb.name || "—"}</td>
        <td>${formatDate(climb.started)}</td>
        <td>${formatDate(climb.completed)}</td>
        <td>${climb.attempts != null ? climb.attempts : "—"}</td>
        ${videoCell}
        <td><span class="${statusTagClass}">${statusLabel}</span></td>
      `;
      tbody.appendChild(tr);
    }

    // Update challenge progress if active
    if (activeChallenge) {
      const { grade, target } = activeChallenge;
      const used = climbs.filter((c) => c.grade === grade && !c.completed).length;
      if (used > 0) updateChallengeProgress(grade, used, target);
    }
  }

  async function hydrate() {
    try {
      climbs = await fetchClimbs();
    } catch (e) {
      console.error("Could not load climbs from server:", e);
      climbs = [];
    }
    renderSummary();
    renderTable();
  }

  // ── Form submission ───────────────────────────────────────────────────────

  async function handleSubmit(event) {
    event.preventDefault();
    errorEl.textContent = "";

    const grade = document.getElementById("grade").value;
    const name = document.getElementById("routeName").value.trim();
    const location = document.getElementById("location")?.value.trim() ?? "";
    const status = document.getElementById("status").value;
    const wallType = (document.getElementById("wallType") || {}).value || "";
    let started = normalizeDate(document.getElementById("started").value);
    let completed = normalizeDate(document.getElementById("completed").value);
    const notes = document.getElementById("notes").value.trim();
    const attemptsRaw = document.getElementById("attempts").value.trim();
    let attempts = null;
    if (attemptsRaw !== "") {
      const n = parseInt(attemptsRaw, 10);
      if (Number.isNaN(n) || n < 1) {
        errorEl.textContent = "Attempts must be a positive number.";
        return;
      }
      attempts = n;
    }

    const logVideoInput = document.getElementById("logVideo");
    const logVideoFile = logVideoInput && logVideoInput.files && logVideoInput.files[0] ? logVideoInput.files[0] : null;

    if (!grade) { errorEl.textContent = "Choose a grade."; return; }
    if (!wallType) { errorEl.textContent = "Choose a wall type."; return; }
    if (!attemptsRaw) { errorEl.textContent = "Choose number of attempts."; return; }
    if (!started) started = normalizeDate(new Date());
    if (started && completed) {
      if (new Date(completed) < new Date(started)) {
        errorEl.textContent = "Completed date can't be before the start date.";
        return;
      }
    }

    const climb = {
      id: Date.now(),
      grade,
      name,
      location,
      wallType,
      status,
      started,
      completed: completed || "",
      attempts: attempts ?? undefined,
      notes,
      hasVideo: !!(logVideoFile && logVideoFile.size > 0),
    };

    if (status === "sent" && !climb.completed) {
      climb.completed = normalizeDate(new Date());
    }

    try {
      const saved = await postClimb(climb);
      // Use server-assigned id if returned
      climb.id = saved.id ?? climb.id;
    } catch (err) {
      errorEl.textContent = "Failed to save climb. Is the server running?";
      console.error(err);
      return;
    }

    if (climb.hasVideo && logVideoFile) {
      try {
        await uploadVideo(climb.id, logVideoFile);
      } catch (err) {
        console.error("Failed to upload video", err);
      }
    }

    climbs.push(climb);
    renderSummary();
    renderTable();

    // ── Challenge engine ──────────────────────────────────────────────────
    if (climb.status === "sent" || climb.completed) {
      const gradeIndex = gradeOrder.indexOf(climb.grade);
      const nextGradeIndex = gradeIndex + 1;
      if (nextGradeIndex < gradeOrder.length) {
        const nextGrade = gradeOrder[nextGradeIndex];
        const modelPredictions = {
          V0:   3, V1:  6, V2:  7, V3:  8, V4:  9,
          V5:  11, V6: 12, V7: 12, V8: 12, V9: 12, V10: 21,
        };
        const predictedAttempts = modelPredictions[nextGrade] ?? 6;
        showChallenge(nextGrade, predictedAttempts, climb.wallType);
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    resetForm();
  }

  function resetForm() {
    form.reset();
    errorEl.textContent = "";
    document.querySelectorAll(".chip-group .chip").forEach(c => c.classList.remove("chip-active"));
    const firstStatus = document.querySelector("#statusChips .chip[data-val='project']");
    if (firstStatus) firstStatus.classList.add("chip-active");
    document.getElementById("status").value = "project";
    document.getElementById("grade").value = "";
    document.getElementById("wallType").value = "";
    document.getElementById("attempts").value = "";
    if (saveClimbBtn) saveClimbBtn.disabled = true;
    if (logVideoPreviewUrl) {
      URL.revokeObjectURL(logVideoPreviewUrl);
      logVideoPreviewUrl = null;
    }
    const logVideoInput = document.getElementById("logVideo");
    if (logVideoInput) logVideoInput.value = "";
    if (logVideoPreview) logVideoPreview.style.display = "none";
    if (dropzoneInner) dropzoneInner.style.display = "flex";
    if (logVideoPostureFeedback) logVideoPostureFeedback.textContent = "";
  }

  // ── Challenge banner ──────────────────────────────────────────────────────

  const challengeBanner   = document.getElementById("challengeBanner");
  const challengeGradeEl  = document.getElementById("challengeGrade");
  const challengeAttEl    = document.getElementById("challengeAttempts");
  const challengeAttLarge = document.getElementById("challengeAttemptsLarge");
  const challengeSubEl    = document.getElementById("challengeSub");
  const challengeDismiss  = document.getElementById("challengeDismiss");
  const progressWrap      = document.getElementById("challengeProgressWrap");
  const progressGradeEl   = document.getElementById("challengeProgressGrade");
  const progressFraction  = document.getElementById("challengeProgressFraction");
  const progressFill      = document.getElementById("challengeProgressFill");

  let activeChallenge = null;

  function showChallenge(nextGrade, predictedAttempts, wallType) {
    activeChallenge = { grade: nextGrade, target: predictedAttempts, attemptsUsed: 0 };

    challengeGradeEl.textContent  = nextGrade;
    challengeAttEl.textContent    = predictedAttempts;
    challengeAttLarge.textContent = predictedAttempts;

    const wallHint = wallType ? ` on a ${wallType}` : "";
    challengeSubEl.textContent =
      `Your model predicts it will take around ${predictedAttempts} attempts to send ${nextGrade}${wallHint}. ` +
      `Log your ${nextGrade} attempts below to track your progress against this target.`;

    const existingAttempts = climbs.filter(
      (c) => c.grade === nextGrade && !c.completed
    ).length;

    if (existingAttempts > 0) {
      updateChallengeProgress(nextGrade, existingAttempts, predictedAttempts);
    } else {
      if (progressWrap) progressWrap.style.display = "none";
    }

    challengeBanner.classList.remove("is-visible");
    void challengeBanner.offsetWidth;
    challengeBanner.classList.add("is-visible");
    challengeBanner.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function updateChallengeProgress(grade, used, target) {
    if (!progressWrap) return;
    progressWrap.style.display = "flex";
    if (progressGradeEl) progressGradeEl.textContent  = grade;
    if (progressFraction) progressFraction.textContent = `${used} / ${target} attempts used`;
    const pct = Math.min(100, Math.round((used / target) * 100));
    if (progressFill) {
      progressFill.style.width = pct + "%";
      progressFill.style.background = pct >= 100
        ? "linear-gradient(90deg, #f97373, #ef4444)"
        : "linear-gradient(90deg, #fbbf24, #f97316)";
    }
  }

  if (challengeDismiss) {
    challengeDismiss.addEventListener("click", () => {
      challengeBanner.classList.remove("is-visible");
      activeChallenge = null;
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  if (form) form.addEventListener("submit", handleSubmit);

  hydrate();

  // ── Chip selectors ────────────────────────────────────────────────────────

  function wireChips(groupId, hiddenId) {
    const group = document.getElementById(groupId);
    const hidden = document.getElementById(hiddenId);
    if (!group || !hidden) return;
    group.querySelectorAll(".chip").forEach(chip => {
      chip.addEventListener("click", () => {
        group.querySelectorAll(".chip").forEach(c => c.classList.remove("chip-active"));
        chip.classList.add("chip-active");
        hidden.value = chip.dataset.val;
      });
    });
  }
  wireChips("gradeChips", "grade");
  wireChips("wallChips", "wallType");
  wireChips("statusChips", "status");
  wireChips("attemptsChips", "attempts");

  const saveClimbBtn = document.getElementById("saveClimbBtn");
  function updateSaveBtn() {
    const filled =
      document.getElementById("grade").value &&
      document.getElementById("wallType").value &&
      document.getElementById("attempts").value;
    if (saveClimbBtn) saveClimbBtn.disabled = !filled;
  }
  ["grade", "wallType", "attempts"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", updateSaveBtn);
  });
  document.querySelectorAll("#gradeChips .chip, #wallChips .chip, #attemptsChips .chip")
    .forEach(chip => chip.addEventListener("click", updateSaveBtn));

  const clearFormBtn = document.getElementById("clearFormBtn");
  if (clearFormBtn) clearFormBtn.addEventListener("click", resetForm);

  // ── Video dropzone ────────────────────────────────────────────────────────

  const videoDropzone = document.getElementById("videoDropzone");
  const dropzoneInner = document.getElementById("dropzoneInner");
  const browseBtn = document.getElementById("browseBtn");
  const removeVideoBtn = document.getElementById("removeVideoBtn");

  if (browseBtn) {
    browseBtn.addEventListener("click", () => logVideoInput && logVideoInput.click());
  }
  if (dropzoneInner) {
    dropzoneInner.addEventListener("click", () => logVideoInput && logVideoInput.click());
  }
  if (videoDropzone) {
    videoDropzone.addEventListener("dragover", e => { e.preventDefault(); videoDropzone.classList.add("drag-over"); });
    videoDropzone.addEventListener("dragleave", () => videoDropzone.classList.remove("drag-over"));
    videoDropzone.addEventListener("drop", e => {
      e.preventDefault();
      videoDropzone.classList.remove("drag-over");
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file && logVideoInput) {
        const dt = new DataTransfer();
        dt.items.add(file);
        logVideoInput.files = dt.files;
        logVideoInput.dispatchEvent(new Event("change"));
      }
    });
  }
  if (removeVideoBtn) {
    removeVideoBtn.addEventListener("click", () => {
      if (logVideoInput) { logVideoInput.value = ""; }
      if (logVideoPreviewUrl) { URL.revokeObjectURL(logVideoPreviewUrl); logVideoPreviewUrl = null; }
      if (logVideoPreview) logVideoPreview.style.display = "none";
      if (dropzoneInner) dropzoneInner.style.display = "flex";
    });
  }

  // ── Clear logs ────────────────────────────────────────────────────────────

  const clearLogsBtn = document.getElementById("clearLogsBtn");
  if (clearLogsBtn) {
    clearLogsBtn.addEventListener("click", async () => {
      if (!confirm("Delete all logged climbs? This cannot be undone.")) return;
      try {
        await deleteAllClimbs();
        await deleteAllVideos();
      } catch (e) {
        console.error("Failed to clear data:", e);
      }
      climbs = [];
      renderSummary();
      renderTable();
      if (challengeBanner) challengeBanner.classList.remove("is-visible");
    });
  }

  // ── Log video preview ─────────────────────────────────────────────────────

  const logVideoInput = document.getElementById("logVideo");
  const logVideoPreview = document.getElementById("logVideoPreview");
  const logVideoPreviewPlayer = document.getElementById("logVideoPreviewPlayer");
  const logVideoPreviewCanvas = document.getElementById("logVideoPreviewCanvas");
  const logVideoAnalyzeBtn = document.getElementById("logVideoAnalyzeBtn");
  const logVideoPostureFeedback = document.getElementById("logVideoPostureFeedback");
  let logVideoPreviewUrl = null;

  if (logVideoInput) {
    logVideoInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (logVideoPreviewUrl) {
        URL.revokeObjectURL(logVideoPreviewUrl);
        logVideoPreviewUrl = null;
      }
      if (!file) {
        if (logVideoPreview) logVideoPreview.style.display = "none";
        if (dropzoneInner) dropzoneInner.style.display = "flex";
        return;
      }
      logVideoPreviewUrl = URL.createObjectURL(file);
      if (logVideoPreviewPlayer) {
        logVideoPreviewPlayer.src = logVideoPreviewUrl;
        logVideoPreviewPlayer.load();
      }
      if (logVideoPostureFeedback) logVideoPostureFeedback.textContent = "";
      if (logVideoPreview) logVideoPreview.style.display = "block";
      if (dropzoneInner) dropzoneInner.style.display = "none";
    });
  }
  if (logVideoAnalyzeBtn && logVideoPreviewPlayer && logVideoPreviewCanvas && logVideoPostureFeedback) {
    logVideoAnalyzeBtn.addEventListener("click", () => {
      if (!logVideoPreviewPlayer.src) return;
      if (logVideoPreviewPlayer.readyState < 2) {
        logVideoPostureFeedback.textContent = "Please wait for the video to load, then try again.";
        return;
      }
      window.runPostureAnalysis(logVideoPreviewPlayer, logVideoPreviewCanvas, logVideoPostureFeedback);
    });
  }

  // ── Video modal ───────────────────────────────────────────────────────────

  const videoModalBackdrop = document.getElementById("videoModalBackdrop");
  const videoModalClose = document.getElementById("videoModalClose");
  const videoModalPlayer = document.getElementById("videoModalPlayer");
  const modalAnalyzeBtn = document.getElementById("modalAnalyzePosture");
  let currentVideoObjectUrl = null;

  function closeVideoModal() {
    if (videoModalPlayer) {
      videoModalPlayer.pause();
      videoModalPlayer.removeAttribute("src");
      videoModalPlayer.load();
    }
    if (currentVideoObjectUrl) {
      URL.revokeObjectURL(currentVideoObjectUrl);
      currentVideoObjectUrl = null;
    }
    if (videoModalBackdrop) {
      videoModalBackdrop.classList.remove("is-open");
      videoModalBackdrop.setAttribute("aria-hidden", "true");
    }
  }

  function openVideoModal(climbId) {
    const id = typeof climbId === "string" ? Number(climbId) : climbId;
    fetchVideoBlob(id)
      .then((blob) => {
        if (!blob || !videoModalPlayer || !videoModalBackdrop) return;
        if (currentVideoObjectUrl) URL.revokeObjectURL(currentVideoObjectUrl);
        currentVideoObjectUrl = URL.createObjectURL(blob);
        videoModalPlayer.src = currentVideoObjectUrl;
        videoModalBackdrop.classList.add("is-open");
        videoModalBackdrop.setAttribute("aria-hidden", "false");
        videoModalPlayer.play().catch(() => {});
      })
      .catch((err) => {
        console.error("Could not load log video", err);
      });
  }

  if (tbody) {
    tbody.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-watch-video");
      if (btn && btn.dataset.climbId) openVideoModal(btn.dataset.climbId);
    });
  }
  if (videoModalClose) videoModalClose.addEventListener("click", closeVideoModal);
  if (videoModalBackdrop) {
    videoModalBackdrop.addEventListener("click", (e) => {
      if (e.target === videoModalBackdrop) closeVideoModal();
    });
  }
  if (modalAnalyzeBtn && videoModalPlayer && document.getElementById("videoModalCanvas") && document.getElementById("videoModalPostureFeedback")) {
    modalAnalyzeBtn.addEventListener("click", () => {
      if (!videoModalPlayer.src) return;
      const canvas = document.getElementById("videoModalCanvas");
      const feedback = document.getElementById("videoModalPostureFeedback");
      feedback.textContent = "";
      window.runPostureAnalysis(videoModalPlayer, canvas, feedback);
    });
  }
})();
