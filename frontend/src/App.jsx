
import { useEffect, useRef, useState } from "react";
import "./App.css";

const API = (import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? "http://localhost:5001/api" : "/api")).replace(/\/$/, "");

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

function formatPercent(value) {
  // Missing or unavailable statistics are unknown, not a true 0% rate.
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) {
    return "N/A";
  }
  return `${Number(value).toFixed(2)}%`;
}

function formatDuration(seconds) {
  if (seconds == null) return "—";
  const total = Number(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function getVideoId(video) {
  return video.video_id || video.id || "";
}

function getThumbnail(video) {
  return (
    video.thumbnail_url ||
    video.thumbnail ||
    (getVideoId(video)
      ? `https://i.ytimg.com/vi/${getVideoId(video)}/mqdefault.jpg`
      : "")
  );
}

function Metric({ label, value, detail }) {
  return (
    <article className="metric-card">
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      <span className="metric-detail">{detail}</span>
    </article>
  );
}

function VideoCard({ video, rank }) {
  const id = getVideoId(video);
  return (
    <article className="video-card">
      {getThumbnail(video) ? (
        <img src={getThumbnail(video)} alt="" className="video-thumbnail" />
      ) : (
        <div className="video-thumbnail thumbnail-placeholder">▶</div>
      )}
      <div className="video-card-content">
        {rank && <span className="rank-label">{rank}</span>}
        <h3>{video.title || "Untitled video"}</h3>
        <div className="video-stats">
          <span>{formatNumber(video.views)} views</span>
          <span>{formatDuration(video.duration_seconds ?? video.duration)}</span>
        </div>
        {id && (
          <a
            href={`https://www.youtube.com/watch?v=${id}`}
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            Watch video ↗
          </a>
        )}
      </div>
    </article>
  );
}

function formatDate(value) {
  if (!value) return "Date unavailable";
  // API timestamps are explicit UTC (Z). For legacy records with no offset,
  // assume UTC instead of incorrectly interpreting the string as browser-local.
  const timestamp = typeof value === "string" &&
    !/(Z|[+-]\d{2}:?\d{2})$/i.test(value)
      ? `${value.replace(" ", "T")}Z`
      : value;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : date.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function getChannelName(item) {
  return item.result?.channel?.title || item.result?.channel?.name || item.channel_url || "YouTube channel";
}

function App() {
  const [channelUrl, setChannelUrl] = useState("");
  const [job, setJob] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activePage, setActivePage] = useState("analysis");
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState("all");
  const [watchlist, setWatchlist] = useState([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState("");
  const [watchlistMessage, setWatchlistMessage] = useState("");
  const [watchUrl, setWatchUrl] = useState("");
  const [watchInterval, setWatchInterval] = useState("1440");
  const [watchBusyId, setWatchBusyId] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState("");
  const timerRef = useRef(null);
  const watchCheckTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (watchCheckTimerRef.current) clearTimeout(watchCheckTimerRef.current);
    };
  }, []);

  async function readJob(jobId) {
    try {
      const response = await fetch(`${API}/analyses/${jobId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to retrieve analysis status.");
      }

      setJob(data);

      if (data.status === "done") {
        setResult(data.result || data.result_json || null);
        setLoading(false);
        return;
      }

      if (data.status === "failed") {
        setError(data.error || data.error_message || "Analysis failed.");
        setLoading(false);
        return;
      }

      timerRef.current = setTimeout(() => readJob(jobId), 1500);
    } catch (err) {
      setError(err.message || "Could not connect to the backend.");
      setLoading(false);
    }
  }

  async function analyseChannel(event) {
    event.preventDefault();
    if (!channelUrl.trim() || loading) return;

    setLoading(true);
    setError("");
    setResult(null);
    setJob({ status: "pending" });

    try {
      const response = await fetch(`${API}/analyses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_url: channelUrl.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not start the analysis.");
      }

      setJob(data);
      await readJob(data.job_id);
    } catch (err) {
      setError(err.message || "Could not connect to the backend.");
      setLoading(false);
    }
  }

  async function loadHistory() {
    setActivePage("history");
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await fetch(`${API}/analyses`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Unable to load analysis history.");
      }
      const items = Array.isArray(data) ? data : data.items || data.analyses || [];
      setHistory(items);
    } catch (err) {
      setHistoryError(err.message || "Could not connect to the backend.");
    } finally {
      setHistoryLoading(false);
    }
  }

  function openSavedReport(item) {
    if (!item.result) {
      setHistoryError("This analysis does not have a saved report yet.");
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    setJob(item);
    setResult(item.result);
    setError(item.status === "failed" ? item.error || "Analysis failed." : "");
    setLoading(false);
    setActivePage("analysis");
  }

  async function loadWatchlist() {
    setActivePage("watchlist");
    setWatchlistLoading(true);
    setWatchlistError("");
    try {
      const response = await fetch(`${API}/watchlist`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load watchlist.");
      setWatchlist(data.items || []);
    } catch (err) {
      setWatchlistError(err.message || "Could not connect to the backend.");
    } finally {
      setWatchlistLoading(false);
    }
  }

  async function loadAlerts() {
    setActivePage("alerts");
    setAlertsLoading(true);
    setAlertsError("");
    try {
      const response = await fetch(`${API}/alerts`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load alerts.");
      setAlerts(data.items || []);
      setUnreadAlerts(data.unread_count || 0);
    } catch (err) {
      setAlertsError(err.message || "Could not connect to the backend.");
    } finally {
      setAlertsLoading(false);
    }
  }

  async function addWatchlistChannel(event) {
    event.preventDefault();
    if (!watchUrl.trim()) return;
    setWatchlistError("");
    setWatchlistMessage("");
    try {
      const response = await fetch(`${API}/watchlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_url: watchUrl.trim(), interval_minutes: Number(watchInterval) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to add channel.");
      setWatchUrl("");
      await loadWatchlist();
      setWatchlistMessage(data.message || "Channel added to watchlist.");
    } catch (err) {
      setWatchlistError(err.message || "Unable to add channel.");
    }
  }

  async function watchlistAction(id, action, payload = {}) {
    setWatchBusyId(id);
    setWatchlistError("");
    setWatchlistMessage("");

    let previousLastCheckedAt = null;
    let previousLastError = null;
    let existingAlertIds = new Set();

    try {
      // Capture the previous state before starting a check so the UI can
      // distinguish "started" from "finished".
      if (action === "check") {
        const [watchResponse, alertsResponse] = await Promise.all([
          fetch(`${API}/watchlist`),
          fetch(`${API}/alerts`),
        ]);
        const [watchData, alertsData] = await Promise.all([
          watchResponse.json(),
          alertsResponse.json(),
        ]);
        if (!watchResponse.ok) throw new Error(watchData.error || "Unable to read watchlist status.");
        if (!alertsResponse.ok) throw new Error(alertsData.error || "Unable to read alerts.");
        const previousItem = (watchData.items || []).find((item) => item.id === id);
        previousLastCheckedAt = previousItem?.last_checked_at || null;
        previousLastError = previousItem?.last_error || null;
        existingAlertIds = new Set((alertsData.items || []).map((alert) => alert.id));
      }

      const response = await fetch(`${API}/watchlist/${id}${action === "check" ? "/check" : ""}`, {
        method: action === "remove" ? "DELETE" : action === "check" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        ...(Object.keys(payload).length ? { body: JSON.stringify(payload) } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Unable to ${action} channel.`);

      if (action === "remove") {
        setWatchlist((items) => items.filter((item) => item.id !== id));
        setWatchlistMessage(data.message || "Channel removed from watchlist.");
      } else if (action === "check") {
        setWatchlistMessage("Watchlist check started. Waiting for it to finish…");
        // Poll the persisted watchlist timestamp because the check runs in a
        // background thread and the start endpoint returns before it completes.
        let attempts = 0;
        const pollCheck = async () => {
          attempts += 1;
          try {
            const watchResponse = await fetch(`${API}/watchlist`);
            const watchData = await watchResponse.json();
            if (!watchResponse.ok) throw new Error(watchData.error || "Unable to read watchlist status.");
            const items = watchData.items || [];
            setWatchlist(items);
            const currentItem = items.find((item) => item.id === id);
            const checkFinished = currentItem &&
              currentItem.last_checked_at &&
              currentItem.last_checked_at !== previousLastCheckedAt;
            const checkFailed = Boolean(currentItem?.last_error) &&
              (checkFinished || currentItem.last_error !== previousLastError);

            if (checkFinished || checkFailed) {
              const alertsResponse = await fetch(`${API}/alerts`);
              const alertsData = await alertsResponse.json();
              if (!alertsResponse.ok) throw new Error(alertsData.error || "Unable to refresh alerts.");
              const currentAlerts = alertsData.items || [];
              setAlerts(currentAlerts);
              setUnreadAlerts(alertsData.unread_count || 0);
              const newAlerts = currentAlerts.filter((alert) => !existingAlertIds.has(alert.id));
              if (checkFailed || (checkFinished && currentItem?.last_error)) {
                setWatchlistError(`Watchlist check failed: ${currentItem.last_error}`);
                setWatchlistMessage("");
              } else {
                setWatchlistMessage(
                  newAlerts.length
                    ? `Watchlist check completed. ${newAlerts.length} alert${newAlerts.length === 1 ? "" : "s"} generated.`
                    : "Watchlist check completed. No alert conditions were triggered."
                );
              }
              setWatchBusyId(null);
              return;
            }

            if (attempts < 180) {
              watchCheckTimerRef.current = setTimeout(pollCheck, 2000);
            } else {
              setWatchlistMessage("The check is taking longer than expected. Refresh the watchlist to confirm its status.");
              setWatchBusyId(null);
            }
          } catch (pollError) {
            setWatchlistError(pollError.message || "Unable to check watchlist status.");
            setWatchBusyId(null);
          }
        };
        watchCheckTimerRef.current = setTimeout(pollCheck, 1500);
      } else {
        await loadWatchlist();
        if (action === "update") {
          setWatchlistMessage("Watchlist settings updated successfully.");
        }
      }
    } catch (err) {
      setWatchlistError(err.message || "Watchlist action failed.");
      setWatchBusyId(null);
    } finally {
      // A manual check keeps its busy state until the background result is
      // observed by pollCheck; other actions can finish immediately.
      if (action !== "check") setWatchBusyId(null);
    }
  }

  async function markAlertRead(id) {
    try {
      const response = await fetch(`${API}/alerts/${id}/read`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to mark alert as read.");
      setAlerts((items) => items.map((item) => item.id === id ? { ...item, is_read: true } : item));
      setUnreadAlerts((count) => Math.max(0, count - 1));
    } catch (err) {
      setAlertsError(err.message || "Unable to update alert.");
    }
  }

  function displayDate(value) {
    if (!value) return "Not checked yet";

    // The backend stores timezone-less scheduler timestamps as UTC.
    // Explicitly mark those values as UTC, then display them in Indian Standard Time.
    const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
    const normalizedValue = hasTimezone ? value : `${value}Z`;
    const date = new Date(normalizedValue);

    if (Number.isNaN(date.getTime())) return "Date unavailable";

    return date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  }

  const filteredHistory = history.filter((item) => {
    const query = historySearch.trim().toLowerCase();
    const matchesSearch =
      !query ||
      getChannelName(item).toLowerCase().includes(query) ||
      String(item.channel_url || "").toLowerCase().includes(query) ||
      String(item.job_id || "").includes(query);
    const matchesStatus = historyStatus === "all" || item.status === historyStatus;
    return matchesSearch && matchesStatus;
  });

  const channel = result?.channel || {};
  const metrics = result?.metrics || {};
  const videos = result?.videos || [];
  const report = result?.ai_report || {};

  
const scores = [
  {
    label: "Title & description",
    score: report.title_description_score,
    assessment: report.title_description_assessment,
  },
  {
    label: "Call to action",
    score: report.cta_score,
    assessment: report.cta_assessment,
  },
  {
    label: "Posting consistency",
    score: report.posting_consistency_score,
    assessment: report.posting_consistency_assessment,
  },
  {
    label: "Hook strength",
    score: report.hook_strength_score,
    assessment: report.hook_strength_assessment,
  },
  {
    label: "Storytelling",
    score: report.storytelling_score,
    assessment: report.storytelling_assessment,
  },
];


  const topVideos = report.top_videos || [];
  const improvementVideos = report.improvement_videos || [];
  const recommendations = report.recommendations || [];
  const videoIdeas = report.video_ideas || [];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a href="#" className="brand">
          <span className="brand-mark">W</span>
          <span>
            WILMARCS<span className="brand-subtitle">VIDEO INTELLIGENCE</span>
          </span>
        </a>

        <div className="sidebar-section-label">WORKSPACE</div>
        <button
          type="button"
          className={`nav-item nav-button ${activePage === "analysis" ? "active" : ""}`}
          onClick={() => setActivePage("analysis")}
        >
          <span>◫</span> Channel analysis
        </button>
        <button
          type="button"
          className={`nav-item nav-button ${activePage === "history" ? "active" : ""}`}
          onClick={loadHistory}
        >
          <span>◷</span> Analysis history
        </button>
        <button type="button" className={`nav-item nav-button ${activePage === "watchlist" ? "active" : ""}`} onClick={loadWatchlist}>
          <span>◉</span> Watchlist
        </button>
        <button type="button" className={`nav-item nav-button ${activePage === "alerts" ? "active" : ""}`} onClick={loadAlerts}>
          <span>♢</span> Alerts {unreadAlerts > 0 ? `(${unreadAlerts})` : ""}
        </button>
        <div className="sidebar-note">
          <span className="status-dot" />
          <span>AI analysis workspace</span>
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-avatar">WI</div>
          <div>
            <strong>Wilmarcs Intelligence</strong>
            <small>Internal workspace</small>
          </div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> {activePage === "history" ? "Analysis history" : activePage === "watchlist" ? "Watchlist" : activePage === "alerts" ? "Alerts" : "Channel analysis"}
          </div>
          <div className="live-indicator">
            <span className="status-dot" /> Analysis service
          </div>
        </header>

        <div className="page-content">
          {activePage === "history" ? (
            <section className="history-page">
              <div className="page-heading">
                <div>
                  <div className="eyebrow">SAVED REPORTS · WORKSPACE</div>
                  <h1>Analysis history</h1>
                  <p>Reopen previous channel reports without running the analysis again.</p>
                </div>
                <button type="button" className="secondary-button" onClick={loadHistory} disabled={historyLoading}>
                  {historyLoading ? "Refreshing…" : "↻ Refresh"}
                </button>
              </div>

              <div className="history-toolbar">
                <input
                  type="search"
                  aria-label="Search analysis history"
                  placeholder="Search channel name, URL or job ID…"
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                />
                <select
                  aria-label="Filter by status"
                  value={historyStatus}
                  onChange={(event) => setHistoryStatus(event.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value="done">Completed</option>
                  <option value="processing">Processing</option>
                  <option value="pending">Pending</option>
                  <option value="failed">Failed</option>
                </select>
              </div>

              {historyError && <div className="error-banner"><strong>History could not be loaded</strong><p>{historyError}</p></div>}
              {historyLoading ? (
                <div className="history-empty"><span className="status-dot" /> Loading saved analyses…</div>
              ) : filteredHistory.length === 0 ? (
                <div className="history-empty">
                  <div className="empty-illustration">◷</div>
                  <h2>{history.length ? "No matching analyses" : "No saved analyses yet"}</h2>
                  <p>{history.length ? "Try a different search or status filter." : "Once you analyse a channel, its saved report will appear here."}</p>
                </div>
              ) : (
                <div className="history-list">
                  {filteredHistory.map((item) => {
                    const reportVideos = item.result?.videos || [];
                    const status = (item.status || "unknown").toLowerCase();
                    return (
                      <article className="history-card" key={item.job_id}>
                        <div className="history-card-main">
                          <div className="history-channel-icon">▶</div>
                          <div className="history-details">
                            <h2>{getChannelName(item)}</h2>
                            <p className="history-url">{item.channel_url}</p>
                            <div className="history-meta">
                              <span>Job #{item.job_id}</span>
                              <span>{formatDate(item.created_at)}</span>
                              {item.result && <span>{reportVideos.length} videos saved</span>}
                            </div>
                          </div>
                        </div>
                        <div className="history-card-actions">
                          <span className={`status-pill status-${status}`}>{status}</span>
                          {item.result ? (
                            <button
                              type="button"
                              className="history-open-button"
                              onClick={() => openSavedReport(item)}
                            >
                              View report ↗
                            </button>
                          ) : status === "failed" ? (
                            <details className="history-error-details">
                              <summary>View error details</summary>
                              <p>{item.error || "No error details available."}</p>
                            </details>
                          ) : (
                            <span className="subtle-label">Report not ready</span>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          ) : activePage === "watchlist" ? (
            <section className="history-page">
              <div className="page-heading">
                <div><div className="eyebrow">AUTOMATION · CHANNEL MONITORING</div><h1>Watchlist</h1><p>Monitor channels on a schedule and detect new uploads or notable performance changes.</p></div>
                <button type="button" className="secondary-button" onClick={loadWatchlist} disabled={watchlistLoading}>{watchlistLoading ? "Refreshing…" : "↻ Refresh"}</button>
              </div>
              <form onSubmit={addWatchlistChannel} className="search-panel" style={{ display: "block" }}>
                <div className="search-copy"><div className="section-kicker">ADD A CHANNEL</div><h2>Set up monitoring</h2><p>First successful check creates a baseline; later checks can create alerts for changes.</p></div>
                <div className="channel-form">
                  <label htmlFor="watch-url">YouTube channel URL or @handle</label>
                  <div className="input-row">
                    <input id="watch-url" value={watchUrl} onChange={(event) => setWatchUrl(event.target.value)} placeholder="https://www.youtube.com/@GoogleDevelopers" required />
                    <select aria-label="Check interval" value={watchInterval} onChange={(event) => setWatchInterval(event.target.value)} style={{ maxWidth: 180 }}><option value="60">Every hour</option><option value="360">Every 6 hours</option><option value="720">Every 12 hours</option><option value="1440">Daily</option><option value="10080">Weekly</option></select>
                    <button type="submit">Add channel <span>＋</span></button>
                  </div>
                  <small>Minimum interval is 15 minutes. Frequent checks may consume YouTube API quota.</small>
                </div>
              </form>
              {watchlistError && <div className="error-banner" role="alert"><p>{watchlistError}</p></div>}
              {watchlistMessage && (
                <div
                  className="success-banner"
                  role="status"
                  aria-live="polite"
                  style={{
                    margin: "12px 0",
                    padding: "12px 16px",
                    border: "1px solid #a7d7b5",
                    borderRadius: "10px",
                    background: "#edf9f0",
                    color: "#205b32",
                  }}
                >
                  {watchlistMessage}
                </div>
              )}
              {watchlistLoading ? <div className="history-empty">Loading watchlist…</div> : watchlist.length === 0 ? (
                <div className="history-empty"><div className="empty-illustration">◉</div><h2>No monitored channels yet</h2><p>Add a public YouTube channel above to begin monitoring.</p></div>
              ) : (
                <div className="history-list">{watchlist.map((item) => (
                  <article className="history-card" key={item.id}>
                    <div className="history-card-main"><div className="history-channel-icon">▶</div><div className="history-details">
                      <h2>{item.channel_url}</h2><div className="history-meta"><span>{item.active ? "Active" : "Paused"}</span><span>Every {item.interval_minutes} minutes</span><span>Last checked: {displayDate(item.last_checked_at)}</span><span>Next check: {displayDate(item.next_check_at)}</span></div>
                      {item.last_error && <p className="error-text">Last check failed: {item.last_error}</p>}
                    </div></div>
                    <div className="history-card-actions"><span className={`status-pill ${item.active ? "status-done" : "status-pending"}`}>{item.active ? "active" : "paused"}</span>
                      <button type="button" className="history-open-button" disabled={watchBusyId === item.id} onClick={() => watchlistAction(item.id, "check")}>Check now</button>
                      <button type="button" className="secondary-button" disabled={watchBusyId === item.id} onClick={() => watchlistAction(item.id, "update", { active: !item.active })}>{item.active ? "Pause" : "Resume"}</button>
                      <button type="button" className="secondary-button" disabled={watchBusyId === item.id} onClick={() => { const value = window.prompt("Check interval in minutes (15–10080):", String(item.interval_minutes)); if (value !== null && /^\d+$/.test(value) && Number(value) >= 15 && Number(value) <= 10080) watchlistAction(item.id, "update", { interval_minutes: Number(value) }); }}>Change interval</button>
                      <button type="button" className="secondary-button" disabled={watchBusyId === item.id} onClick={() => { if (window.confirm("Remove this channel and its alerts from the watchlist?")) watchlistAction(item.id, "remove"); }}>Remove</button>
                    </div>
                  </article>
                ))}</div>
              )}
            </section>
          ) : activePage === "alerts" ? (
            <section className="history-page">
              <div className="page-heading"><div><div className="eyebrow">AUTOMATION · CHANGE DETECTION</div><h1>Alerts</h1><p>{unreadAlerts} unread alert{unreadAlerts === 1 ? "" : "s"} from your monitored channels.</p></div><button type="button" className="secondary-button" onClick={loadAlerts} disabled={alertsLoading}>{alertsLoading ? "Refreshing…" : "↻ Refresh"}</button></div>
              {alertsError && <div className="error-banner"><p>{alertsError}</p></div>}
              {alertsLoading ? <div className="history-empty">Loading alerts…</div> : alerts.length === 0 ? (
                <div className="history-empty"><div className="empty-illustration">♢</div><h2>No alerts yet</h2><p>New uploads and meaningful changes will appear here after subsequent successful monitoring checks.</p></div>
              ) : (
                <div className="history-list">{alerts.map((alert) => (
                  <article className="history-card" key={alert.id} style={{ opacity: alert.is_read ? 0.78 : 1 }}>
                    <div className="history-card-main"><div className="history-channel-icon">{alert.is_read ? "✓" : "!"}</div><div className="history-details">
                      <div className="history-meta"><span>{String(alert.type || "alert").replaceAll("_", " ")}</span><span>{displayDate(alert.created_at)}</span><span>{alert.is_read ? "Read" : "Unread"}</span></div><h2>{alert.message}</h2><p className="history-url">{alert.channel_url}</p>
                      {alert.payload && Object.keys(alert.payload).length > 0 && <details><summary>Evidence / details</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(alert.payload, null, 2)}</pre></details>}
                    </div></div>
                    {!alert.is_read && <div className="history-card-actions"><button type="button" className="history-open-button" onClick={() => markAlertRead(alert.id)}>Mark as read</button></div>}
                  </article>
                ))}</div>
              )}
            </section>
          ) : (
            <>
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUTUBE ANALYTICS · AI-POWERED</div>
              <h1>Channel intelligence</h1>
              <p>
                Turn channel performance data into practical content
                recommendations.
              </p>
            </div>
            <div className="heading-decoration">↗</div>
          </div>

          <section className="search-panel">
            <div className="search-copy">
              <div className="section-kicker">NEW ANALYSIS</div>
              <h2>Discover what's working.</h2>
              <p>
                Analyse a YouTube channel's recent videos, performance and
                content opportunities.
              </p>
            </div>

            <form onSubmit={analyseChannel} className="channel-form">
              <label htmlFor="channel-url">YouTube channel URL or handle</label>
              <div className="input-row">
                <input
                  id="channel-url"
                  type="text"
                  placeholder="https://www.youtube.com/@GoogleDevelopers"
                  value={channelUrl}
                  onChange={(event) => setChannelUrl(event.target.value)}
                  required
                />
                <button type="submit" disabled={loading}>
                  {loading ? "Analysing…" : "Analyse channel"} <span>↗</span>
                </button>
              </div>
              <small>
                Reviews up to 20 recent videos. Analysis may take a little time.
              </small>
            </form>
          </section>

          {job && (
            <section className="job-status" aria-live="polite">
              <div
                className={`job-icon ${job.status === "failed" ? "failed" : ""}`}
              >
                {job.status === "done"
                  ? "✓"
                  : job.status === "failed"
                    ? "!"
                    : "◌"}
              </div>
              <div className="job-copy">
                <strong>
                  {job.status === "done"
                    ? "Analysis complete"
                    : job.status === "failed"
                      ? "Analysis failed"
                      : "Analysing channel"}
                </strong>
                <span>
                  {job.status === "done"
                    ? "Your channel report is ready."
                    : job.status === "failed"
                      ? error
                      : "Collecting video data and generating AI recommendations…"}
                </span>
              </div>
              {job.job_id && <span className="job-id">JOB #{job.job_id}</span>}
            </section>
          )}

          {error && (
            <div className="error-banner">
              <strong>Something went wrong</strong>
              <p>{error}</p>
              <small>
                Check that Flask is running on port 5001 and that your API
                credentials are configured.
              </small>
            </div>
          )}

          {result && (
            <>
              <section className="channel-overview">
                <div className="channel-identity">
                  <div className="channel-avatar">
                    {(channel.title || channel.name || "Y")
                      .charAt(0)
                      .toUpperCase()}
                  </div>
                  <div>
                    <div className="section-kicker">CHANNEL OVERVIEW</div>
                    <h2>
                      {channel.title || channel.name || "YouTube channel"}
                    </h2>
                    <p>
                      {channel.custom_url ||
                        channel.handle ||
                        channel.channel_id ||
                        channel.id ||
                        ""}
                    </p>
                  </div>
                </div>
                <div className="data-source">
                  <span className="status-dot" />
                  {result.data_source === "youtube_data_api"
                    ? "Live YouTube data"
                    : "Demo data"}
                </div>
              </section>

              <section className="metrics-grid">
                <Metric
                  label="Subscribers"
                  value={formatNumber(
                    channel.subscriber_count ?? channel.subscribers,
                  )}
                  detail="Channel audience"
                />
                <Metric
                  label="Videos analysed"
                  value={formatNumber(metrics.video_count ?? videos.length)}
                  detail="Recent uploads"
                />
                <Metric
                  label="Average views"
                  value={formatNumber(metrics.average_views)}
                  detail="Per video in sample"
                />
                <Metric
                  label="Engagement rate"
                  value={formatPercent(metrics.average_engagement_rate)}
                  detail="Available likes/comments vs. views; may be partial"
                />
              </section>

              <section className="content-section">
                <div className="section-heading">
                  <div>
                    <div className="section-kicker">CONTENT PERFORMANCE</div>
                    <h2>Videos in focus</h2>
                  </div>
                  <span className="subtle-label">
                    {videos.length} videos collected
                  </span>
                </div>

                <div className="video-grid">
                  {topVideos.length > 0
                    ? topVideos
                        .slice(0, 3)
                        .map((video, index) => (
                          <VideoCard
                            key={getVideoId(video) || index}
                            video={
                              videos.find(
                                (v) => getVideoId(v) === getVideoId(video),
                              ) || video
                            }
                            rank={`TOP PERFORMER ${index + 1}`}
                          />
                        ))
                    : videos
                        .slice(0, 3)
                        .map((video, index) => (
                          <VideoCard
                            key={getVideoId(video) || index}
                            video={video}
                          />
                        ))}
                </div>

                {(topVideos.length > 0 || improvementVideos.length > 0) && (
                  <div className="video-feedback-list">
                    <div className="subsection-heading">
                      <h3>Video-specific AI feedback</h3>
                      <span>Observations tied to individual videos</span>
                    </div>
                    {[...topVideos.slice(0, 3), ...improvementVideos.slice(0, 3)].map((item, index) => (
                      <article className="summary-card" key={`${item.video_id || item.title}-feedback-${index}`}>
                        <span className="section-kicker">{index < Math.min(3, topVideos.length) ? "TOP PERFORMER" : "IMPROVEMENT OPPORTUNITY"}</span>
                        <h3>{item.title}</h3>
                        <p><strong>Evidence and observation:</strong> {item.observation}</p>
                        <p><strong>Suggested experiment:</strong> {item.recommendation}</p>
                      </article>
                    ))}
                  </div>
                )}

                {improvementVideos.length > 0 && (
                  <>
                    <div className="subsection-heading">
                      <h3>Videos to review</h3>
                      <span>Opportunities for improvement</span>
                    </div>
                    <div className="video-grid">
                      {improvementVideos.slice(0, 3).map((video, index) => (
                        <VideoCard
                          key={getVideoId(video) || index}
                          video={
                            videos.find(
                              (v) => getVideoId(v) === getVideoId(video),
                            ) || video
                          }
                          rank="REVIEW"
                        />
                      ))}
                    </div>
                  </>
                )}
              </section>

              <section className="content-section">
                <div className="section-heading">
                  <div>
                    <div className="section-kicker">AI-ASSISTED REVIEW</div>
                    <h2>Channel health scores</h2>
                  </div>
                  <span className="subtle-label">Out of 10</span>
                </div>

                <div className="score-grid">
                  {scores.map(({ label, score, assessment }) => (
                    <article className="score-card" key={label}>
                      <div className="score-top">
                        <span>{label}</span>
                        <strong>{score == null ? "N/A" : `${score}/10`}</strong>
                      </div>

                      <div className="score-track">
                        <div
                          className="score-fill"
                          style={{
                            width: `${
                              Math.min(10, Math.max(0, Number(score) || 0)) * 10
                            }%`,
                          }}
                        />
                      </div>

                      {assessment ? (
                        <div className="score-assessment">
                          {assessment.reasoning && (
                            <p>{assessment.reasoning}</p>
                          )}

                          {Array.isArray(assessment.evidence) &&
                            assessment.evidence.length > 0 && (
                              <div className="score-evidence">
                                <strong>Evidence from the channel</strong>
                                <ul>
                                  {assessment.evidence.map((item, index) => (
                                    <li key={`${label}-evidence-${index}`}>
                                      {item}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                        </div>
                      ) : (
                        <small>Not assessed from available data</small>
                      )}
                    </article>
                  ))}
                </div>

                {report.channel_summary && (
                  <div className="summary-card">
                    <span className="section-kicker">CHANNEL SUMMARY</span>
                    <p>{report.channel_summary}</p>
                  </div>
                )}
              </section>

              <section className="content-section">
                <div className="section-heading">
                  <div>
                    <div className="section-kicker">RECOMMENDED NEXT STEPS</div>
                    <h2>Growth opportunities</h2>
                  </div>
                  <span className="subtle-label">
                    {recommendations.length} recommendations
                  </span>
                </div>
                <div className="recommendation-list">
                  {recommendations.map((item, index) => (
                    <article
                      className="recommendation-card"
                      key={`${item.action}-${index}`}
                    >
                      <div className="priority">
                        0{item.priority || index + 1}
                      </div>
                      <div className="recommendation-copy">
                        <h3>{item.action}</h3>
                        <p>{item.reason}</p>
                        {item.expected_impact && (
                          <div className="impact">
                            <span>Potential impact</span>
                            {item.expected_impact}
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className="content-section">
                <div className="section-heading">
                  <div>
                    <div className="section-kicker">CREATIVE DIRECTION</div>
                    <h2>Video ideas to explore</h2>
                  </div>
                </div>
                <div className="idea-grid">
                  {videoIdeas.map((idea, index) => (
                    <article
                      className="idea-card"
                      key={`${idea.title}-${index}`}
                    >
                      <span className="idea-number">IDEA 0{index + 1}</span>
                      <h3>{idea.title}</h3>
                      <p>{idea.concept}</p>
                      {idea.target_audience && (
                        <div className="audience">
                          <span>Target audience</span>
                          {idea.target_audience}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </section>

              {report.salesperson_summary && (
                <section className="sales-summary">
                  <div className="section-kicker">CLIENT-READY BRIEF</div>
                  <h2>Salesperson summary</h2>
                  <p>{report.salesperson_summary}</p>
                </section>
              )}

              <section className="limitations">
                <div>
                  <span className="limitation-icon">i</span>
                </div>
                <div>
                  <h3>Data coverage & limitations</h3>
                  <p>
                    This report uses available channel and video metadata.
                    Scores and recommendations are AI-assisted observations, not
                    verified outcomes.
                  </p>
                  {Array.isArray(report.limitations) &&
                    report.limitations.length > 0 && (
                      <ul>
                        {report.limitations.map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ul>
                    )}
                  <p className="limitations-footnote">
                    Transcript-based analysis, click-through rate, audience
                    retention and demographic data are not currently available
                    unless explicitly provided by the data source.
                  </p>
                </div>
              </section>
            </>
          )}

          {!result && !loading && !error && (
            <section className="empty-state">
              <div className="empty-illustration">
                <span>▶</span>
                <i>✳</i>
                <b>↗</b>
              </div>
              <div className="section-kicker">READY WHEN YOU ARE</div>
              <h2>Your next content insight starts here.</h2>
              <p>
                Enter a public YouTube channel above to generate a performance
                snapshot and AI-assisted recommendations.
              </p>
            </section>
          )}

            </>
          )}

          <footer className="page-footer">
            <span>WILMARCS · VIDEO INTELLIGENCE</span>
            <span>Insights to inform better content decisions.</span>
          </footer>
        </div>
      </section>
    </main>
  );
}

export default App;
