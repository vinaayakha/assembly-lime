import { useEffect, useRef } from "react";

type Props = {
  logs: string;
  loading: boolean;
};

export function LogViewer({ logs, loading }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-zinc-800 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400">Pod Logs</span>
        {loading && <span className="text-xs text-zinc-500">Loading...</span>}
      </div>
      <pre className="p-3 text-xs text-zinc-400 font-mono overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
        {logs || (loading ? "Fetching logs..." : "No logs available.")}
        <div ref={bottomRef} />
      </pre>
    </div>
  );
}
