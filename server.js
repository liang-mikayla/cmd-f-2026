const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Paths ──────────────────────────────────────────────────────────────────
const DATA_FILE        = path.join(__dirname, "data", "climbs.json");
const PREDICTIONS_FILE = path.join(__dirname, "data", "predictions.json");
const UPLOADS_DIR      = path.join(__dirname, "uploads");
const PYTHON_BIN       = path.join(__dirname, "model", "venv", "bin", "python");
const TRAIN_SCRIPT     = path.join(__dirname, "model", "train.py");

// Ensure directories exist
fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Multer (video uploads) ─────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, _file, cb) => cb(null, `${req.params.id}.mp4`),
});
const upload = multer({ storage });

// ── Climbs helpers ─────────────────────────────────────────────────────────
function loadClimbs() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveClimbs(climbs) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(climbs, null, 2), "utf8");
}

// ── REST API: Climbs ───────────────────────────────────────────────────────

// GET /api/climbs — return all climbs
app.get("/api/climbs", (_req, res) => {
  res.json(loadClimbs());
});

// POST /api/climbs — add a climb
app.post("/api/climbs", (req, res) => {
  const climb = req.body;
  if (!climb || !climb.grade) {
    return res.status(400).json({ error: "Invalid climb data" });
  }
  const climbs = loadClimbs();
  // Ensure unique id
  climb.id = climb.id ?? Date.now();
  climbs.push(climb);
  saveClimbs(climbs);
  res.status(201).json(climb);
});

// DELETE /api/climbs — delete all climbs
app.delete("/api/climbs", (_req, res) => {
  saveClimbs([]);
  res.json({ ok: true });
});

// ── REST API: Videos ───────────────────────────────────────────────────────

// POST /api/videos/:id — upload a video for a climb
app.post("/api/videos/:id", upload.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  res.json({ ok: true, filename: req.file.filename });
});

// GET /api/videos/:id — serve a climb's video
app.get("/api/videos/:id", (req, res) => {
  const filePath = path.join(UPLOADS_DIR, `${req.params.id}.mp4`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Video not found" });
  }
  res.sendFile(filePath);
});

// DELETE /api/videos — delete all uploaded videos
app.delete("/api/videos", (_req, res) => {
  try {
    const files = fs.readdirSync(UPLOADS_DIR);
    for (const f of files) {
      fs.unlinkSync(path.join(UPLOADS_DIR, f));
    }
  } catch (e) {
    console.error("Failed to delete videos:", e);
  }
  res.json({ ok: true });
});

// ── REST API: Model ────────────────────────────────────────────────────────

// GET /api/model/predictions — return current per-grade attempt predictions
app.get("/api/model/predictions", (_req, res) => {
  try {
    if (!fs.existsSync(PREDICTIONS_FILE)) {
      return res.json({
        predictions: { V0:3,V1:6,V2:7,V3:8,V4:9,V5:11,V6:12,V7:12,V8:12,V9:12,V10:21 },
        status: "fallback",
      });
    }
    const raw = fs.readFileSync(PREDICTIONS_FILE, "utf8");
    res.json(JSON.parse(raw));
  } catch (e) {
    console.error("Failed to read predictions:", e);
    res.status(500).json({ error: "Could not load predictions" });
  }
});

// POST /api/model/train — retrain model on base data + user climbs, save new predictions
app.post("/api/model/train", (req, res) => {
  execFile(PYTHON_BIN, [TRAIN_SCRIPT], { cwd: __dirname }, (err, stdout, stderr) => {
    if (err) {
      console.error("Model training failed:", stderr);
      return res.status(500).json({ error: "Training failed", detail: stderr });
    }
    try {
      const result = JSON.parse(stdout.trim());
      fs.writeFileSync(PREDICTIONS_FILE, JSON.stringify(result, null, 2), "utf8");
      console.log(`Model retrained (${result.status}):`, result.predictions);
      res.json(result);
    } catch (parseErr) {
      console.error("Failed to parse model output:", stdout);
      res.status(500).json({ error: "Bad model output" });
    }
  });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`DYNO server running at http://localhost:${PORT}`);
});
