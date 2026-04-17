import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "king-of-the-court-state";
const DISCOVERY_DOCS = [
  "https://sheets.googleapis.com/$discovery/rest?version=v4",
];
const SCOPES = "https://www.googleapis.com/auth/spreadsheets";

const TEAM_COLORS = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#22c55e", // green
  "#eab308", // yellow
  "#a855f7", // purple
  "#f97316", // orange
  "#ec4899", // pink
  "#06b6d4", // cyan
];

const defaultTeams = [
  {
    id: "team1",
    name: "Team 1",
    players: ["", ""],
    score: 0,
    color: TEAM_COLORS[0],
  },
  {
    id: "team2",
    name: "Team 2",
    players: ["", ""],
    score: 0,
    color: TEAM_COLORS[1],
  },
  {
    id: "team3",
    name: "Team 3",
    players: ["", ""],
    score: 0,
    color: TEAM_COLORS[2],
  },
  {
    id: "team4",
    name: "Team 4",
    players: ["", ""],
    score: 0,
    color: TEAM_COLORS[3],
  },
];

const defaultState = {
  phase: "setup",
  gender: "men",
  durationMinutes: 15,
  remainingSeconds: 15 * 60,
  isRunning: false,
  started: false,
  swapSides: false,
  darkMode: true,
  teams: defaultTeams,
  positions: {
    king: "team1",
    challenger: "team2",
    queue: ["team3", "team4"],
  },
  history: [],
  lastAction: "",
};

const deepClone = (value) => JSON.parse(JSON.stringify(value));

function snapshot(state) {
  const { history, ...rest } = state;
  return deepClone(rest);
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function App() {
  const [state, setState] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const merged = { ...defaultState, ...parsed };
        if (merged.phase === "playing") merged.phase = "game";
        merged.teams = merged.teams.map((team, i) => ({
          ...team,
          color: team.color || TEAM_COLORS[i % TEAM_COLORS.length],
        }));
        return merged;
      }
    } catch (error) {
      console.warn("Failed to load saved state", error);
    }
    return defaultState;
  });
  const [gapiLoaded, setGapiLoaded] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [sheetStatus, setSheetStatus] = useState("");
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  // ── Animation refs ──
  const cardRefs = useRef({});
  const lbRefs = useRef({});
  const prevPositions = useRef(null);
  const prevLbPositions = useRef(null);
  const prevRoles = useRef(null);

  const setCardRef = (teamId) => (el) => {
    if (el) cardRefs.current[teamId] = el;
    else delete cardRefs.current[teamId];
  };

  const setLbRef = (teamId) => (el) => {
    if (el) lbRefs.current[teamId] = el;
    else delete lbRefs.current[teamId];
  };

  const capturePositions = () => {
    const positions = {};
    for (const [id, el] of Object.entries(cardRefs.current)) {
      if (el) {
        const rect = el.getBoundingClientRect();
        positions[id] = {
          x: rect.left,
          y: rect.top,
          w: rect.width,
          h: rect.height,
        };
      }
    }
    return positions;
  };

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const spreadsheetId = import.meta.env.VITE_GOOGLE_SPREADSHEET_ID;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage full, skip
    }
  }, [state]);

  useEffect(() => {
    document.documentElement.classList.toggle("light-theme", !state.darkMode);
  }, [state.darkMode]);

  useEffect(() => {
    if (!clientId || !spreadsheetId) {
      return;
    }

    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.onload = () => {
      if (!window.gapi) {
        setSheetStatus("Google API failed to load.");
        return;
      }

      window.gapi.load("client:auth2", async () => {
        try {
          await window.gapi.client.init({
            clientId,
            discoveryDocs: DISCOVERY_DOCS,
            scope: SCOPES,
          });
          setGapiLoaded(true);
          const authInstance = window.gapi.auth2.getAuthInstance();
          setAuthorized(authInstance.isSignedIn.get());
          authInstance.isSignedIn.listen((signedIn) => setAuthorized(signedIn));
        } catch (error) {
          setSheetStatus("Google client initialization failed.");
          console.error(error);
        }
      });
    };
    script.onerror = () => setSheetStatus("Unable to load Google API script.");
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, [clientId, spreadsheetId]);

  useEffect(() => {
    if (!state.isRunning || state.phase !== "game") {
      return;
    }
    if (state.remainingSeconds <= 0) {
      setState((prev) => ({ ...prev, isRunning: false }));
      return;
    }
    const interval = setInterval(() => {
      setState((prev) => {
        if (!prev.isRunning || prev.phase !== "game") {
          return prev;
        }
        if (prev.remainingSeconds <= 1) {
          return { ...prev, remainingSeconds: 0, isRunning: false };
        }
        return { ...prev, remainingSeconds: prev.remainingSeconds - 1 };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [state.isRunning, state.phase]);

  const teamById = useMemo(
    () => state.teams.reduce((map, team) => ({ ...map, [team.id]: team }), {}),
    [state.teams],
  );

  const kingTeam = teamById[state.positions.king];
  const challengerTeam = teamById[state.positions.challenger];
  const queueTeams = state.positions.queue
    .map((id) => teamById[id])
    .filter(Boolean);

  const handleTeamField = (teamId, field, value) => {
    setState((prev) => ({
      ...prev,
      teams: prev.teams.map((team) =>
        team.id === teamId ? { ...team, [field]: value } : team,
      ),
    }));
  };

  const handlePlayerName = (teamId, index, value) => {
    setState((prev) => ({
      ...prev,
      teams: prev.teams.map((team) =>
        team.id === teamId
          ? {
              ...team,
              players: team.players.map((player, playerIndex) =>
                playerIndex === index ? value : player,
              ),
            }
          : team,
      ),
    }));
  };

  const handleGenderChange = (value) => {
    setState((prev) => ({ ...prev, gender: value }));
  };

  const handleDurationChange = (value) => {
    if (value === "") {
      setState((prev) => ({
        ...prev,
        durationMinutes: "",
        remainingSeconds: 0,
      }));
      return;
    }
    const minutes = Number(value);
    if (Number.isNaN(minutes) || minutes < 0) {
      return;
    }
    setState((prev) => ({
      ...prev,
      durationMinutes: minutes,
      remainingSeconds: minutes * 60,
    }));
  };

  const addTeam = () => {
    setState((prev) => {
      const existingIds = new Set(prev.teams.map((t) => t.id));
      let num = prev.teams.length + 1;
      while (existingIds.has(`team${num}`)) num++;
      const id = `team${num}`;
      return {
        ...prev,
        teams: [
          ...prev.teams,
          {
            id,
            name: `Team ${prev.teams.length + 1}`,
            players: ["", ""],
            score: 0,
            color: TEAM_COLORS[prev.teams.length % TEAM_COLORS.length],
          },
        ],
        positions: { ...prev.positions, queue: [...prev.positions.queue, id] },
      };
    });
  };

  const removeTeam = (teamId) => {
    setState((prev) => {
      if (prev.teams.length <= 3) return prev;
      const teams = prev.teams.filter((t) => t.id !== teamId);
      const queue = prev.positions.queue.filter((id) => id !== teamId);

      // Promote through the position chain: king ← challenger ← queue
      let king = prev.positions.king;
      let challenger = prev.positions.challenger;

      if (king === teamId) {
        king = challenger;
        challenger = queue.length > 0 ? queue.shift() : null;
      } else if (challenger === teamId) {
        challenger = queue.length > 0 ? queue.shift() : null;
      }

      return {
        ...prev,
        teams,
        positions: { king, challenger, queue },
      };
    });
  };

  const continueToGame = () => {
    const distinctTeamIds = new Set([
      state.positions.king,
      state.positions.challenger,
      ...state.positions.queue,
    ]);
    if (distinctTeamIds.size < 3) {
      setSheetStatus("Select at least 3 distinct teams before continuing.");
      return;
    }
    setSheetStatus("");
    setState((prev) => ({
      ...prev,
      phase: "game",
      remainingSeconds: prev.started
        ? prev.remainingSeconds
        : prev.durationMinutes * 60,
    }));
  };

  const startMatch = () => {
    setState((prev) => {
      const minutes = prev.durationMinutes || 15;
      return {
        ...prev,
        started: true,
        isRunning: true,
        durationMinutes: minutes,
        remainingSeconds: minutes * 60,
        history: [snapshot(prev)],
        lastAction: "Match started",
      };
    });
  };

  const goToSettings = () => {
    setState((prev) => ({
      ...prev,
      phase: "setup",
      isRunning: false,
    }));
  };

  const recordRound = (winnerSide) => {
    setState((prev) => {
      if (
        prev.phase !== "game" ||
        !prev.started ||
        prev.positions.queue.length === 0
      ) {
        return prev;
      }
      const prevKing = prev.positions.king;
      const prevChallenger = prev.positions.challenger;
      const queue = [...prev.positions.queue];
      const nextState = deepClone(prev);
      nextState.history = [...prev.history, snapshot(prev)];
      nextState.lastAction =
        winnerSide === "king" ? "King side won" : "Challenger side won";

      if (winnerSide === "king") {
        nextState.teams = nextState.teams.map((team) =>
          team.id === prevKing ? { ...team, score: team.score + 1 } : team,
        );
        queue.push(prevChallenger);
        nextState.positions = {
          ...prev.positions,
          challenger: queue.shift(),
          queue,
        };
      } else {
        queue.push(prevKing);
        nextState.positions = {
          ...prev.positions,
          king: prevChallenger,
          challenger: queue.shift(),
          queue,
        };
      }
      return nextState;
    });
  };

  const undoAction = () => {
    setState((prev) => {
      const history = [...prev.history];
      if (history.length === 0) {
        return prev;
      }
      const last = history.pop();
      if (!last) return prev;
      return {
        ...last,
        history,
        darkMode: prev.darkMode,
        swapSides: prev.swapSides,
      };
    });
  };

  const toggleTimer = () => {
    setState((prev) => {
      if (!prev.started) return prev;
      return { ...prev, isRunning: !prev.isRunning };
    });
  };

  // ── Animated wrappers (capture positions before state change) ──
  const captureLbPositions = () => {
    const positions = {};
    for (const [id, el] of Object.entries(lbRefs.current)) {
      if (el) {
        const rect = el.getBoundingClientRect();
        positions[id] = { x: rect.left, y: rect.top };
      }
    }
    return positions;
  };

  const triggerAnimation = () => {
    prevPositions.current = capturePositions();
    prevLbPositions.current = captureLbPositions();
    prevRoles.current = {
      king: state.positions.king,
      challenger: state.positions.challenger,
      queue: new Set(state.positions.queue),
    };
  };

  const animatedRecordRound = (winnerSide) => {
    triggerAnimation();
    recordRound(winnerSide);
  };

  const animatedUndo = () => {
    triggerAnimation();
    undoAction();
  };

  // ── FLIP + fade animation after re-render ──
  const positionsKey =
    state.positions.king +
    "|" +
    state.positions.challenger +
    "|" +
    state.positions.queue.join(",");

  useLayoutEffect(() => {
    const prev = prevPositions.current;
    const roles = prevRoles.current;
    if (!prev || !roles) return;
    prevPositions.current = null;
    prevRoles.current = null;

    const nowQueue = new Set(state.positions.queue);
    const ease = "cubic-bezier(0.25, 0.46, 0.45, 0.94)";

    for (const [teamId, el] of Object.entries(cardRefs.current)) {
      if (!el || !prev[teamId]) continue;

      const wasKing = teamId === roles.king;
      const wasChallenger = teamId === roles.challenger;
      const wasInQueue = roles.queue.has(teamId);
      const isKing = teamId === state.positions.king;
      const isChallenger = teamId === state.positions.challenger;
      const isInQueue = nowQueue.has(teamId);

      const newRect = el.getBoundingClientRect();
      const old = prev[teamId];
      const dx = old.x - newRect.left;
      const dy = old.y - newRect.top;

      if (wasKing && isInQueue) {
        // King → queue: fade out/in
        el.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 500,
          easing: "ease-in-out",
        });
      } else if (wasInQueue && isChallenger) {
        // Queue top → challenger: move + resize
        const sw = old.w / newRect.width;
        const sh = old.h / newRect.height;
        el.animate(
          [
            {
              transform: `translate(${dx}px, ${dy}px) scale(${sw}, ${sh})`,
              transformOrigin: "top left",
            },
            {
              transform: "translate(0, 0) scale(1, 1)",
              transformOrigin: "top left",
            },
          ],
          { duration: 400, easing: ease },
        );
      } else if (wasChallenger && isKing) {
        // Challenger → king: move
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
        el.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: "translate(0, 0)" },
          ],
          { duration: 400, easing: ease },
        );
      } else if (wasInQueue && isInQueue) {
        // Within queue: move
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
        el.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: "translate(0, 0)" },
          ],
          { duration: 350, easing: ease },
        );
      } else if (wasChallenger && isInQueue) {
        // Challenger → queue (undo case): fade
        el.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 500,
          easing: "ease-in-out",
        });
      } else if (wasKing && isChallenger) {
        // King → challenger (undo case): move
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
        el.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: "translate(0, 0)" },
          ],
          { duration: 400, easing: ease },
        );
      } else if (wasInQueue && isKing) {
        // Queue → king (undo case): move + resize
        const sw = old.w / newRect.width;
        const sh = old.h / newRect.height;
        el.animate(
          [
            {
              transform: `translate(${dx}px, ${dy}px) scale(${sw}, ${sh})`,
              transformOrigin: "top left",
            },
            {
              transform: "translate(0, 0) scale(1, 1)",
              transformOrigin: "top left",
            },
          ],
          { duration: 400, easing: ease },
        );
      }
    }
  }, [positionsKey]);

  // Stable leaderboard: only overtake when strictly higher
  const lbOrderRef = useRef(null);

  const stableLeaderboard = useMemo(() => {
    const scores = {};
    for (const t of state.teams) scores[t.id] = t.score;

    if (!lbOrderRef.current) {
      // Initial sort by score ascending, tiebreak by original team order
      const sorted = [...state.teams].sort((a, b) => a.score - b.score);
      lbOrderRef.current = sorted.map((t) => t.id);
    }

    // Remove deleted teams, add new ones at the start (lowest)
    const prev = lbOrderRef.current.filter((id) => id in scores);
    for (const t of state.teams) {
      if (!prev.includes(t.id)) prev.unshift(t.id);
    }

    // Bubble sort: only swap adjacent pairs when the left one is STRICTLY higher
    const order = [...prev];
    let swapped = true;
    while (swapped) {
      swapped = false;
      for (let i = 0; i < order.length - 1; i++) {
        if (scores[order[i]] > scores[order[i + 1]]) {
          [order[i], order[i + 1]] = [order[i + 1], order[i]];
          swapped = true;
        }
      }
    }

    lbOrderRef.current = order;
    return order.map((id) => state.teams.find((t) => t.id === id));
  }, [state.teams]);

  // Leaderboard FLIP animation
  const scoresKey = stableLeaderboard.map((t) => t.id).join("|");
  useLayoutEffect(() => {
    const prev = prevLbPositions.current;
    if (!prev) return;
    prevLbPositions.current = null;

    for (const [teamId, el] of Object.entries(lbRefs.current)) {
      if (!el || !prev[teamId]) continue;
      const newRect = el.getBoundingClientRect();
      const dx = prev[teamId].x - newRect.left;
      const dy = prev[teamId].y - newRect.top;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;

      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: "translate(0, 0)" },
        ],
        {
          duration: 700,
          easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        },
      );
    }
  }, [scoresKey]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (state.phase !== "game" || !state.started) {
        return;
      }
      if (["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "k") {
        animatedRecordRound("king");
      } else if (key === "c") {
        animatedRecordRound("challenger");
      } else if (key === "u") {
        animatedUndo();
      } else if (key === "p" || key === " ") {
        event.preventDefault();
        toggleTimer();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    state.phase,
    state.started,
    animatedRecordRound,
    animatedUndo,
    toggleTimer,
  ]);

  const resetGame = () => {
    setState((prev) => ({
      ...prev,
      phase: "setup",
      isRunning: false,
      started: false,
      remainingSeconds: (prev.durationMinutes || 15) * 60,
      history: [],
      lastAction: "",
      teams: prev.teams.map((team) => ({ ...team, score: 0 })),
    }));
  };

  const signIn = async () => {
    if (!gapiLoaded) {
      setSheetStatus("Google API not loaded yet.");
      return;
    }
    try {
      await window.gapi.auth2.getAuthInstance().signIn();
    } catch (error) {
      setSheetStatus("Google sign-in failed.");
      console.error(error);
    }
  };

  const signOut = async () => {
    if (!gapiLoaded) {
      return;
    }
    try {
      await window.gapi.auth2.getAuthInstance().signOut();
    } catch (error) {
      console.error(error);
    }
  };

  const saveMatchToSheet = async () => {
    if (!clientId || !spreadsheetId) {
      setSheetStatus(
        "Set VITE_GOOGLE_CLIENT_ID and VITE_GOOGLE_SPREADSHEET_ID in .env.",
      );
      return;
    }
    if (!authorized) {
      setSheetStatus("Sign in first to save match state.");
      return;
    }
    const timestamp = new Date().toISOString();
    const values = [
      timestamp,
      state.gender,
      kingTeam?.name || "",
      challengerTeam?.name || "",
      kingTeam?.score ?? 0,
      challengerTeam?.score ?? 0,
      queueTeams.map((team) => team.name).join(" | "),
      state.phase,
      state.remainingSeconds,
      state.lastAction,
    ];
    try {
      await window.gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "Events!A1",
        valueInputOption: "USER_ENTERED",
        resource: {
          values: [values],
        },
      });
      setSheetStatus("Saved snapshot to Google Sheets.");
    } catch (error) {
      setSheetStatus("Failed to save to Google Sheets.");
      console.error(error);
    }
  };

  // ── Drag-and-drop for starting positions ──
  const [drag, setDrag] = useState(null);
  const [hoverIdx, setHoverIdx] = useState(null);

  const orderedPositions = [
    state.positions.king,
    state.positions.challenger,
    ...state.positions.queue,
  ];

  const roleLabel = (index) =>
    index === 0
      ? kingLabel.toUpperCase()
      : index === 1
        ? "CHALLENGER"
        : `QUEUE ${index - 1}`;

  const handleDragStart = (e, idx) => {
    setDrag({ idx, height: e.currentTarget.offsetHeight + 6 });
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e, idx) => {
    e.preventDefault();
    if (hoverIdx !== idx) setHoverIdx(idx);
  };

  const handleDragEnd = () => {
    if (drag !== null && hoverIdx !== null && drag.idx !== hoverIdx) {
      const newOrder = [...orderedPositions];
      const [moved] = newOrder.splice(drag.idx, 1);
      newOrder.splice(hoverIdx, 0, moved);
      setState((prev) => ({
        ...prev,
        positions: {
          king: newOrder[0],
          challenger: newOrder[1],
          queue: newOrder.slice(2),
        },
      }));
    }
    setDrag(null);
    setHoverIdx(null);
  };

  const getPositionStyle = (index) => {
    if (!drag || hoverIdx === null || drag.idx === hoverIdx) return {};
    const { idx: fromIdx, height } = drag;
    if (index === fromIdx) return { opacity: 0.3 };
    if (fromIdx < hoverIdx) {
      if (index > fromIdx && index <= hoverIdx) {
        return { transform: `translateY(-${height}px)` };
      }
    } else {
      if (index >= hoverIdx && index < fromIdx) {
        return { transform: `translateY(${height}px)` };
      }
    }
    return {};
  };

  const queueWarning = state.positions.queue.length === 0;
  const kingLabel = state.gender === "women" ? "Queen" : "King";
  const title = `${kingLabel} of the Court`;
  const timerDone = state.remainingSeconds <= 0;

  if (state.phase === "setup") {
    return (
      <div className="app-shell">
        <header className="app-header">
          <div>
            <h1>{title}</h1>
            <p className="subtitle"></p>
          </div>
          <div className="header-right">
            <div className="sheet-status">
              {clientId && spreadsheetId ? (
                authorized ? (
                  <button onClick={signOut} className="secondary-button">
                    Sign out
                  </button>
                ) : (
                  <button onClick={signIn} className="secondary-button">
                    Sign in to Sheets
                  </button>
                )
              ) : (
                <span className="hint"></span>
              )}
              {sheetStatus && <div className="status-text">{sheetStatus}</div>}
            </div>
            <button
              onClick={continueToGame}
              className="primary-button continue-btn"
            >
              Continue
            </button>
          </div>
        </header>

        <main className="setup-grid">
          <section className="panel">
            <h2>Settings</h2>
            <div className="field-group">
              <label>Gender</label>
              <div className="radio-row">
                <label>
                  <input
                    type="radio"
                    name="gender"
                    value="men"
                    checked={state.gender === "men"}
                    onChange={() => handleGenderChange("men")}
                  />
                  Men
                </label>
                <label>
                  <input
                    type="radio"
                    name="gender"
                    value="women"
                    checked={state.gender === "women"}
                    onChange={() => handleGenderChange("women")}
                  />
                  Women
                </label>
              </div>
            </div>
            <div className="field-group">
              <label>Match time (minutes)</label>
              <input
                type="number"
                min="1"
                max="60"
                value={state.durationMinutes}
                onChange={(event) => handleDurationChange(event.target.value)}
                placeholder="15"
              />
            </div>
            <div className="field-group">
              <label>Choose {kingLabel} Side</label>
              <div className="side-picker">
                <button
                  className={
                    "side-card" + (state.swapSides ? " side-active" : "")
                  }
                  onClick={() =>
                    setState((prev) => ({ ...prev, swapSides: true }))
                  }
                >
                  {state.swapSides ? kingLabel : "Challenger"}
                </button>
                <button
                  className={
                    "side-card" + (!state.swapSides ? " side-active" : "")
                  }
                  onClick={() =>
                    setState((prev) => ({ ...prev, swapSides: false }))
                  }
                >
                  {!state.swapSides ? kingLabel : "Challenger"}
                </button>
              </div>
            </div>
            <div className="field-group">
              <label className="toggle-row">
                <span>Dark mode</span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={state.darkMode}
                    onChange={() =>
                      setState((prev) => ({
                        ...prev,
                        darkMode: !prev.darkMode,
                      }))
                    }
                  />
                  <span className="toggle-track" />
                </span>
              </label>
            </div>
          </section>

          <section className="panel teams-panel">
            <h2>Teams and players</h2>
            {state.teams.map((team, index) => (
              <div
                key={team.id}
                className="setup-team-card"
                style={{ "--team-color": team.color }}
              >
                <div className="setup-team-inputs">
                  <input
                    className="setup-team-name-input"
                    value={team.name}
                    onChange={(event) =>
                      handleTeamField(team.id, "name", event.target.value)
                    }
                    placeholder={`Team ${index + 1}`}
                  />
                  <div className="setup-team-players">
                    <input
                      value={team.players[0]}
                      onChange={(event) =>
                        handlePlayerName(team.id, 0, event.target.value)
                      }
                      placeholder="Player 1"
                    />
                    <input
                      value={team.players[1]}
                      onChange={(event) =>
                        handlePlayerName(team.id, 1, event.target.value)
                      }
                      placeholder="Player 2"
                    />
                  </div>
                </div>
                <button
                  className="remove-team-btn"
                  onClick={() => removeTeam(team.id)}
                  disabled={state.teams.length <= 3}
                  title="Remove team"
                >
                  &times;
                </button>
              </div>
            ))}
            <button onClick={addTeam} className="secondary-button">
              Add team
            </button>
          </section>

          <section className="panel starting-panel">
            <h2>Starting positions</h2>
            <p className="position-hint">Drag to reorder</p>
            <div className="position-list">
              {orderedPositions.map((teamId, index) => {
                const team = teamById[teamId];
                return (
                  <div
                    key={teamId}
                    className={
                      "position-row" + (drag?.idx === index ? " dragging" : "")
                    }
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    onDrop={handleDragEnd}
                    style={getPositionStyle(index)}
                  >
                    <div className="position-role-header">
                      {roleLabel(index)}
                    </div>
                    <div
                      className="queue-card"
                      style={{ "--team-color": team?.color }}
                    >
                      <div className="queue-card-info">
                        <div className="queue-card-name">
                          {team?.name || teamId}
                        </div>
                        <div className="queue-card-players">
                          {team?.players.filter(Boolean).join(" / ") || "TBD"}
                        </div>
                      </div>
                      <div className="queue-card-score">{team?.score ?? 0}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {queueWarning && (
              <p className="warning-text">Add more teams to build a queue.</p>
            )}
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell game-shell">
      <div className="timer-bar">
        <button onClick={goToSettings} className="back-btn">
          Settings
        </button>
        <div className="timer-center">
          <div className="timer-label">COUNTDOWN</div>
          <div
            className={
              "time-display" + (timerDone && state.started ? " time-done" : "")
            }
          >
            {formatTime(state.remainingSeconds)}
          </div>
        </div>
        {!state.started ? (
          <button onClick={startMatch} className="primary-button start-btn">
            Start Match
          </button>
        ) : (
          <button onClick={toggleTimer} className="primary-button start-btn">
            {state.isRunning ? "Pause" : "Resume"}
          </button>
        )}
      </div>

      <div className={"game-body" + (state.swapSides ? " swapped" : "")}>
        {/* Sidebar: queue */}
        <div className="game-sidebar-col">
          <div className="queue-sidebar-title">NEXT UP</div>
          <div className="queue-sidebar-cards">
            {queueTeams.length === 0 ? (
              <div className="empty-text">No teams in queue</div>
            ) : (
              queueTeams.map((team) => (
                <div
                  key={team.id}
                  ref={setCardRef(team.id)}
                  className="queue-card"
                  style={{ "--team-color": team.color }}
                >
                  <div className="queue-card-info">
                    <div className="queue-card-name">{team.name}</div>
                    <div className="queue-card-players">
                      {team.players.filter(Boolean).join(" / ") || "TBD"}
                    </div>
                  </div>
                  <div className="queue-card-score">{team.score}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Main column: court + controls */}
        <div className="game-main-col">
          <div className="court-area">
            {(() => {
              const challengerCard = (
                <div
                  key="challenger"
                  ref={setCardRef(state.positions.challenger)}
                  className="court-card"
                  style={{ "--team-color": challengerTeam?.color }}
                >
                  <div className="position-label">CHALLENGER</div>
                  <div className="court-team-name">
                    {challengerTeam?.name || "Challenger"}
                  </div>
                  <div className="court-players">
                    {challengerTeam?.players.filter(Boolean).join(" / ") ||
                      "Players"}
                  </div>
                  <div className="court-score">
                    {challengerTeam?.score ?? 0}
                  </div>
                  <button
                    onClick={() => animatedRecordRound("challenger")}
                    className="win-btn"
                    disabled={!state.started}
                  >
                    Challenger Wins
                  </button>
                </div>
              );
              const kingCard = (
                <div
                  key="king"
                  ref={setCardRef(state.positions.king)}
                  className="court-card"
                  style={{ "--team-color": kingTeam?.color }}
                >
                  <div className="position-label">
                    {kingLabel.toUpperCase()}
                  </div>
                  <div className="court-team-name">
                    {kingTeam?.name || kingLabel}
                  </div>
                  <div className="court-players">
                    {kingTeam?.players.filter(Boolean).join(" / ") || "Players"}
                  </div>
                  <div className="court-score">{kingTeam?.score ?? 0}</div>
                  <button
                    onClick={() => animatedRecordRound("king")}
                    className="win-btn"
                    disabled={!state.started}
                  >
                    {kingLabel} Wins
                  </button>
                </div>
              );
              const left = state.swapSides ? kingCard : challengerCard;
              const right = state.swapSides ? challengerCard : kingCard;
              return (
                <>
                  {left}
                  <div className="court-vs">VS</div>
                  {right}
                </>
              );
            })()}
          </div>

          <div className="leaderboard">
            <button
              className="leaderboard-label"
              onClick={() => setShowLeaderboard(true)}
            >
              LEADERBOARD
            </button>
            <div className="leaderboard-cards">
              {[...stableLeaderboard].reverse().map((team) => (
                <div
                  key={team.id}
                  ref={setLbRef(team.id)}
                  className="queue-card"
                  style={{ "--team-color": team.color }}
                >
                  <div className="queue-card-info">
                    <div className="queue-card-name">{team.name}</div>
                    <div className="queue-car(--team-color, #3b82f6) 30%, rgbad-players">
                      {team.players.filter(Boolean).join(" / ") || "TBD"}
                    </div>
                  </div>
                  <div className="queue-card-score">{team.score}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="game-actions">
            <button
              onClick={animatedUndo}
              className="secondary-button"
              disabled={!state.started || state.history.length === 0}
            >
              Undo
            </button>
            <button onClick={resetGame} className="secondary-button">
              New Match
            </button>
            <button
              onClick={() => setShowLeaderboard(true)}
              className="secondary-button mobile-only"
            >
              Leaderboard
            </button>
          </div>
          <span className="shortcuts-hint">
            Hotkeys: Challenger win (C) / {kingLabel} win (K) / Undo (U) / Pause
            (P)
          </span>
        </div>
      </div>

      {showLeaderboard && (
        <div
          className="modal-overlay"
          onClick={() => setShowLeaderboard(false)}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Leaderboard</h2>
              <button
                className="modal-close"
                onClick={() => setShowLeaderboard(false)}
              >
                &times;
              </button>
            </div>
            <div className="modal-cards">
              {[...stableLeaderboard].reverse().map((team, index) => (
                <div
                  key={team.id}
                  className="queue-card"
                  style={{ "--team-color": team.color }}
                >
                  <div className="queue-card-info">
                    <div className="queue-card-name">
                      {index === 0 && (
                        <svg
                          className="crown-icon"
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                          fill="currentColor"
                        >
                          <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5z" />
                        </svg>
                      )}
                      {team.name}
                    </div>
                    <div className="queue-card-players">
                      {team.players.filter(Boolean).join(" / ") || "TBD"}
                    </div>
                  </div>
                  <div className="queue-card-score">{team.score}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
