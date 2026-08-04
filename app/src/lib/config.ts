export type WriteConfig = {
  homepage: string;
  signalingUrl: string;
  stunUrl: string;
  turnUrl?: string;
  turnUsername?: string;
  turnCredential?: string;
  idpConfigUrl?: string;
  subscriptEnabled: boolean;
};

export const defaultConfig: WriteConfig = {
  homepage: "https://subscript.to",
  signalingUrl: "wss://y-webrtc-eu.fly.dev",
  stunUrl: "stun:stun.l.google.com:19302",
  subscriptEnabled: false,
};

export const mergeConfig = (overrides?: Partial<WriteConfig>): WriteConfig => {
  const defined = Object.fromEntries(
    Object.entries(overrides ?? {}).filter(([, value]) => value !== undefined),
  );
  return { ...defaultConfig, ...defined };
};

export const configFromEnv = (): WriteConfig => {
  const subscriptEnabled = import.meta.env.VITE_SUBSCRIPT_ENABLED === "true";
  return mergeConfig({
    homepage: import.meta.env.VITE_HOMEPAGE || defaultConfig.homepage,
    signalingUrl: import.meta.env.VITE_SIGNALING_URL || defaultConfig.signalingUrl,
    stunUrl: import.meta.env.VITE_STUN_URL || defaultConfig.stunUrl,
    turnUrl: import.meta.env.VITE_TURN_URL || undefined,
    turnUsername: import.meta.env.VITE_TURN_USERNAME || undefined,
    turnCredential: import.meta.env.VITE_TURN_CREDENTIAL || undefined,
    idpConfigUrl:
      import.meta.env.VITE_EDITOR_IDP_CONFIG_URL ||
      (subscriptEnabled ? "/write/identity/config" : undefined),
    subscriptEnabled,
  });
};
