import { FileCode, Key, RefreshCw } from "lucide-react";
import type { RepoConfig } from "../../types";

type Props = {
  configs: RepoConfig[];
  scanning: boolean;
  onScan: () => void;
};

const FILE_TYPE_LABELS: Record<string, string> = {
  env_example: "Env File",
  yaml_config: "YAML Config",
  json_config: "JSON Config",
  toml_config: "TOML Config",
  dockerfile: "Dockerfile",
};

export function ConfigDetection({ configs, scanning, onScan }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-200">Detected Configs</h3>
        <button
          onClick={onScan}
          disabled={scanning}
          className="flex items-center gap-1.5 rounded-md bg-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`h-3 w-3 ${scanning ? "animate-spin" : ""}`} />
          {scanning ? "Scanning..." : "Scan"}
        </button>
      </div>

      {configs.length === 0 ? (
        <p className="text-xs text-zinc-500">No config files detected. Click Scan to detect.</p>
      ) : (
        <div className="space-y-2">
          {configs.map((c) => (
            <div key={c.id} className="rounded-md border border-zinc-700 bg-zinc-800/30 p-3">
              <div className="flex items-center gap-2">
                <FileCode className="h-4 w-4 text-zinc-400" />
                <span className="text-sm text-zinc-200 font-mono">{c.filePath}</span>
                <span className="text-xs text-zinc-500 bg-zinc-700 rounded px-1.5 py-0.5">
                  {FILE_TYPE_LABELS[c.fileType] ?? c.fileType}
                </span>
              </div>
              {Array.isArray(c.detectedKeys) && c.detectedKeys.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {(c.detectedKeys as string[]).map((key) => (
                    <span
                      key={key}
                      className="inline-flex items-center gap-1 rounded bg-zinc-700/50 px-1.5 py-0.5 text-xs text-zinc-400 font-mono"
                    >
                      <Key className="h-2.5 w-2.5" />
                      {key}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
