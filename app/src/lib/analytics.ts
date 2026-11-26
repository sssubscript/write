// Write never talks to an analytics service itself. A host page that embeds or
// serves Write (such as subscript.to) may inject a bridge, either through the
// `analytics` config option or as `window.subscriptWriteAnalytics`, and forward
// what it receives to its own analytics. Without a bridge every call is a no-op.
//
// Events are anonymous usage signals only: they never carry document content,
// titles, file names, or any other text the writer typed.

export type AnalyticsPropertyValue = string | number | boolean;
export type AnalyticsProperties = Record<string, AnalyticsPropertyValue>;

export type AnalyticsBridge = {
  /** Record a product event. */
  capture: (event: string, properties?: AnalyticsProperties) => void;
  /** Store person properties without overwriting values already set. */
  setPersonPropertiesOnce?: (properties: AnalyticsProperties) => void;
};

declare global {
  interface Window {
    subscriptWriteAnalytics?: AnalyticsBridge;
  }
}

export type ExportFormat = "fdx" | "subscript";

// Every event and the only properties it may carry. Anything else is dropped,
// so a caller cannot leak content into an event by accident.
export type AnalyticsEvents = {
  "document created": Record<string, never>;
  "document opened": { shared: boolean };
  "document exported": { format: ExportFormat };
  "feedback shared": { format: ExportFormat };
};

const allowedProperties: { [Event in keyof AnalyticsEvents]: (keyof AnalyticsEvents[Event])[] } = {
  "document created": [],
  "document opened": ["shared"],
  "document exported": ["format"],
  "feedback shared": ["format"],
};

const exportFormats: readonly ExportFormat[] = ["fdx", "subscript"];

const sanitize = (event: keyof AnalyticsEvents, properties: object): AnalyticsProperties => {
  const values = properties as Record<string, unknown>;
  const result: AnalyticsProperties = {};
  for (const key of allowedProperties[event] as string[]) {
    const value = values[key];
    if (key === "format") {
      if (exportFormats.includes(value as ExportFormat)) result.format = value as ExportFormat;
    } else if (typeof value === "boolean") {
      result[key] = value;
    }
  }
  return result;
};

const resolveBridge = (injected?: AnalyticsBridge): AnalyticsBridge | undefined => {
  if (injected) return injected;
  if (typeof window === "undefined") return undefined;
  return window.subscriptWriteAnalytics;
};

// A broken host bridge must never break the editor.
const safely = (call: () => void) => {
  try {
    call();
  } catch {
    // ignored
  }
};

export type Analytics = {
  track: <Event extends keyof AnalyticsEvents>(
    event: Event,
    ...properties: AnalyticsEvents[Event] extends Record<string, never>
      ? []
      : [AnalyticsEvents[Event]]
  ) => void;
  recordFirstTouch: () => void;
};

export const createAnalytics = (injected?: AnalyticsBridge): Analytics => ({
  track: (event, ...properties) => {
    // Resolve on every call so a host can inject the bridge after mounting.
    const bridge = resolveBridge(injected);
    if (!bridge || typeof bridge.capture !== "function") return;
    const payload = sanitize(event, properties[0] ?? {});
    safely(() => bridge.capture(event, payload));
  },
  recordFirstTouch: () => {
    const firstTouch = loadFirstTouch();
    const bridge = resolveBridge(injected);
    if (!firstTouch || typeof bridge?.setPersonPropertiesOnce !== "function") return;
    safely(() => bridge.setPersonPropertiesOnce?.(firstTouch));
  },
});

export type FirstTouch = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  referring_domain: string;
  landing_page: string;
};

const firstTouchKey = "subscript.editor.first-touch.v1";
const utmKeys = ["utm_source", "utm_medium", "utm_campaign"] as const;

/** Builds first-touch attribution from a visit. The landing page omits the query and hash, which can carry room IDs. */
export const firstTouchFrom = (url: string, referrer: string): FirstTouch => {
  const location = new URL(url);
  const touch: FirstTouch = {
    referring_domain: "$direct",
    landing_page: `${location.origin}${location.pathname}`,
  };
  for (const key of utmKeys) {
    const value = location.searchParams.get(key)?.trim();
    if (value) touch[key] = value.slice(0, 200);
  }
  try {
    if (referrer) touch.referring_domain = new URL(referrer).hostname || "$direct";
  } catch {
    // keep $direct
  }
  return touch;
};

const loadFirstTouch = (): FirstTouch | null => {
  try {
    const stored = localStorage.getItem(firstTouchKey);
    return stored ? (JSON.parse(stored) as FirstTouch) : null;
  } catch {
    return null;
  }
};

/** Persists first-touch attribution on the first visit only; later visits keep the original values. */
export const persistFirstTouch = (url: string, referrer: string): FirstTouch | null => {
  const existing = loadFirstTouch();
  if (existing) return existing;
  const touch = firstTouchFrom(url, referrer);
  try {
    localStorage.setItem(firstTouchKey, JSON.stringify(touch));
  } catch {
    return null;
  }
  return touch;
};
