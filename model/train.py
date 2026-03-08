#!/usr/bin/env python3
"""
DYNO personalised model trainer.

Pipeline:
  1. Train a RandomForest on the base dataset (climbing.xlsx, source=0).
  2. Generate "base" per-grade predictions from that model.
  3. Compare the user's actual attempts on grades they've sent to those base
     predictions → derive a personal speed ratio (< 1 = faster, > 1 = slower).
  4. Blend the ratio with the base (confidence grows with more user data) and
     apply it to produce personalised predictions for every grade.

Output (stdout): JSON  { predictions, status, meta }
"""

import json
import os
import warnings

import pandas as pd
from sklearn.ensemble import RandomForestRegressor

warnings.filterwarnings("ignore")

# ── Paths ──────────────────────────────────────────────────────────────────
BASE_DIR    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX_PATH   = os.path.join(BASE_DIR, "data", "climbing.xlsx")
CLIMBS_PATH = os.path.join(BASE_DIR, "data", "climbs.json")

GRADE_ORDER = ["V0", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V10"]
WALL_TYPES  = ["overhang", "roof", "slab", "vertical"]

FALLBACK = {
    "V0": 3, "V1": 6, "V2": 7, "V3": 8, "V4": 9,
    "V5": 11, "V6": 12, "V7": 12, "V8": 12, "V9": 12, "V10": 21,
}


# ── Data loading ───────────────────────────────────────────────────────────

def load_base_data():
    df = pd.read_excel(XLSX_PATH).iloc[:, :6]
    df["source"] = 0
    return df


def load_user_data():
    """Parse climbs.json into the same schema as the Excel dataset."""
    if not os.path.exists(CLIMBS_PATH):
        return pd.DataFrame()
    with open(CLIMBS_PATH) as f:
        try:
            climbs = json.load(f)
        except json.JSONDecodeError:
            return pd.DataFrame()

    rows = []
    for c in climbs:
        grade     = c.get("grade", "")
        wall_type = c.get("wallType", "")
        attempts  = c.get("attempts")

        if not grade or not wall_type or attempts is None:
            continue
        if grade not in GRADE_ORDER or wall_type not in WALL_TYPES:
            continue

        try:
            attempts_int = int(str(attempts).replace("+", "").strip())
        except (ValueError, TypeError):
            continue
        if attempts_int < 1:
            continue

        status = "sent" if (c.get("completed") or c.get("status") == "sent") else "projecting"

        rows.append({
            "start_date": c.get("started", ""),
            "end_date":   c.get("completed", ""),
            "level":      grade,
            "wall_type":  wall_type,
            "status":     status,
            "attempts":   attempts_int,
            "source":     1,
        })

    return pd.DataFrame(rows) if rows else pd.DataFrame()


# ── Feature engineering ────────────────────────────────────────────────────

def prepare_features(df):
    df = df.copy()
    df["level"] = pd.Categorical(df["level"], categories=GRADE_ORDER, ordered=True)
    df["level"] = df["level"].cat.codes
    df = pd.get_dummies(df, columns=["wall_type", "status"])

    for wt in WALL_TYPES:
        col = f"wall_type_{wt}"
        if col not in df.columns:
            df[col] = False
    for s in ["sent", "projecting"]:
        col = f"status_{s}"
        if col not in df.columns:
            df[col] = False

    return df


# ── Step 1: train base model, get base predictions ─────────────────────────

def train_base_model(base_df):
    prepared = prepare_features(base_df)
    sent = prepared[prepared["status_sent"] == True].copy()
    if len(sent) < 5:
        return None, None

    y = sent["attempts"]
    X = sent.drop(columns=["attempts", "start_date", "end_date"], errors="ignore")
    model = RandomForestRegressor(n_estimators=100, random_state=42)
    model.fit(X, y)
    return model, list(X.columns)


def get_base_predictions(model, feature_cols):
    """Predict average attempts per grade on a vertical wall for a generic climber."""
    results = {}
    for i, grade in enumerate(GRADE_ORDER):
        base_row = {
            "level":               i,
            "wall_type_overhang":  0,
            "wall_type_roof":      0,
            "wall_type_slab":      0,
            "wall_type_vertical":  1,
            "status_projecting":   0,
            "status_sent":         1,
            "source":              0,
        }
        row = {col: base_row.get(col, 0) for col in feature_cols}
        pred = model.predict(pd.DataFrame([row]))[0]
        results[grade] = max(1, round(float(pred)))
    return results


# ── Step 2: personalise using user's actual progression ────────────────────

def personalise(base_predictions, user_df):
    """
    Adjust base predictions by comparing the user's actual attempts on sent
    grades to what the base model would have predicted for those grades.

    Returns (personalised_predictions, meta_dict).
    """
    meta = {
        "user_sent_climbs": 0,
        "personal_ratio": None,
        "confidence": 0.0,
        "status": "base_only",
    }

    if user_df.empty:
        return base_predictions, meta

    user_sent = user_df[user_df["status"] == "sent"].copy()
    meta["user_sent_climbs"] = len(user_sent)

    if user_sent.empty:
        meta["status"] = "no_sent_climbs"
        return base_predictions, meta

    # For each sent climb compute: actual_attempts / base_predicted_attempts
    # Order matches append order in climbs.json (oldest → newest)
    ratios = []
    for _, row in user_sent.iterrows():
        grade = row["level"]
        base_pred = base_predictions.get(grade, 0)
        if base_pred > 0:
            ratios.append(float(row["attempts"]) / base_pred)

    if not ratios:
        meta["status"] = "no_matching_grades"
        return base_predictions, meta

    n = len(ratios)

    # Weight recent climbs more heavily (linear ramp: oldest=1, newest=1+0.5*(n-1))
    weights = [1.0 + 0.5 * i for i in range(n)]
    personal_ratio = sum(r * w for r, w in zip(ratios, weights)) / sum(weights)

    # Confidence in user data grows linearly; capped at 0.85 so the base model
    # always contributes at least 15% (guards against overfitting to a single climb)
    confidence = min(0.85, n / 10.0)

    # Blended ratio: starts at 1.0 (pure base), shifts toward personal_ratio
    blend = (1 - confidence) * 1.0 + confidence * personal_ratio

    personalised = {}
    for grade, base_pred in base_predictions.items():
        personalised[grade] = max(1, round(base_pred * blend))

    meta.update({
        "personal_ratio": round(personal_ratio, 3),
        "confidence": round(confidence, 3),
        "blend": round(blend, 3),
        "status": f"personalised ({n} sent climb{'s' if n != 1 else ''})",
    })

    return personalised, meta


# ── Entry point ────────────────────────────────────────────────────────────

def main():
    base_df = load_base_data()
    user_df = load_user_data()

    model, feature_cols = train_base_model(base_df)

    if model is None:
        print(json.dumps({
            "predictions": FALLBACK,
            "status": "fallback",
            "meta": {"status": "not enough base data"},
        }))
        return

    base_predictions = get_base_predictions(model, feature_cols)
    personalised, meta = personalise(base_predictions, user_df)

    print(json.dumps({
        "predictions": personalised,
        "base_predictions": base_predictions,
        "status": meta["status"],
        "meta": meta,
    }))


if __name__ == "__main__":
    main()
