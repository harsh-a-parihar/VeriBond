import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = "/api";
const LOG_POLL_MS = 2000;

type LogsState = { lines: string[]; loading: boolean };
type ActionState = { loading: boolean; error: string | null; lastResult: Record<string, unknown> | null };

async function api(
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; data?: unknown }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { detail?: string })?.detail || res.statusText || "Request failed");
  }
  return { ok: res.ok, data };
}

function App() {
  const [logs, setLogs] = useState<LogsState>({ lines: [], loading: false });
  const [action, setAction] = useState<ActionState>({ loading: false, error: null, lastResult: null });
  const [csvPath, setCsvPath] = useState<string>("polymarket_markets.csv");
  const [nrows, setNrows] = useState<string>("");
  const [datasets, setDatasets] = useState<string[]>([]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const { data } = await api("GET", "/logs?tail=500");
      const lines = (data as { lines?: string[] })?.lines ?? [];
      setLogs((prev) => (prev.lines.join("\n") === lines.join("\n") ? prev : { ...prev, lines, loading: false }));
    } catch {
      setLogs((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  const startPollingLogs = useCallback(() => {
    if (pollRef.current) return;
    setLogs((prev) => ({ ...prev, loading: true }));
    fetchLogs();
    pollRef.current = setInterval(fetchLogs, LOG_POLL_MS);
  }, [fetchLogs]);

  const stopPollingLogs = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setLogs((prev) => ({ ...prev, loading: false }));
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [logs.lines]);

  const runAction = useCallback(
    async (
      _label: string,
      fn: () => Promise<unknown>,
      options?: { pollLogs?: boolean }
    ) => {
      setAction({ loading: true, error: null, lastResult: null });
      if (options?.pollLogs !== false) startPollingLogs();
      try {
        const result = await fn();
        setAction({ loading: false, error: null, lastResult: result as Record<string, unknown> });
        await fetchLogs();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setAction({ loading: false, error: message, lastResult: null });
        await fetchLogs();
      } finally {
        stopPollingLogs();
      }
    },
    [startPollingLogs, stopPollingLogs, fetchLogs]
  );

  const pipeline = {
    reset: () =>
      runAction("Reset", () => api("POST", "/pipeline/reset").then((r) => r.data)),
    ingest: () =>
      runAction("Ingest", () =>
        api("POST", "/pipeline/ingest", {
          csv_path: csvPath || undefined,
          nrows: nrows ? parseInt(nrows, 10) : undefined,
        }).then((r) => r.data)
      ),
    embed: () =>
      runAction("Embed", () => api("POST", "/pipeline/embed").then((r) => r.data)),
    cluster: () =>
      runAction("Cluster", () => api("POST", "/pipeline/cluster").then((r) => r.data)),
    label: () =>
      runAction("Label", () => api("POST", "/pipeline/label").then((r) => r.data)),
    relations: () =>
      runAction("Relations", () => api("POST", "/pipeline/relations").then((r) => r.data)),
    evaluate: () =>
      runAction("Evaluate", () => api("POST", "/pipeline/evaluate").then((r) => r.data)),
    runFull: () =>
      runAction("Run full pipeline", () =>
        api("POST", "/pipeline/run-full", {
          csv_path: csvPath || undefined,
          nrows: nrows ? parseInt(nrows, 10) : undefined,
        }).then((r) => r.data)
      ),
  };

  const clearLogs = () => {
    api("DELETE", "/logs").then(() => setLogs({ lines: [], loading: false }));
  };

  const loadDatasets = useCallback(async () => {
    try {
      const { data } = await api("GET", "/datasets");
      setDatasets((data as { files?: string[] })?.files ?? []);
    } catch {
      setDatasets([]);
    }
  }, []);

  useEffect(() => {
    loadDatasets();
  }, [loadDatasets]);

  const uploadDataset = async () => {
    if (!uploadFile?.name?.endsWith(".csv")) {
      setAction((a) => ({ ...a, error: "Please select a .csv file", lastResult: null }));
      return;
    }
    setAction({ loading: true, error: null, lastResult: null });
    startPollingLogs();
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      const res = await fetch(`${API_BASE}/datasets/upload`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { detail?: string })?.detail || res.statusText);
      }
      setAction({ loading: false, error: null, lastResult: data });
      setUploadFile(null);
      await loadDatasets();
      await fetchLogs();
    } catch (e) {
      setAction({
        loading: false,
        error: e instanceof Error ? e.message : String(e),
        lastResult: null,
      });
    } finally {
      stopPollingLogs();
    }
  };

  const busy = action.loading;

  return (
    <div style={{ display: "flex", minHeight: "100vh", flexDirection: "column" }}>
      <header
        style={{
          padding: "12px 20px",
          background: "#1e293b",
          color: "#f8fafc",
          fontSize: "16px",
          fontWeight: 600,
        }}
      >
        VeriBond Admin — Pipeline &amp; Datasets
      </header>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <aside
          style={{
            width: "320px",
            minWidth: "320px",
            padding: "16px",
            background: "#fff",
            borderRight: "1px solid #e2e8f0",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <section>
            <h3 style={{ margin: "0 0 8px", fontSize: "13px", color: "#64748b", textTransform: "uppercase" }}>
              Datasets
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                />
                <button
                  className="primary"
                  disabled={busy || !uploadFile}
                  onClick={uploadDataset}
                >
                  Upload CSV
                </button>
              </div>
              {datasets.length > 0 && (
                <div>
                  <label style={{ fontSize: "12px", color: "#64748b" }}>Use file: </label>
                  <select
                    value={csvPath}
                    onChange={(e) => setCsvPath(e.target.value)}
                    style={{ marginTop: "4px", width: "100%" }}
                  >
                    {datasets.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <label style={{ fontSize: "12px", color: "#64748b" }}>nrows (optional):</label>
                <input
                  type="number"
                  placeholder="all"
                  min={1}
                  value={nrows}
                  onChange={(e) => setNrows(e.target.value)}
                />
              </div>
            </div>
          </section>

          <section>
            <h3 style={{ margin: "0 0 8px", fontSize: "13px", color: "#64748b", textTransform: "uppercase" }}>
              Pipeline
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <button
                className="danger"
                disabled={busy}
                onClick={pipeline.reset}
              >
                Reset
              </button>
              <button disabled={busy} onClick={pipeline.ingest}>
                Ingest
              </button>
              <button disabled={busy} onClick={pipeline.embed}>
                Embed
              </button>
              <button disabled={busy} onClick={pipeline.cluster}>
                Cluster
              </button>
              <button disabled={busy} onClick={pipeline.label}>
                Label
              </button>
              <button disabled={busy} onClick={pipeline.relations}>
                Relations
              </button>
              <button disabled={busy} onClick={pipeline.evaluate}>
                Evaluate
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={pipeline.runFull}
                style={{ marginTop: "8px" }}
              >
                Run full pipeline
              </button>
            </div>
          </section>

          {action.error && (
            <div style={{ padding: "8px", background: "#fef2f2", color: "#b91c1c", borderRadius: "6px", fontSize: "13px" }}>
              {action.error}
            </div>
          )}
          {action.lastResult && (
            <pre
              style={{
                margin: 0,
                padding: "8px",
                background: "#f0fdf4",
                borderRadius: "6px",
                fontSize: "12px",
                overflow: "auto",
                maxHeight: "200px",
              }}
            >
              {JSON.stringify(action.lastResult, null, 2)}
            </pre>
          )}
        </aside>

        <main
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            background: "#f8fafc",
          }}
        >
          <div
            style={{
              padding: "8px 16px",
              borderBottom: "1px solid #e2e8f0",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span style={{ fontSize: "13px", color: "#64748b" }}>Logs</span>
            <button onClick={clearLogs} disabled={busy}>
              Clear
            </button>
            <button onClick={fetchLogs}>Refresh</button>
          </div>
          <pre
            style={{
              flex: 1,
              margin: 0,
              padding: "12px",
              overflow: "auto",
              fontSize: "12px",
              fontFamily: "ui-monospace, monospace",
              background: "#1e293b",
              color: "#e2e8f0",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {logs.lines.length === 0 && !logs.loading ? "No logs yet. Run a pipeline step or refresh." : null}
            {logs.lines.map((line, i) => (
              <span key={i}>{line}\n</span>
            ))}
            <div ref={logEndRef} />
          </pre>
        </main>
      </div>
    </div>
  );
}

export default App;
