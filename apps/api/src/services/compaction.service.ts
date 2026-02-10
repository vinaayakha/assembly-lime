import { childLogger } from "../lib/logger";

const log = childLogger({ module: "compaction-service" });

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

type EventLike = {
  type: string;
  text?: string;
  message?: string;
  unifiedDiff?: string;
  [key: string]: unknown;
};

export function shouldCompact(events: EventLike[], maxTokens: number): boolean {
  let totalTokens = 0;
  for (const e of events) {
    const content = e.text ?? e.message ?? e.unifiedDiff ?? "";
    totalTokens += estimateTokens(content);
  }
  return totalTokens > maxTokens;
}

export function compactContext(
  events: EventLike[],
  maxTokens: number
): { compactedPrompt: string; tokensBefore: number; tokensAfter: number } {
  let totalTokens = 0;
  const texts: string[] = [];

  for (const e of events) {
    const content = e.text ?? e.message ?? e.unifiedDiff ?? "";
    texts.push(content);
    totalTokens += estimateTokens(content);
  }

  const tokensBefore = totalTokens;

  if (totalTokens <= maxTokens) {
    return {
      compactedPrompt: texts.join("\n"),
      tokensBefore,
      tokensAfter: totalTokens,
    };
  }

  // Keep the most recent events that fit within budget, summarize the rest
  const budget = maxTokens * 0.8;
  const recentTexts: string[] = [];
  let recentTokens = 0;

  for (let i = texts.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(texts[i]);
    if (recentTokens + tokens > budget) break;
    recentTexts.unshift(texts[i]);
    recentTokens += tokens;
  }

  const droppedCount = texts.length - recentTexts.length;
  const summaryPrefix = `[Context compacted: ${droppedCount} earlier messages summarized to save tokens]\n\n`;
  const compactedPrompt = summaryPrefix + recentTexts.join("\n");
  const tokensAfter = estimateTokens(compactedPrompt);

  log.info({ tokensBefore, tokensAfter, droppedCount }, "context compacted");

  return { compactedPrompt, tokensBefore, tokensAfter };
}
