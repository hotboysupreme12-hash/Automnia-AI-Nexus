from __future__ import annotations

import csv
import datetime as dt
import json
import math
import os
import re
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any


DATE = "2026-06-22"
SEASON = 2026
WORKSPACE = Path(r"C:\Users\hotbo\Downloads\DystopAI-Core Latest extracted\DystopAI-Core")
CSV_PATH = Path(r"C:\Users\hotbo\Downloads\Lineups_2026_06_22 (2).csv")
ARTIFACT_DIR = WORKSPACE / "artifacts" / f"mlb-edge-{DATE}"
OUTPUT_DIR = WORKSPACE / "output" / "pdf"
CACHE_DIR = ARTIFACT_DIR / "raw"
REPORT_JSON = ARTIFACT_DIR / f"mlb_edge_report_{DATE}.json"
PDF_PATH = OUTPUT_DIR / f"MLB_Edge_Report_{DATE}.pdf"


TEAM_ALIASES = {
    "AZ": "ARI",
    "ARI": "ARI",
    "CWS": "CHW",
    "CHW": "CHW",
    "WSH": "WAS",
    "WAS": "WAS",
    "SDP": "SD",
    "SD": "SD",
    "SF": "SF",
    "SFG": "SF",
    "TB": "TB",
    "TBR": "TB",
    "KC": "KC",
    "KCR": "KC",
}

PARK_TOTAL_ADJ = {
    "Coors Field": 1.0,
    "Great American Ball Park": 0.35,
    "Rate Field": 0.15,
    "Nationals Park": 0.10,
    "Comerica Park": -0.10,
    "Tropicana Field": -0.10,
    "loanDepot park": -0.20,
    "Citi Field": -0.15,
    "Target Field": -0.10,
    "Busch Stadium": -0.10,
    "Angel Stadium": 0.00,
    "Petco Park": -0.25,
    "Rogers Centre": 0.05,
}


def canon(code: str | None) -> str:
    if not code:
        return ""
    code = code.strip().upper()
    return TEAM_ALIASES.get(code, code)


def safe_float(value: Any, default: float | None = None) -> float | None:
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def safe_int(value: Any, default: int | None = None) -> int | None:
    if value is None or value == "":
        return default
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def mean(values: list[float]) -> float | None:
    nums = [v for v in values if v is not None and not math.isnan(v)]
    if not nums:
        return None
    return statistics.fmean(nums)


def median(values: list[float]) -> float | None:
    nums = [v for v in values if v is not None and not math.isnan(v)]
    if not nums:
        return None
    return float(statistics.median(nums))


def stdev(values: list[float], floor: float = 0.001) -> float:
    nums = [v for v in values if v is not None and not math.isnan(v)]
    if len(nums) < 2:
        return floor
    return max(statistics.pstdev(nums), floor)


def z(value: float | None, avg: float | None, sd: float, cap: float = 2.5) -> float:
    if value is None or avg is None:
        return 0.0
    return max(-cap, min(cap, (value - avg) / sd))


def american_to_prob(odds: float | int | None) -> float | None:
    if odds is None:
        return None
    odds = float(odds)
    if odds < 0:
        return -odds / (-odds + 100.0)
    return 100.0 / (odds + 100.0)


def prob_to_american(prob: float | None) -> int | None:
    if prob is None:
        return None
    prob = max(0.01, min(0.99, prob))
    if prob >= 0.5:
        return int(round(-100.0 * prob / (1.0 - prob)))
    return int(round(100.0 * (1.0 - prob) / prob))


def logit(prob: float) -> float:
    prob = max(0.01, min(0.99, prob))
    return math.log(prob / (1.0 - prob))


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def build_url(base: str, path: str, params: list[tuple[str, Any]] | dict[str, Any] | None = None) -> str:
    if isinstance(params, dict):
        params = list(params.items())
    query: list[tuple[str, str]] = []
    for key, value in params or []:
        if value is None:
            continue
        if isinstance(value, (list, tuple, set)):
            for item in value:
                if item is not None:
                    query.append((key, str(item)))
        else:
            query.append((key, str(value)))
    return urllib.parse.urljoin(base, path) + ("?" + urllib.parse.urlencode(query) if query else "")


def http_get_json(
    name: str,
    url: str,
    headers: dict[str, str] | None = None,
    *,
    use_cache: bool = False,
    retries: int = 3,
) -> Any:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / name
    if use_cache and path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers or {})
            with urllib.request.urlopen(req, timeout=45) as resp:
                text = resp.read().decode("utf-8")
            data = json.loads(text)
            path.write_text(json.dumps(data, indent=2), encoding="utf-8")
            return data
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code == 429:
                time.sleep(12 + attempt * 8)
            elif 500 <= exc.code < 600:
                time.sleep(2 + attempt * 2)
            else:
                try:
                    err_text = exc.read().decode("utf-8", errors="replace")
                except Exception:
                    err_text = str(exc)
                (CACHE_DIR / f"{name}.error.txt").write_text(err_text, encoding="utf-8")
                raise
        except Exception as exc:
            last_error = exc
            time.sleep(2 + attempt * 2)
    raise RuntimeError(f"GET failed for {url}: {last_error}")


def load_json_if_exists(path: Path) -> Any | None:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return None


def load_cached_paginated_rows(name_prefix: str) -> list[Any]:
    rows: list[Any] = []
    seen: set[str] = set()
    for path in sorted(CACHE_DIR.glob(f"{name_prefix}_*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for row in payload.get("data", []) or []:
            key = json.dumps(row, sort_keys=True)
            if key not in seen:
                seen.add(key)
                rows.append(row)
    return rows


def bdl_headers() -> dict[str, str]:
    key = os.environ.get("BDL_API_KEY", "").strip()
    if not key:
        return {}
    return {"Authorization": key}


def fetch_bdl(name: str, path: str, params: list[tuple[str, Any]] | dict[str, Any] | None = None) -> Any:
    headers = bdl_headers()
    if not headers:
        raise RuntimeError("BDL_API_KEY is not set")
    url = build_url("https://api.balldontlie.io", path, params)
    return http_get_json(name, url, headers=headers)


def fetch_mlb(name: str, path: str, params: list[tuple[str, Any]] | dict[str, Any] | None = None) -> Any:
    url = build_url("https://statsapi.mlb.com", path, params)
    return http_get_json(name, url)


def fetch_paginated_bdl(name_prefix: str, path: str, params: list[tuple[str, Any]]) -> list[Any]:
    all_rows: list[Any] = []
    cursor: str | None = None
    page = 1
    while True:
        page_params = list(params)
        page_params.append(("per_page", 100))
        if cursor:
            page_params.append(("cursor", cursor))
        try:
            data = fetch_bdl(f"{name_prefix}_{page}.json", path, page_params)
        except Exception:
            if all_rows:
                break
            cached_rows = load_cached_paginated_rows(name_prefix)
            if cached_rows:
                return cached_rows
            raise
        rows = data.get("data", [])
        all_rows.extend(rows)
        meta = data.get("meta") or {}
        cursor = meta.get("next_cursor") or meta.get("next")
        if not cursor or not rows:
            break
        page += 1
        time.sleep(0.35)
    return all_rows


def parse_lineup_csv() -> dict[str, Any]:
    with CSV_PATH.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = [{(k or "").strip(): v for k, v in row.items()} for row in reader]
    by_team: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        code = canon(row.get("team code"))
        row["team_code_canon"] = code
        row["mlb_id_int"] = safe_int(row.get("mlb id"))
        row["batting_order_int"] = safe_int(row.get("batting order"), 99)
        by_team[code].append(row)
    for code in by_team:
        by_team[code].sort(key=lambda r: (r.get("batting_order_int") or 99, str(r.get("player name"))))
    return {"rows": rows, "by_team": by_team}


def extract_hitting_stat(person: dict[str, Any]) -> dict[str, Any]:
    out = {
        "mlb_id": person.get("id"),
        "name": person.get("fullName"),
        "ops": None,
        "obp": None,
        "slg": None,
        "avg": None,
        "hr": 0,
        "rbi": 0,
        "ab": 0,
    }
    for stat_group in person.get("stats", []) or []:
        for split in stat_group.get("splits", []) or []:
            stat = split.get("stat", {}) or {}
            if "ops" in stat or "homeRuns" in stat:
                out.update(
                    {
                        "ops": safe_float(stat.get("ops")),
                        "obp": safe_float(stat.get("obp")),
                        "slg": safe_float(stat.get("slg")),
                        "avg": safe_float(stat.get("avg")),
                        "hr": safe_int(stat.get("homeRuns"), 0) or 0,
                        "rbi": safe_int(stat.get("rbi"), 0) or 0,
                        "ab": safe_int(stat.get("atBats"), 0) or 0,
                    }
                )
                return out
    return out


def extract_pitching_stat(person: dict[str, Any]) -> dict[str, Any]:
    out = {
        "mlb_id": person.get("id"),
        "name": person.get("fullName"),
        "era": None,
        "whip": None,
        "k9": None,
        "bb9": None,
        "ip": None,
        "gs": 0,
    }
    for stat_group in person.get("stats", []) or []:
        for split in stat_group.get("splits", []) or []:
            stat = split.get("stat", {}) or {}
            if "era" in stat or "whip" in stat:
                ip = innings_to_float(stat.get("inningsPitched"))
                strikeouts = safe_float(stat.get("strikeOuts"), 0.0) or 0.0
                walks = safe_float(stat.get("baseOnBalls"), 0.0) or 0.0
                out.update(
                    {
                        "era": safe_float(stat.get("era")),
                        "whip": safe_float(stat.get("whip")),
                        "k9": (strikeouts * 9.0 / ip) if ip and ip > 0 else None,
                        "bb9": (walks * 9.0 / ip) if ip and ip > 0 else None,
                        "ip": ip,
                        "gs": safe_int(stat.get("gamesStarted"), 0) or 0,
                    }
                )
                return out
    return out


def innings_to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    text = str(value)
    if "." not in text:
        return safe_float(text)
    whole, frac = text.split(".", 1)
    outs = safe_int(frac, 0) or 0
    return (safe_float(whole, 0.0) or 0.0) + outs / 3.0


def fetch_people_stats(ids: list[int], *, group: str, filename_prefix: str) -> dict[int, dict[str, Any]]:
    result: dict[int, dict[str, Any]] = {}
    clean_ids = sorted({i for i in ids if i})
    for idx in range(0, len(clean_ids), 80):
        batch = clean_ids[idx : idx + 80]
        params = {
            "personIds": ",".join(str(i) for i in batch),
            "hydrate": f"stats(group=[{group}],type=[season],season={SEASON})",
        }
        data = fetch_mlb(f"{filename_prefix}_{idx // 80 + 1}.json", "/api/v1/people", params)
        for person in data.get("people", []) or []:
            pid = safe_int(person.get("id"))
            if not pid:
                continue
            if group == "hitting":
                result[pid] = extract_hitting_stat(person)
            else:
                result[pid] = extract_pitching_stat(person)
    return result


def bdl_team_code(team: dict[str, Any] | None) -> str:
    return canon((team or {}).get("abbreviation"))


def game_key(away: str, home: str) -> str:
    return f"{canon(away)}@{canon(home)}"


def parse_iso_datetime(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    text = value.replace("Z", "+00:00")
    try:
        return dt.datetime.fromisoformat(text)
    except ValueError:
        return None


def choose_nearest_game(candidates: list[dict[str, Any]], target_date: str | None) -> dict[str, Any]:
    if not candidates:
        return {}
    target = parse_iso_datetime(target_date)
    if not target:
        return candidates[0]
    scored: list[tuple[float, dict[str, Any]]] = []
    for candidate in candidates:
        cand_date = parse_iso_datetime(candidate.get("date"))
        if cand_date:
            scored.append((abs((cand_date - target).total_seconds()), candidate))
    if not scored:
        return candidates[0]
    scored.sort(key=lambda item: item[0])
    return scored[0][1]


def parse_mlb_schedule_game(game: dict[str, Any]) -> dict[str, Any]:
    away = game["teams"]["away"]
    home = game["teams"]["home"]
    away_team = away["team"]
    home_team = home["team"]
    away_prob = away.get("probablePitcher") or {}
    home_prob = home.get("probablePitcher") or {}
    return {
        "game_pk": game.get("gamePk"),
        "date": game.get("gameDate"),
        "status": (game.get("status") or {}).get("detailedState"),
        "venue": (game.get("venue") or {}).get("name"),
        "away": canon(away_team.get("abbreviation")),
        "home": canon(home_team.get("abbreviation")),
        "away_name": away_team.get("name"),
        "home_name": home_team.get("name"),
        "away_record": away.get("leagueRecord", {}),
        "home_record": home.get("leagueRecord", {}),
        "away_probable": {
            "id": away_prob.get("id"),
            "name": away_prob.get("fullName"),
        },
        "home_probable": {
            "id": home_prob.get("id"),
            "name": home_prob.get("fullName"),
        },
    }


def completed_state(game: dict[str, Any]) -> bool:
    state = ((game.get("status") or {}).get("detailedState") or "").lower()
    return any(x in state for x in ["final", "completed", "game over"])


def build_history(history_schedule: dict[str, Any], team_id_to_code: dict[int, str]) -> dict[str, Any]:
    by_team: dict[str, list[dict[str, Any]]] = defaultdict(list)
    h2h: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for date_block in history_schedule.get("dates", []) or []:
        date_text = date_block.get("date")
        for game in date_block.get("games", []) or []:
            if not completed_state(game):
                continue
            teams = game.get("teams", {})
            away = teams.get("away", {})
            home = teams.get("home", {})
            away_team = away.get("team") or {}
            home_team = home.get("team") or {}
            away_code = canon(away_team.get("abbreviation") or team_id_to_code.get(safe_int(away_team.get("id")) or -1))
            home_code = canon(home_team.get("abbreviation") or team_id_to_code.get(safe_int(home_team.get("id")) or -1))
            away_score = safe_int(away.get("score"))
            home_score = safe_int(home.get("score"))
            if not away_code or not home_code or away_score is None or home_score is None:
                continue
            records = [
                {
                    "date": date_text,
                    "opponent": home_code,
                    "home": False,
                    "rf": away_score,
                    "ra": home_score,
                    "win": away_score > home_score,
                    "game_pk": game.get("gamePk"),
                },
                {
                    "date": date_text,
                    "opponent": away_code,
                    "home": True,
                    "rf": home_score,
                    "ra": away_score,
                    "win": home_score > away_score,
                    "game_pk": game.get("gamePk"),
                },
            ]
            by_team[away_code].append(records[0])
            by_team[home_code].append(records[1])
            h2h[game_key(away_code, home_code)].append(
                {
                    "date": date_text,
                    "away": away_code,
                    "home": home_code,
                    "away_score": away_score,
                    "home_score": home_score,
                }
            )
    for code in by_team:
        by_team[code].sort(key=lambda r: r["date"])
    return {"by_team": by_team, "h2h": h2h}


def summarize_team_history(games: list[dict[str, Any]], as_home: bool | None = None, n: int | None = None) -> dict[str, Any]:
    rows = games
    if as_home is not None:
        rows = [g for g in rows if bool(g["home"]) == as_home]
    if n is not None:
        rows = rows[-n:]
    gp = len(rows)
    if gp == 0:
        return {"gp": 0, "wins": 0, "losses": 0, "rf": None, "ra": None, "rd": None, "win_pct": None}
    wins = sum(1 for g in rows if g["win"])
    rf = statistics.fmean(g["rf"] for g in rows)
    ra = statistics.fmean(g["ra"] for g in rows)
    return {
        "gp": gp,
        "wins": wins,
        "losses": gp - wins,
        "rf": rf,
        "ra": ra,
        "rd": rf - ra,
        "win_pct": wins / gp,
    }


def rest_days(games: list[dict[str, Any]], target_date: str) -> int | None:
    if not games:
        return None
    last_date = dt.date.fromisoformat(games[-1]["date"])
    today = dt.date.fromisoformat(target_date)
    return max(0, (today - last_date).days - 1)


def weather_run_adjustment(weather: str, venue: str) -> tuple[float, str]:
    if not weather:
        return (0.0, "No weather field")
    text = weather.upper()
    adj = 0.0
    tags: list[str] = []
    if "DOME" in text or "RETRACTABLE" in text:
        tags.append("roof/dome")
    match_temp = re.match(r"\s*(\d+)", weather)
    if match_temp:
        temp = int(match_temp.group(1))
        if temp >= 80:
            adj += 0.18
            tags.append("warm")
        elif temp <= 60:
            adj -= 0.12
            tags.append("cool")
    if " OUT " in text:
        adj += 0.18
        tags.append("wind out")
    if " IN " in text:
        adj -= 0.12
        tags.append("wind in")
    rain_match = re.search(r"(\d+)%", weather)
    if rain_match:
        rain = int(rain_match.group(1))
        if rain >= 45:
            adj -= 0.08
            tags.append("weather delay risk")
    adj += PARK_TOTAL_ADJ.get(venue, 0.0)
    if venue in PARK_TOTAL_ADJ and PARK_TOTAL_ADJ[venue] != 0:
        tags.append("park factor")
    return (adj, ", ".join(tags) if tags else weather)


def injury_penalty(injuries: list[dict[str, Any]]) -> float:
    penalty = 0.0
    for item in injuries:
        player = item.get("player") or {}
        pos = (player.get("position") or "").upper()
        status = (item.get("status") or "").upper()
        if "IL" not in status and "OUT" not in status:
            continue
        if pos in {"SP", "RP", "P"}:
            penalty += 0.018
        elif pos in {"C", "SS", "CF"}:
            penalty += 0.014
        else:
            penalty += 0.010
    return min(0.08, penalty)


def stat_float(row: dict[str, Any], key: str) -> float | None:
    return safe_float(row.get(key))


def team_stats_metrics(row: dict[str, Any] | None) -> dict[str, Any]:
    if not row:
        return {}
    gp = safe_float(row.get("gp"), 0.0) or 0.0
    ip = safe_float(row.get("pitching_ip"), 0.0) or 0.0
    return {
        "gp": gp,
        "rpg": ((safe_float(row.get("batting_r"), 0.0) or 0.0) / gp) if gp else None,
        "ops": stat_float(row, "batting_ops"),
        "obp": stat_float(row, "batting_obp"),
        "slg": stat_float(row, "batting_slg"),
        "era": stat_float(row, "pitching_era"),
        "whip": stat_float(row, "pitching_whip"),
        "qs_rate": ((safe_float(row.get("pitching_qs"), 0.0) or 0.0) / gp) if gp else None,
        "k9": ((safe_float(row.get("pitching_k"), 0.0) or 0.0) * 9.0 / ip) if ip else None,
        "bb9": ((safe_float(row.get("pitching_bb"), 0.0) or 0.0) * 9.0 / ip) if ip else None,
        "record_w": safe_int(row.get("pitching_w"), 0) or 0,
        "record_l": safe_int(row.get("pitching_l"), 0) or 0,
    }


def summarize_lineup(team_rows: list[dict[str, Any]], hitting: dict[int, dict[str, Any]], team_ops: float | None) -> dict[str, Any]:
    weights = {1: 1.12, 2: 1.10, 3: 1.15, 4: 1.16, 5: 1.08, 6: 1.00, 7: 0.94, 8: 0.90, 9: 0.86, 10: 0.80}
    weighted_ops = []
    total_weight = 0.0
    hr = 0
    rbi = 0
    missing = 0
    names = []
    confirmed = 0
    for row in team_rows:
        order = safe_int(row.get("batting order"), 10) or 10
        pid = safe_int(row.get("mlb id"))
        player = hitting.get(pid or -1, {})
        ops = safe_float(player.get("ops"))
        if ops is None:
            ops = team_ops
            missing += 1
        if ops is not None:
            w = weights.get(order, 0.75)
            weighted_ops.append(ops * w)
            total_weight += w
        hr += safe_int(player.get("hr"), 0) or 0
        rbi += safe_int(player.get("rbi"), 0) or 0
        if str(row.get("confirmed", "")).upper() == "Y":
            confirmed += 1
        names.append(row.get("player name"))
    lineup_ops = sum(weighted_ops) / total_weight if total_weight else team_ops
    return {
        "confirmed": confirmed,
        "count": len(team_rows),
        "confirmed_all": confirmed == len(team_rows) and len(team_rows) > 0,
        "weighted_ops": lineup_ops,
        "hr": hr,
        "rbi": rbi,
        "missing_player_stats": missing,
        "top_names": [n for n in names[:5] if n],
        "weather": team_rows[0].get("weather") if team_rows else "",
    }


def average_odds(odds_rows: list[dict[str, Any]]) -> dict[str, Any]:
    home_ml = [safe_float(r.get("moneyline_home_odds")) for r in odds_rows if safe_float(r.get("moneyline_home_odds")) is not None]
    away_ml = [safe_float(r.get("moneyline_away_odds")) for r in odds_rows if safe_float(r.get("moneyline_away_odds")) is not None]
    totals = [safe_float(r.get("total_value")) for r in odds_rows if safe_float(r.get("total_value")) is not None]
    spread_home = [safe_float(r.get("spread_home_value")) for r in odds_rows if safe_float(r.get("spread_home_value")) is not None]
    best_home = max(home_ml) if home_ml else None
    best_away = max(away_ml) if away_ml else None
    best_home_vendor = None
    best_away_vendor = None
    for r in odds_rows:
        if best_home is not None and safe_float(r.get("moneyline_home_odds")) == best_home:
            best_home_vendor = r.get("vendor")
        if best_away is not None and safe_float(r.get("moneyline_away_odds")) == best_away:
            best_away_vendor = r.get("vendor")
    avg_home = mean(home_ml)
    avg_away = mean(away_ml)
    p_home = american_to_prob(avg_home)
    p_away = american_to_prob(avg_away)
    if p_home is not None and p_away is not None and (p_home + p_away) > 0:
        market_home = p_home / (p_home + p_away)
        market_away = p_away / (p_home + p_away)
    else:
        market_home = market_away = None
    return {
        "avg_home_ml": avg_home,
        "avg_away_ml": avg_away,
        "best_home_ml": best_home,
        "best_away_ml": best_away,
        "best_home_vendor": best_home_vendor,
        "best_away_vendor": best_away_vendor,
        "market_home_prob": market_home,
        "market_away_prob": market_away,
        "total": median(totals),
        "spread_home": median(spread_home),
        "book_count": len(odds_rows),
        "updated_at": max([r.get("updated_at") for r in odds_rows if r.get("updated_at")] or [""]),
    }


def fetch_all_data() -> dict[str, Any]:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    lineup = parse_lineup_csv()

    mlb_schedule = fetch_mlb(
        f"mlb_schedule_{DATE}.json",
        "/api/v1/schedule",
        {
            "sportId": 1,
            "date": DATE,
            "hydrate": "probablePitcher,team,venue",
        },
    )
    history = fetch_mlb(
        f"mlb_history_through_{DATE}.json",
        "/api/v1/schedule",
        {
            "sportId": 1,
            "startDate": f"{SEASON}-03-01",
            "endDate": "2026-06-21",
            "gameType": "R",
        },
    )
    mlb_teams = fetch_mlb(
        f"mlb_teams_{SEASON}.json",
        "/api/v1/teams",
        {"sportId": 1, "season": SEASON},
    )
    espn = http_get_json(
        f"espn_scoreboard_{DATE}.json",
        f"https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates={DATE.replace('-', '')}",
    )

    bdl: dict[str, Any] = {}
    if bdl_headers():
        # BDL dates are UTC-oriented. Late U.S. games on this local slate can
        # appear on the next UTC date, so fetch both and filter by matchup later.
        bdl_dates = [DATE, (dt.date.fromisoformat(DATE) + dt.timedelta(days=1)).isoformat()]
        bdl_game_rows: dict[int, dict[str, Any]] = {}
        bdl_odd_rows: dict[int, dict[str, Any]] = {}
        for bdl_date in bdl_dates:
            game_payload = fetch_bdl(
                f"bdl_games_{bdl_date}.json",
                "/mlb/v1/games",
                [("dates[]", bdl_date), ("per_page", 100)],
            )
            for row in game_payload.get("data", []) or []:
                gid = safe_int(row.get("id"))
                if gid:
                    bdl_game_rows[gid] = row
            try:
                odds_payload = fetch_bdl(
                    f"bdl_odds_{bdl_date}.json",
                    "/mlb/v1/odds",
                    [("dates[]", bdl_date), ("per_page", 100)],
                )
                for row in odds_payload.get("data", []) or []:
                    oid = safe_int(row.get("id"))
                    if oid:
                        bdl_odd_rows[oid] = row
            except Exception:
                pass
        bdl["games"] = {"data": list(bdl_game_rows.values()), "meta": {"dates": bdl_dates}}
        bdl["odds"] = {"data": list(bdl_odd_rows.values()), "meta": {"dates": bdl_dates}}
        bdl_games = bdl["games"].get("data", [])
        bdl_ids = [g.get("id") for g in bdl_games if g.get("id")]
        if not bdl["odds"].get("data"):
            bdl["odds"] = fetch_bdl(
                f"bdl_odds_by_game_{DATE}.json",
                "/mlb/v1/odds",
                [("game_ids[]", gid) for gid in bdl_ids] + [("per_page", 100)],
            )
        bdl["team_stats"] = fetch_bdl(
            f"bdl_team_season_stats_{SEASON}.json",
            "/mlb/v1/teams/season_stats",
            {"season": SEASON, "season_type": "regular", "per_page": 100},
        )
        bdl_team_ids = sorted(
            {
                (g.get("away_team") or {}).get("id")
                for g in bdl_games
                if (g.get("away_team") or {}).get("id")
            }
            | {
                (g.get("home_team") or {}).get("id")
                for g in bdl_games
                if (g.get("home_team") or {}).get("id")
            }
        )
        try:
            bdl["injuries"] = {
                "data": fetch_paginated_bdl(
                    f"bdl_injuries_{DATE}",
                    "/mlb/v1/player_injuries",
                    [("team_ids[]", tid) for tid in bdl_team_ids],
                )
            }
        except Exception:
            bdl["injuries"] = {"data": load_cached_paginated_rows(f"bdl_injuries_{DATE}")}
        try:
            bdl["lineups"] = fetch_bdl(
                f"bdl_lineups_{DATE}.json",
                "/mlb/v1/lineups",
                [("game_ids[]", gid) for gid in bdl_ids] + [("per_page", 100)],
            )
        except Exception:
            bdl["lineups"] = {"data": []}
        try:
            bdl["lab_models"] = fetch_bdl("bdl_lab_models.json", "/lab/v1/models", {"per_page": 100})
        except Exception:
            cached = load_json_if_exists(WORKSPACE / "artifacts" / "balldontlie-docs" / "lab-models-all-response.json")
            bdl["lab_models"] = cached or {"data": []}
        lab_predictions: dict[str, Any] = {}
        for mid in [2352, 2353, 2354]:
            try:
                lab_predictions[str(mid)] = fetch_bdl(
                    f"bdl_lab_predictions_{mid}.json",
                    "/lab/v1/predictions",
                    {"model_id": mid, "per_page": 100},
                )
            except Exception:
                cached = load_json_if_exists(
                    WORKSPACE
                    / "artifacts"
                    / "yankees-tigers-2026-06-22"
                    / f"lab-model-{mid}-predictions-after-generate.json"
                )
                lab_predictions[str(mid)] = cached or {"data": []}
        bdl["lab_predictions"] = lab_predictions
    else:
        bdl["games"] = load_json_if_exists(
            WORKSPACE / "artifacts" / "yankees-tigers-2026-06-22" / "bdl-mlb-games-2026-06-22.json"
        ) or {"data": []}
        bdl["odds"] = {"data": []}
        bdl["team_stats"] = load_json_if_exists(
            WORKSPACE / "artifacts" / "yankees-tigers-2026-06-22" / "bdl-mlb-team-season-stats-2026.json"
        ) or {"data": []}
        bdl["injuries"] = {"data": []}
        bdl["lineups"] = {"data": []}
        bdl["lab_models"] = load_json_if_exists(WORKSPACE / "artifacts" / "balldontlie-docs" / "lab-models-all-response.json") or {"data": []}
        bdl["lab_predictions"] = {}

    schedule_games = [
        parse_mlb_schedule_game(g)
        for d in mlb_schedule.get("dates", []) or []
        for g in d.get("games", []) or []
    ]
    player_ids = []
    for code in {g["away"] for g in schedule_games} | {g["home"] for g in schedule_games}:
        player_ids.extend([r["mlb_id_int"] for r in lineup["by_team"].get(code, []) if r.get("mlb_id_int")])
    pitcher_ids = []
    for g in schedule_games:
        if g["away_probable"].get("id"):
            pitcher_ids.append(g["away_probable"]["id"])
        if g["home_probable"].get("id"):
            pitcher_ids.append(g["home_probable"]["id"])
    hitting_stats = fetch_people_stats(player_ids, group="hitting", filename_prefix="mlb_people_hitting")
    pitching_stats = fetch_people_stats(pitcher_ids, group="pitching", filename_prefix="mlb_people_pitching")

    return {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "date": DATE,
        "csv": lineup,
        "mlb_schedule": mlb_schedule,
        "schedule_games": schedule_games,
        "history": history,
        "mlb_teams": mlb_teams,
        "espn": espn,
        "bdl": bdl,
        "hitting_stats": hitting_stats,
        "pitching_stats": pitching_stats,
    }


def score_games(data: dict[str, Any]) -> dict[str, Any]:
    schedule_games = data["schedule_games"]
    team_id_to_code = {
        safe_int(team.get("id")): canon(team.get("abbreviation"))
        for team in data.get("mlb_teams", {}).get("teams", []) or []
        if safe_int(team.get("id")) is not None
    }
    history = build_history(data["history"], team_id_to_code)
    team_stats_rows = data["bdl"].get("team_stats", {}).get("data", []) or []
    team_stats_by_code = {bdl_team_code(r.get("team")): r for r in team_stats_rows}
    team_metrics = {code: team_stats_metrics(row) for code, row in team_stats_by_code.items()}

    league = {
        "rpg": mean([m.get("rpg") for m in team_metrics.values() if m.get("rpg") is not None]),
        "ops": mean([m.get("ops") for m in team_metrics.values() if m.get("ops") is not None]),
        "era": mean([m.get("era") for m in team_metrics.values() if m.get("era") is not None]),
        "whip": mean([m.get("whip") for m in team_metrics.values() if m.get("whip") is not None]),
        "k9": mean([m.get("k9") for m in team_metrics.values() if m.get("k9") is not None]),
    }
    league_sd = {
        "rpg": stdev([m.get("rpg") for m in team_metrics.values() if m.get("rpg") is not None]),
        "ops": stdev([m.get("ops") for m in team_metrics.values() if m.get("ops") is not None]),
        "era": stdev([m.get("era") for m in team_metrics.values() if m.get("era") is not None]),
        "whip": stdev([m.get("whip") for m in team_metrics.values() if m.get("whip") is not None]),
        "k9": stdev([m.get("k9") for m in team_metrics.values() if m.get("k9") is not None]),
    }

    odds_by_game: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in data["bdl"].get("odds", {}).get("data", []) or []:
        gid = safe_int(row.get("game_id"))
        if gid:
            odds_by_game[gid].append(row)

    bdl_games_by_key: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for g in data["bdl"].get("games", {}).get("data", []) or []:
        key = game_key(bdl_team_code(g.get("away_team")), bdl_team_code(g.get("home_team")))
        bdl_games_by_key[key].append(g)

    injuries_by_team: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in data["bdl"].get("injuries", {}).get("data", []) or []:
        code = bdl_team_code(((item.get("player") or {}).get("team") or {}))
        if code:
            injuries_by_team[code].append(item)

    lab_by_game: dict[int, dict[str, Any]] = defaultdict(dict)
    for model_id, payload in (data["bdl"].get("lab_predictions") or {}).items():
        for row in payload.get("data", []) or []:
            gid = safe_int((row.get("game") or {}).get("id") or row.get("game_id"))
            if gid:
                lab_by_game[gid][str(model_id)] = row

    scored: list[dict[str, Any]] = []
    for game in schedule_games:
        away = game["away"]
        home = game["home"]
        key = game_key(away, home)
        bdl_game = choose_nearest_game(bdl_games_by_key.get(key, []), game.get("date"))
        bdl_game_id = safe_int(bdl_game.get("id"))
        odds_summary = average_odds(odds_by_game.get(bdl_game_id or -1, []))

        away_stats = team_metrics.get(away, {})
        home_stats = team_metrics.get(home, {})
        away_hist = history["by_team"].get(away, [])
        home_hist = history["by_team"].get(home, [])
        away_last10 = summarize_team_history(away_hist, n=10)
        home_last10 = summarize_team_history(home_hist, n=10)
        away_last20 = summarize_team_history(away_hist, n=20)
        home_last20 = summarize_team_history(home_hist, n=20)
        away_road = summarize_team_history(away_hist, as_home=False)
        home_home = summarize_team_history(home_hist, as_home=True)

        away_lineup = summarize_lineup(
            data["csv"]["by_team"].get(away, []),
            data["hitting_stats"],
            away_stats.get("ops"),
        )
        home_lineup = summarize_lineup(
            data["csv"]["by_team"].get(home, []),
            data["hitting_stats"],
            home_stats.get("ops"),
        )

        away_sp = data["pitching_stats"].get(safe_int(game["away_probable"].get("id")) or -1, {})
        home_sp = data["pitching_stats"].get(safe_int(game["home_probable"].get("id")) or -1, {})

        def team_rating(m: dict[str, Any]) -> float:
            return (
                0.30 * z(m.get("rpg"), league["rpg"], league_sd["rpg"])
                + 0.25 * z(m.get("ops"), league["ops"], league_sd["ops"])
                - 0.25 * z(m.get("era"), league["era"], league_sd["era"])
                - 0.15 * z(m.get("whip"), league["whip"], league_sd["whip"])
                + 0.05 * z(m.get("k9"), league["k9"], league_sd["k9"])
            )

        def sp_rating(sp: dict[str, Any]) -> float:
            if not sp:
                return 0.0
            era = sp.get("era")
            whip = sp.get("whip")
            k9 = sp.get("k9")
            return (
                -0.42 * z(era, league["era"], league_sd["era"])
                -0.28 * z(whip, league["whip"], league_sd["whip"])
                +0.20 * z(k9, league["k9"], league_sd["k9"])
            )

        home_base = odds_summary.get("market_home_prob")
        if home_base is None:
            home_base = 0.535
        market_logit = logit(home_base)

        season_adj = 0.20 * (team_rating(home_stats) - team_rating(away_stats))
        recent_adj = 0.055 * ((home_last10.get("rd") or 0.0) - (away_last10.get("rd") or 0.0))
        recent20_adj = 0.025 * ((home_last20.get("rd") or 0.0) - (away_last20.get("rd") or 0.0))
        starter_adj = 0.18 * (sp_rating(home_sp) - sp_rating(away_sp))
        lineup_adj = 2.0 * ((home_lineup.get("weighted_ops") or league["ops"] or 0.720) - (away_lineup.get("weighted_ops") or league["ops"] or 0.720))
        split_adj = 0.10 * ((home_home.get("win_pct") or 0.5) - (away_road.get("win_pct") or 0.5))
        rest_adj = 0.035 * max(-2, min(2, (rest_days(home_hist, DATE) or 0) - (rest_days(away_hist, DATE) or 0)))
        home_inj_pen = injury_penalty(injuries_by_team.get(home, []))
        away_inj_pen = injury_penalty(injuries_by_team.get(away, []))
        injury_adj = away_inj_pen - home_inj_pen

        home_team_row = team_stats_by_code.get(home, {}).get("team") or {}
        away_team_row = team_stats_by_code.get(away, {}).get("team") or {}
        division_game = (
            bool(home_team_row)
            and bool(away_team_row)
            and home_team_row.get("league") == away_team_row.get("league")
            and home_team_row.get("division") == away_team_row.get("division")
        )
        division_adj = 0.0
        h2h_rows = history["h2h"].get(key, []) + history["h2h"].get(game_key(home, away), [])
        h2h_summary = {"gp": len(h2h_rows), "home_wins": 0, "away_wins": 0}
        for h in h2h_rows:
            if h["home"] == home:
                home_won = h["home_score"] > h["away_score"]
            else:
                home_won = h["away_score"] > h["home_score"]
            h2h_summary["home_wins" if home_won else "away_wins"] += 1
        h2h_adj = 0.0
        if h2h_summary["gp"]:
            h2h_adj = 0.035 * ((h2h_summary["home_wins"] / h2h_summary["gp"]) - 0.5)

        adjustment = (
            season_adj
            + recent_adj
            + recent20_adj
            + starter_adj
            + lineup_adj
            + split_adj
            + rest_adj
            + injury_adj
            + division_adj
            + h2h_adj
        )
        independent_prob = sigmoid(0.14 + 2.2 * adjustment)
        home_prob = 0.58 * home_base + 0.42 * independent_prob
        home_prob = max(0.25, min(0.75, home_prob))
        away_prob = 1.0 - home_prob

        selected_side = home if home_prob >= away_prob else away
        selected_prob = max(home_prob, away_prob)
        selected_market = odds_summary.get("market_home_prob") if selected_side == home else odds_summary.get("market_away_prob")
        edge = selected_prob - selected_market if selected_market is not None else None
        selected_best_odds = odds_summary.get("best_home_ml") if selected_side == home else odds_summary.get("best_away_ml")
        selected_vendor = odds_summary.get("best_home_vendor") if selected_side == home else odds_summary.get("best_away_vendor")

        lineup_risk = not away_lineup["confirmed_all"] or not home_lineup["confirmed_all"]
        edge_abs = edge or 0.0
        if edge_abs >= 0.045 and not lineup_risk:
            bet_grade = "A"
            action = "Bet"
        elif edge_abs >= 0.032:
            bet_grade = "B"
            action = "Bet"
        elif edge_abs >= 0.018:
            bet_grade = "C"
            action = "Lean"
        else:
            bet_grade = "Pass"
            action = "Pass"

        weather_adj, weather_note = weather_run_adjustment(home_lineup.get("weather") or away_lineup.get("weather") or "", game.get("venue") or "")
        away_runs = estimate_runs(
            away_stats,
            home_stats,
            away_last10,
            home_last10,
            away_lineup,
            home_sp,
            league,
            is_home=False,
        )
        home_runs = estimate_runs(
            home_stats,
            away_stats,
            home_last10,
            away_last10,
            home_lineup,
            away_sp,
            league,
            is_home=True,
        )
        total_model = max(5.5, min(14.0, away_runs + home_runs + weather_adj))
        margin_home = home_runs - away_runs + (home_prob - 0.5) * 2.0
        market_total = odds_summary.get("total")
        if market_total is not None and total_model - market_total >= 0.65:
            total_pick = f"Over {market_total:.1f}"
            total_edge = total_model - market_total
        elif market_total is not None and market_total - total_model >= 0.65:
            total_pick = f"Under {market_total:.1f}"
            total_edge = market_total - total_model
        else:
            total_pick = "Pass"
            total_edge = 0.0

        runline_pick = "Pass"
        if selected_side == home and margin_home >= 1.10:
            runline_pick = f"{home} -1.5 lean"
        elif selected_side == away and margin_home <= -1.10:
            runline_pick = f"{away} -1.5 lean"
        elif selected_side == home and home_prob >= 0.57 and odds_summary.get("spread_home") == 1.5:
            runline_pick = f"{home} +1.5 parlay-only"
        elif selected_side == away and away_prob >= 0.57:
            runline_pick = f"{away} +1.5/parlay-only"

        lab_signals = {}
        if bdl_game_id and bdl_game_id in lab_by_game:
            for mid, row in lab_by_game[bdl_game_id].items():
                lab_signals[mid] = {
                    "predicted_value": safe_float(row.get("predicted_value")),
                    "confidence": safe_float(row.get("confidence")),
                    "market_value": row.get("market_value"),
                    "edge": safe_float(row.get("edge")),
                }

        timing = "Bet only at or better than play-to price; do not chase."
        if action == "Pass":
            timing = "No pregame bet; monitor live only if price moves materially."
        elif lineup_risk:
            timing = "Wait for confirmed lineups, then bet only if price is still playable."
        elif "weather delay" in weather_note.lower() and total_pick != "Pass":
            timing = "Wait closer to first pitch for weather before totals."
        else:
            timing = "Bet now if this price is still available; re-check odds before submitting."

        play_to_prob = max(0.01, min(0.99, selected_prob - 0.018))
        play_to = prob_to_american(play_to_prob)

        reasons = build_reasons(
            selected_side,
            away,
            home,
            away_stats,
            home_stats,
            away_last10,
            home_last10,
            away_sp,
            home_sp,
            away_lineup,
            home_lineup,
            injuries_by_team,
            weather_note,
            home_prob,
        )

        scored.append(
            {
                "key": key,
                "bdl_game_id": bdl_game_id,
                "game_pk": game["game_pk"],
                "date": game["date"],
                "venue": game["venue"],
                "away": away,
                "home": home,
                "away_name": game["away_name"],
                "home_name": game["home_name"],
                "away_probable": game["away_probable"],
                "home_probable": game["home_probable"],
                "away_sp_stats": away_sp,
                "home_sp_stats": home_sp,
                "odds": odds_summary,
                "home_prob": home_prob,
                "away_prob": away_prob,
                "pick": selected_side,
                "pick_prob": selected_prob,
                "pick_edge": edge,
                "best_odds": selected_best_odds,
                "best_vendor": selected_vendor,
                "play_to": play_to,
                "bet_grade": bet_grade,
                "action": action,
                "total_model": total_model,
                "total_pick": total_pick,
                "total_edge": total_edge,
                "runline_pick": runline_pick,
                "estimated_score": {
                    away: round(away_runs, 2),
                    home: round(home_runs + weather_adj, 2),
                },
                "margin_home": margin_home,
                "weather": home_lineup.get("weather") or away_lineup.get("weather"),
                "weather_note": weather_note,
                "lineup_risk": lineup_risk,
                "division_game": division_game,
                "rest": {
                    away: rest_days(away_hist, DATE),
                    home: rest_days(home_hist, DATE),
                },
                "last10": {away: away_last10, home: home_last10},
                "last20": {away: away_last20, home: home_last20},
                "splits": {"away_road": away_road, "home_home": home_home},
                "lineups": {away: away_lineup, home: home_lineup},
                "team_stats": {away: away_stats, home: home_stats},
                "injuries": {
                    away: summarize_injuries(injuries_by_team.get(away, [])),
                    home: summarize_injuries(injuries_by_team.get(home, [])),
                },
                "h2h": h2h_summary,
                "model_components": {
                    "market_home_prob": home_base,
                    "independent_home_prob": independent_prob,
                    "season_adj": season_adj,
                    "recent_adj": recent_adj + recent20_adj,
                    "starter_adj": starter_adj,
                    "lineup_adj": lineup_adj,
                    "split_adj": split_adj,
                    "rest_adj": rest_adj,
                    "injury_adj": injury_adj,
                    "h2h_adj": h2h_adj,
                    "weather_total_adj": weather_adj,
                },
                "lab_signals": lab_signals,
                "timing": timing,
                "reasons": reasons,
            }
        )

    scored.sort(key=lambda g: g["date"])
    best = sorted([g for g in scored if g["action"] != "Pass"], key=lambda g: g["pick_edge"] or 0.0, reverse=True)
    return {
        "generated_at": data["generated_at"],
        "date": DATE,
        "league_baselines": league,
        "league_sd": league_sd,
        "sources": [
            "Uploaded lineup CSV",
            "BallDontLie MLB API: games, odds, teams season stats, injuries, lineups",
            "BallDontLie Lab API: models and generated prediction rows",
            "MLB Stats API: schedule, probables, player stats, recent form",
            "ESPN scoreboard API: slate cross-check",
        ],
        "games": scored,
        "best_bets": best[:8],
        "notes": [
            "Model probabilities are estimates, not guarantees.",
            "Edges are calculated against de-vigged average market moneyline probability when odds were available.",
            "Lineup risk is flagged when the uploaded CSV did not mark both teams as fully confirmed.",
            "BDL Lab generated rows were used as supporting signals because side labels were not exposed in the prediction schema.",
        ],
    }


def estimate_runs(
    offense: dict[str, Any],
    opp_pitching: dict[str, Any],
    recent_offense: dict[str, Any],
    recent_opp_allowed: dict[str, Any],
    lineup: dict[str, Any],
    opp_sp: dict[str, Any],
    league: dict[str, Any],
    *,
    is_home: bool,
) -> float:
    lg_rpg = league.get("rpg") or 4.45
    rpg = offense.get("rpg") or lg_rpg
    opp_era = opp_pitching.get("era") or league.get("era") or 4.20
    recent_rf = recent_offense.get("rf") or rpg
    recent_ra = recent_opp_allowed.get("ra") or opp_era
    lineup_ops = lineup.get("weighted_ops") or offense.get("ops") or league.get("ops") or 0.720
    ops_adj = (lineup_ops - (league.get("ops") or 0.720)) * 3.2
    sp_era = opp_sp.get("era") or opp_era
    sp_adj = (sp_era - (league.get("era") or 4.20)) * 0.18
    home_bonus = 0.12 if is_home else 0.0
    est = 0.34 * rpg + 0.22 * opp_era + 0.18 * recent_rf + 0.16 * recent_ra + ops_adj + sp_adj + home_bonus
    return max(2.0, min(8.5, est))


def summarize_injuries(rows: list[dict[str, Any]]) -> list[str]:
    out = []
    for item in rows[:5]:
        player = item.get("player") or {}
        name = player.get("full_name") or f"{player.get('first_name', '')} {player.get('last_name', '')}".strip()
        pos = player.get("position") or ""
        status = item.get("status") or ""
        typ = item.get("type") or ""
        if name:
            out.append(f"{name} ({pos}, {status}, {typ})")
    return out


def fmt_num(value: Any, digits: int = 1, default: str = "NA") -> str:
    value = safe_float(value)
    if value is None:
        return default
    return f"{value:.{digits}f}"


def build_reasons(
    selected_side: str,
    away: str,
    home: str,
    away_stats: dict[str, Any],
    home_stats: dict[str, Any],
    away_last10: dict[str, Any],
    home_last10: dict[str, Any],
    away_sp: dict[str, Any],
    home_sp: dict[str, Any],
    away_lineup: dict[str, Any],
    home_lineup: dict[str, Any],
    injuries_by_team: dict[str, list[dict[str, Any]]],
    weather_note: str,
    home_prob: float,
) -> list[str]:
    reasons: list[str] = []
    side_is_home = selected_side == home
    fav_stats = home_stats if side_is_home else away_stats
    dog_stats = away_stats if side_is_home else home_stats
    fav_l10 = home_last10 if side_is_home else away_last10
    dog_l10 = away_last10 if side_is_home else home_last10
    fav_sp = home_sp if side_is_home else away_sp
    dog_sp = away_sp if side_is_home else home_sp
    fav_lineup = home_lineup if side_is_home else away_lineup
    dog_lineup = away_lineup if side_is_home else home_lineup
    prob = home_prob if side_is_home else 1 - home_prob

    if fav_stats.get("rpg") and dog_stats.get("rpg"):
        reasons.append(
            f"{selected_side} run creation: {fmt_num(fav_stats.get('rpg'),2)} R/G vs opponent {fmt_num(dog_stats.get('rpg'),2)} R/G."
        )
    if fav_stats.get("era") and dog_stats.get("era"):
        reasons.append(
            f"Run prevention: {selected_side} staff ERA {fmt_num(fav_stats.get('era'),2)} vs {fmt_num(dog_stats.get('era'),2)}."
        )
    if fav_l10.get("rd") is not None and dog_l10.get("rd") is not None:
        reasons.append(
            f"Last 10 form: {selected_side} {fav_l10['wins']}-{fav_l10['losses']} with {fmt_num(fav_l10.get('rd'),2)} run diff/G."
        )
    if fav_sp.get("era") is not None and dog_sp.get("era") is not None:
        reasons.append(
            f"Starter lens: {fav_sp.get('name','SP')} ERA {fmt_num(fav_sp.get('era'),2)}, WHIP {fmt_num(fav_sp.get('whip'),2)} vs {dog_sp.get('name','SP')} ERA {fmt_num(dog_sp.get('era'),2)}."
        )
    if fav_lineup.get("weighted_ops") and dog_lineup.get("weighted_ops"):
        reasons.append(
            f"Lineup OPS signal: {fmt_num(fav_lineup.get('weighted_ops'),3)} vs {fmt_num(dog_lineup.get('weighted_ops'),3)} from uploaded lineup card."
        )
    fav_inj = injury_penalty(injuries_by_team.get(selected_side, []))
    opp = away if selected_side == home else home
    opp_inj = injury_penalty(injuries_by_team.get(opp, []))
    if opp_inj > fav_inj:
        reasons.append(f"Injury context favors {selected_side}: opponent has the heavier active IL penalty.")
    if weather_note and weather_note != "No weather field":
        reasons.append(f"Weather/park note: {weather_note}.")
    reasons.append(f"Blended win probability: {prob*100:.1f}%.")
    return reasons[:5]


def pct(value: float | None) -> str:
    if value is None:
        return "NA"
    return f"{value * 100:.1f}%"


def money(value: float | int | None) -> str:
    if value is None:
        return "NA"
    value = int(round(float(value)))
    return f"+{value}" if value > 0 else str(value)


def generate_pdf(report: dict[str, Any]) -> None:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import (
        KeepTogether,
        PageBreak,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(PDF_PATH),
        pagesize=letter,
        leftMargin=0.45 * inch,
        rightMargin=0.45 * inch,
        topMargin=0.45 * inch,
        bottomMargin=0.42 * inch,
        title=f"MLB Edge Report {DATE}",
        author="Codex",
    )
    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "ReportTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#17324D"),
        spaceAfter=12,
    )
    h1 = ParagraphStyle(
        "H1",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=16,
        textColor=colors.HexColor("#17324D"),
        spaceBefore=8,
        spaceAfter=6,
    )
    h2 = ParagraphStyle(
        "H2",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=10.5,
        leading=13,
        textColor=colors.HexColor("#17324D"),
        spaceBefore=4,
        spaceAfter=4,
    )
    body = ParagraphStyle(
        "Body",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=8.4,
        leading=10.5,
        alignment=TA_LEFT,
    )
    small = ParagraphStyle(
        "Small",
        parent=body,
        fontSize=7.3,
        leading=9.0,
    )
    tiny = ParagraphStyle(
        "Tiny",
        parent=body,
        fontSize=6.8,
        leading=8.2,
    )
    badge = ParagraphStyle(
        "Badge",
        parent=body,
        fontName="Helvetica-Bold",
        fontSize=8.0,
        leading=9.5,
        textColor=colors.white,
        alignment=TA_CENTER,
    )

    story: list[Any] = []
    gen = report.get("generated_at", "")
    story.append(Paragraph(f"MLB Edge Report - {DATE}", title))
    story.append(
        Paragraph(
            f"Generated from uploaded lineups plus BDL, BDL Lab, MLB Stats, and ESPN data. Snapshot UTC: {gen[:19].replace('T', ' ')}.",
            body,
        )
    )
    story.append(Spacer(1, 8))

    source_text = "; ".join(report.get("sources", []))
    story.append(Paragraph("Source Stack", h1))
    story.append(Paragraph(source_text, small))
    story.append(Paragraph("Risk note: these are probabilistic estimates, not guarantees. Use price discipline and fixed stake sizing.", small))
    story.append(Spacer(1, 8))

    story.append(Paragraph("Best Plays", h1))
    best_rows = [["Grade", "Game", "Primary play", "Prob", "Edge", "Best", "Play to", "Timing"]]
    for g in report.get("best_bets", [])[:8]:
        game = f"{g['away']} at {g['home']}"
        play = f"{g['pick']} ML"
        best = f"{money(g.get('best_odds'))} {g.get('best_vendor') or ''}".strip()
        best_rows.append(
            [
                g["bet_grade"],
                game,
                play,
                pct(g.get("pick_prob")),
                pct(g.get("pick_edge")),
                best,
                money(g.get("play_to")),
                g["timing"],
            ]
        )
    if len(best_rows) == 1:
        best_rows.append(["Pass", "Slate", "No positive edge above threshold", "NA", "NA", "NA", "NA", "Monitor"])
    table = Table(
        [[Paragraph(str(c), tiny if i else small) for c in row] for i, row in enumerate(best_rows)],
        colWidths=[0.45 * inch, 1.05 * inch, 0.9 * inch, 0.52 * inch, 0.46 * inch, 0.75 * inch, 0.55 * inch, 2.15 * inch],
        repeatRows=1,
    )
    table.setStyle(base_table_style())
    story.append(table)
    story.append(Spacer(1, 8))

    story.append(Paragraph("Full Slate", h1))
    slate_rows = [["Game", "Pick", "Prob", "Edge", "ML", "Total Lean", "Run Line", "Lineup"]]
    for g in report["games"]:
        lineup = "Risk" if g.get("lineup_risk") else "OK"
        slate_rows.append(
            [
                f"{g['away']} at {g['home']}",
                f"{g['pick']} ML" if g["action"] != "Pass" else "Pass",
                pct(g.get("pick_prob")),
                pct(g.get("pick_edge")),
                money(g.get("best_odds")),
                g.get("total_pick", "Pass"),
                g.get("runline_pick", "Pass"),
                lineup,
            ]
        )
    slate = Table(
        [[Paragraph(str(c), tiny if i else small) for c in row] for i, row in enumerate(slate_rows)],
        colWidths=[1.05 * inch, 0.75 * inch, 0.48 * inch, 0.45 * inch, 0.45 * inch, 0.85 * inch, 1.0 * inch, 0.45 * inch],
        repeatRows=1,
    )
    slate.setStyle(base_table_style())
    story.append(slate)
    story.append(PageBreak())

    story.append(Paragraph("Game Cards", h1))
    for idx, g in enumerate(report["games"]):
        story.append(game_card(g, h2, body, small, tiny))
        if idx in {3, 7, 11}:
            story.append(PageBreak())
        else:
            story.append(Spacer(1, 6))

    story.append(PageBreak())
    story.append(Paragraph("Method", h1))
    method = (
        "Moneyline probabilities blend de-vigged market odds with an independent matchup model. "
        "The independent layer scores season offense and run prevention, last-10 and last-20 run differential, "
        "starter ERA/WHIP/K9, uploaded lineup OPS, home/away split, rest differential, injury context, division/H2H context, "
        "and weather/park run environment. Totals are estimated from team scoring rates, opponent run prevention, recent form, "
        "probable starters, lineup OPS, and weather/park adjustments. BDL Lab model rows are included as supporting diagnostics; "
        "the generated prediction schema did not expose a clean side label, so they are not allowed to override explicit matchup scoring."
    )
    story.append(Paragraph(method, body))
    story.append(Spacer(1, 6))
    story.append(Paragraph("Stake Discipline", h1))
    story.append(
        Paragraph(
            "Suggested sizing: A plays 0.75 to 1.0 unit, B plays 0.5 unit, C leans 0.25 unit or parlay/live-only. "
            "Pass means no pregame bet unless the market moves enough to create a new edge. Never chase after the play-to price.",
            body,
        )
    )

    def footer(canvas, doc_obj):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#586575"))
        canvas.drawString(0.45 * inch, 0.24 * inch, f"MLB Edge Report {DATE}")
        canvas.drawRightString(7.95 * inch, 0.24 * inch, f"Page {doc_obj.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)


def base_table_style():
    from reportlab.lib import colors
    from reportlab.platypus import TableStyle

    return TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#17324D")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 7.4),
            ("FONTSIZE", (0, 1), (-1, -1), 6.8),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D5DAE1")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F7FA")]),
            ("LEFTPADDING", (0, 0), (-1, -1), 3),
            ("RIGHTPADDING", (0, 0), (-1, -1), 3),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]
    )


def game_card(g: dict[str, Any], h2: Any, body: Any, small: Any, tiny: Any) -> Any:
    from reportlab.lib import colors
    from reportlab.lib.units import inch
    from reportlab.platypus import KeepTogether, Paragraph, Spacer, Table, TableStyle

    title = f"{g['away']} at {g['home']} - {g.get('venue') or ''}"
    pick = f"{g['pick']} ML" if g["action"] != "Pass" else "Pass"
    grade = g.get("bet_grade")
    market_home = g.get("odds", {}).get("market_home_prob")
    market_away = g.get("odds", {}).get("market_away_prob")
    play_to_text = money(g.get("play_to")) if g["action"] != "Pass" else "NA"
    best_text = f"{money(g.get('best_odds'))} {g.get('best_vendor') or ''}".strip() if g["action"] != "Pass" else "NA"
    rows = [
        [
            Paragraph(title, h2),
            Paragraph(f"Primary: {pick} ({grade})", h2),
        ],
        [
            Paragraph(
                f"Prob: {pct(g.get('pick_prob'))} | Edge: {pct(g.get('pick_edge'))} | Best: {best_text} | Play to: {play_to_text}",
                small,
            ),
            Paragraph(
                f"Total: model {fmt_num(g.get('total_model'),1)} vs market {fmt_num(g.get('odds',{}).get('total'),1)} -> {g.get('total_pick')} | Runline: {g.get('runline_pick')}",
                small,
            ),
        ],
        [
            Paragraph(
                f"Market de-vig: {g['away']} {pct(market_away)}, {g['home']} {pct(market_home)} | Est score: {g['away']} {fmt_num(g['estimated_score'].get(g['away']),1)}, {g['home']} {fmt_num(g['estimated_score'].get(g['home']),1)}",
                tiny,
            ),
            Paragraph(f"Timing: {g.get('timing')}", tiny),
        ],
    ]
    table = Table(rows, colWidths=[3.55 * inch, 3.55 * inch])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EAF0F6")),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#AEB8C3")),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#D6DCE3")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    detail_rows = [
        ["Factor", g["away"], g["home"]],
        [
            "Starter",
            f"{g['away_probable'].get('name') or 'TBD'} ({fmt_num(g['away_sp_stats'].get('era'),2)} ERA, {fmt_num(g['away_sp_stats'].get('whip'),2)} WHIP)",
            f"{g['home_probable'].get('name') or 'TBD'} ({fmt_num(g['home_sp_stats'].get('era'),2)} ERA, {fmt_num(g['home_sp_stats'].get('whip'),2)} WHIP)",
        ],
        [
            "Last 10",
            f"{g['last10'][g['away']]['wins']}-{g['last10'][g['away']]['losses']}, RD/G {fmt_num(g['last10'][g['away']].get('rd'),2)}",
            f"{g['last10'][g['home']]['wins']}-{g['last10'][g['home']]['losses']}, RD/G {fmt_num(g['last10'][g['home']].get('rd'),2)}",
        ],
        [
            "Lineup",
            f"OPS {fmt_num(g['lineups'][g['away']].get('weighted_ops'),3)}, confirmed {g['lineups'][g['away']]['confirmed']}/{g['lineups'][g['away']]['count']}",
            f"OPS {fmt_num(g['lineups'][g['home']].get('weighted_ops'),3)}, confirmed {g['lineups'][g['home']]['confirmed']}/{g['lineups'][g['home']]['count']}",
        ],
        [
            "Injuries",
            "; ".join(g["injuries"][g["away"]][:2]) or "None flagged",
            "; ".join(g["injuries"][g["home"]][:2]) or "None flagged",
        ],
        ["Weather", g.get("weather_note") or "NA", g.get("weather") or "NA"],
    ]
    details = Table(
        [[Paragraph(str(c), tiny) for c in row] for row in detail_rows],
        colWidths=[0.75 * inch, 3.15 * inch, 3.15 * inch],
        repeatRows=1,
    )
    details.setStyle(base_table_style())
    reason_text = " ".join(g.get("reasons") or [])
    return KeepTogether([table, Spacer(1, 4), details, Spacer(1, 3), Paragraph(f"Read: {reason_text}", tiny)])


def main() -> None:
    data = fetch_all_data()
    report = score_games(data)
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_JSON.write_text(json.dumps(report, indent=2), encoding="utf-8")
    generate_pdf(report)
    print(json.dumps({"pdf": str(PDF_PATH), "report_json": str(REPORT_JSON), "games": len(report["games"])}, indent=2))


if __name__ == "__main__":
    main()
