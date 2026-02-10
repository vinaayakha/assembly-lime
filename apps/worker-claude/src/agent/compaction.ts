import type { AgentEventEmitter } from "./event-emitter";

type MessageLike = {
  role: string;
  content: string;
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function compactIfNeeded(
  messages: MessageLike[],
  emitter: AgentEventEmitter,
  maxTokens: number
): Promise<MessageLike[]> {
  let totalTokens = 0;
  for (const m of messages) {
    totalTokens += estimateTokens(m.content);
  }

  if (totalTokens <= maxTokens) {
    return messages;
  }

  const tokensBefore = totalTokens;

  // Keep system message + most recent messages within budget
  const budget = maxTokens * 0.8;
  const systemMessages = messages.filter((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");

  let systemTokens = 0;
  for (const m of systemMessages) {
    systemTokens += estimateTokens(m.content);
  }

  const remaining = budget - systemTokens;
  const kept: MessageLike[] = [];
  let keptTokens = 0;

  for (let i = nonSystem.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(nonSystem[i].content);
    if (keptTokens + tokens > remaining) break;
    kept.unshift(nonSystem[i]);
    keptTokens += tokens;
  }

  const droppedCount = nonSystem.length - kept.length;
  const summaryMessage: MessageLike = {
    role: "system",
    content: `[Context compacted: ${droppedCount} earlier messages were summarized to stay within token budget]`,
  };

  const compacted = [...systemMessages, summaryMessage, ...kept];
  const tokensAfter = systemTokens + estimateTokens(summaryMessage.content) + keptTokens;

  await emitter.emit({
    type: "compaction",
    tokensBefore,
    tokensAfter,
    summary: `Compacted ${droppedCount} messages, reduced from ~${tokensBefore} to ~${tokensAfter} tokens`,
  });

  return compacted;
}
