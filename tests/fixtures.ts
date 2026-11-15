import type { FeedEntry, FeedPage } from "../src/lib/feed-contract";
import { ROOT, type Topic } from "../src/lib/topics";

export const content = {
  explanation: ["Komputasi mengubah masukan menjadi keluaran.", "Algoritma menjelaskan langkah-langkah yang digunakan."],
  importance: "Memahami dasar komputasi membantu kita menilai sistem.",
};
export function entries(count: number): FeedEntry[] {
  const result: FeedEntry[] = [];
  for (let i = 0; i < count; i++) {
    const parent = result[Math.floor((i - 1) / 4)]?.topic ?? ROOT;
    const topic: Topic =
      i === 0 ? ROOT : { id: `global-${i}`, title: `Concept ${i}`, description: "Cabang Computer Science.", parentId: parent.id, path: [...parent.path, `Concept ${i}`] };
    result.push({ sequence: i + 1, topic, content: { ...content, importance: `${content.importance} ${i}` } });
  }
  return result;
}
export function page(items: FeedEntry[], after = 0, limit = 2): FeedPage {
  const selected = items.filter((entry) => entry.sequence > after).slice(0, limit);
  return { entries: selected, nextCursor: selected.at(-1)?.sequence ?? after, hasMore: items.length > after + selected.length, generation: { state: "idle" } };
}
export function completion(value: unknown = content, finishReason = "STOP") {
  return { candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(value) }] } }] };
}
