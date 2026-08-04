export const deleteAtSelection = (text: string, start: number, end: number) => {
  if (start !== end) return { text: `${text.slice(0, start)}${text.slice(end)}`, caret: start };
  if (start >= text.length) return null;
  return { text: `${text.slice(0, start)}${text.slice(start + 1)}`, caret: start };
};

export const insertsLineBreak = (start: number, end: number, length: number, shiftKey: boolean) =>
  shiftKey || start !== end || (start > 0 && start < length);

export const insertLineBreak = (text: string, start: number, end: number) => ({
  text: `${text.slice(0, start)}\n${text.slice(end)}`,
  caret: start + 1,
});

export const mergeWithNextElement = (text: string, nextText: string) => ({
  text: `${text}${nextText}`,
  caret: text.length,
});
