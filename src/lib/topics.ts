export interface Topic {
  id: string;
  title: string;
  description: string;
  parentId: string | null;
  /** Full session path; bounded context is sent to the server. */
  path: string[];
}
export interface Branch {
  title: string;
  description: string;
}
export const ROOT: Topic = {
  id: "computer-science",
  title: "Computer science",
  parentId: null,
  path: ["Computer science"],
  description: "Memahami komputasi, dari gagasan paling dasar hingga sistem yang kita gunakan setiap hari.",
};
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}
export function isBranch(value: unknown): value is Branch {
  return isRecord(value) && text(value.title, 160) && text(value.description, 500);
}
export function isBranches(value: unknown): value is { branches: Branch[] } {
  return isRecord(value) && Array.isArray(value.branches) && value.branches.length === 4 && value.branches.every(isBranch);
}
export function isTopic(value: unknown): value is Topic {
  return (
    isBranch(value) &&
    isRecord(value) &&
    text(value.id, 128) &&
    (value.parentId === null || text(value.parentId, 128)) &&
    Array.isArray(value.path) &&
    value.path.length >= 1 &&
    value.path.length <= 16 &&
    value.path.every((part: unknown) => text(part, 160)) &&
    value.path[0] === ROOT.title &&
    value.path.at(-1) === value.title &&
    (value.parentId === null ? value.id === ROOT.id && value.title === ROOT.title && value.path.length === 1 : value.path.length >= 2)
  );
}
export function topicContext(topic: Topic): Topic {
  return { ...topic, path: topic.path.length > 16 ? [ROOT.title, ...topic.path.slice(-15)] : topic.path };
}
