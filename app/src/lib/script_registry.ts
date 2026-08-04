export type ScriptRecord = {
  id: string;
  title: string;
  updatedAt: string;
};

const storageKey = "subscript.editor.scripts.v1";

export const listScripts = (): ScriptRecord[] => {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "[]") as ScriptRecord[];
    return stored.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } catch {
    return [];
  }
};

export const saveScript = (record: ScriptRecord) => {
  const next = [record, ...listScripts().filter((script) => script.id !== record.id)];
  localStorage.setItem(storageKey, JSON.stringify(next));
  return next;
};
