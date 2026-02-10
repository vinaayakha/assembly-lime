import { Box, Trash2 } from "lucide-react";
import type { Sandbox } from "../../types";

type Props = {
  sandbox: Sandbox;
  onDestroy: (id: string) => void;
  onViewLogs: (id: string) => void;
};

const statusColors: Record<string, string> = {
  creating: "bg-amber-500",
  running: "bg-emerald-500",
  stopped: "bg-zinc-500",
  destroying: "bg-red-400",
  destroyed: "bg-zinc-600",
  error: "bg-red-500",
};

export function SandboxCard({ sandbox, onDestroy, onViewLogs }: Props) {
  const isActive = sandbox.status === "running" || sandbox.status === "creating";

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Box className="h-4 w-4 text-zinc-400" />
          <div>
            <span className="text-sm font-medium text-zinc-200">{sandbox.k8sPod}</span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`h-2 w-2 rounded-full ${statusColors[sandbox.status] ?? "bg-zinc-500"}`} />
              <span className="text-xs text-zinc-500">{sandbox.status}</span>
              <span className="text-xs text-zinc-600">branch: {sandbox.branch}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isActive && (
            <button
              onClick={() => onViewLogs(sandbox.id)}
              className="rounded-md bg-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-600 transition-colors"
            >
              Logs
            </button>
          )}
          {sandbox.status !== "destroyed" && sandbox.status !== "destroying" && (
            <button
              onClick={() => onDestroy(sandbox.id)}
              className="rounded-md p-1.5 text-zinc-500 hover:text-red-400 hover:bg-zinc-700 transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      {Array.isArray(sandbox.portsJson) && (sandbox.portsJson as any[]).length > 0 && (
        <div className="mt-2 flex gap-2">
          {(sandbox.portsJson as any[]).map((p: any, i: number) => (
            <span key={i} className="text-xs text-zinc-500 bg-zinc-700 rounded px-1.5 py-0.5">
              :{p.containerPort}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
