import type { Annotation } from "./project";

export type AnnotationSegment = {
  text: string;
  kinds: Annotation["kind"][];
};

export const annotationSegments = (
  text: string,
  annotations: Pick<Annotation, "kind" | "start" | "end">[],
): AnnotationSegment[] => {
  const boundaries = new Set([0, text.length]);
  for (const annotation of annotations) {
    boundaries.add(Math.max(0, Math.min(text.length, annotation.start)));
    boundaries.add(Math.max(0, Math.min(text.length, annotation.end)));
  }
  const points = [...boundaries].sort((left, right) => left - right);
  return points.slice(0, -1).flatMap((start, index) => {
    const end = points[index + 1];
    if (start === end) return [];
    return [
      {
        text: text.slice(start, end),
        kinds: annotations
          .filter((annotation) => annotation.start < end && annotation.end > start)
          .map((annotation) => annotation.kind),
      },
    ];
  });
};

export const transformAnnotation = (
  annotation: Annotation,
  change: { index: number; deleteCount: number; insert: string },
): Omit<Annotation, "quote"> | null => {
  const changeEnd = change.index + change.deleteCount;
  const shift = change.insert.length - change.deleteCount;
  if (changeEnd <= annotation.start) {
    return { ...annotation, start: annotation.start + shift, end: annotation.end + shift };
  }
  if (change.index >= annotation.end) return annotation;
  const start =
    change.index <= annotation.start ? change.index + change.insert.length : annotation.start;
  const end = annotation.end + shift;
  return end > start ? { ...annotation, start, end } : null;
};

export const transformAnnotations = (
  annotations: Annotation[],
  changes: { index: number; deleteCount: number; insert: string }[],
  text: string,
) =>
  annotations.flatMap((annotation) => {
    const transformed = changes.reduce<Omit<Annotation, "quote"> | null>(
      (current, change) => (current ? transformAnnotation(current as Annotation, change) : null),
      annotation,
    );
    return transformed
      ? [{ ...transformed, quote: text.slice(transformed.start, transformed.end) }]
      : [];
  });
