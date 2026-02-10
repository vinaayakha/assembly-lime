import { useState } from "react";
import { Folder, FolderOpen, FileText, ChevronRight, ChevronDown } from "lucide-react";
import { api } from "../../lib/api";
import type { FileTreeEntry } from "../../types";

type Props = {
  repoId: string;
  entries: FileTreeEntry[];
  currentRef?: string;
  onSelectFile?: (path: string) => void;
};

function TreeItem({
  entry,
  repoId,
  currentRef,
  depth,
  onSelectFile,
}: {
  entry: FileTreeEntry;
  repoId: string;
  currentRef?: string;
  depth: number;
  onSelectFile?: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileTreeEntry[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleExpand() {
    if (entry.type !== "dir") {
      onSelectFile?.(entry.path);
      return;
    }
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (children.length === 0) {
      setLoading(true);
      try {
        const refParam = currentRef ? `&ref=${encodeURIComponent(currentRef)}` : "";
        const data = await api.get<FileTreeEntry[]>(
          `/repositories/${repoId}/tree?path=${encodeURIComponent(entry.path)}${refParam}`
        );
        setChildren(data);
      } catch (err) {
        console.error("Failed to load tree:", err);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(true);
  }

  const isDir = entry.type === "dir";

  return (
    <div>
      <button
        onClick={handleExpand}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-zinc-700/50 transition-colors"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isDir ? (
          expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
          )
        ) : (
          <span className="w-3.5" />
        )}
        {isDir ? (
          expanded ? (
            <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
          ) : (
            <Folder className="h-4 w-4 text-amber-500 shrink-0" />
          )
        ) : (
          <FileText className="h-4 w-4 text-zinc-400 shrink-0" />
        )}
        <span className={`truncate ${isDir ? "text-zinc-200" : "text-zinc-400"}`}>
          {entry.name}
        </span>
        {loading && <span className="text-xs text-zinc-600 ml-auto">...</span>}
      </button>
      {expanded &&
        children.map((child) => (
          <TreeItem
            key={child.path}
            entry={child}
            repoId={repoId}
            currentRef={currentRef}
            depth={depth + 1}
            onSelectFile={onSelectFile}
          />
        ))}
    </div>
  );
}

export function FileTree({ repoId, entries, currentRef, onSelectFile }: Props) {
  return (
    <div className="space-y-0.5">
      {entries.map((entry) => (
        <TreeItem
          key={entry.path}
          entry={entry}
          repoId={repoId}
          currentRef={currentRef}
          depth={0}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  );
}
