import { createRoot, type Root } from "react-dom/client";
import App from "./App";
import type { WriteConfig } from "./lib/config";
import stylesheet from "./styles.css?inline";

export type { WriteConfig };
export { App as WriteEditor };

const styleElementId = "subscript-write-styles";

const ensureStylesInjected = (ownerDocument: Document) => {
  if (ownerDocument.getElementById(styleElementId)) return;
  const style = ownerDocument.createElement("style");
  style.id = styleElementId;
  style.textContent = stylesheet;
  ownerDocument.head.append(style);
};

export type MountHandle = { unmount: () => void };

export function mount(element: HTMLElement, config?: Partial<WriteConfig>): MountHandle {
  ensureStylesInjected(element.ownerDocument);
  const root: Root = createRoot(element);
  root.render(<App config={config} />);
  return { unmount: () => root.unmount() };
}

const attributeConfig = (element: Element): Partial<WriteConfig> => {
  const attribute = (name: string) => element.getAttribute(name) ?? undefined;
  const subscriptEnabled = attribute("subscript-enabled");
  return {
    homepage: attribute("homepage"),
    signalingUrl: attribute("signaling-url"),
    stunUrl: attribute("stun-url"),
    turnUrl: attribute("turn-url"),
    turnUsername: attribute("turn-username"),
    turnCredential: attribute("turn-credential"),
    idpConfigUrl: attribute("idp-config-url"),
    subscriptEnabled: subscriptEnabled === undefined ? undefined : subscriptEnabled === "true",
  };
};

export class SubscriptWriteElement extends HTMLElement {
  private handle: MountHandle | null = null;

  connectedCallback() {
    this.style.display ||= "block";
    this.handle = mount(this, attributeConfig(this));
  }

  disconnectedCallback() {
    this.handle?.unmount();
    this.handle = null;
  }
}

export function defineCustomElement(tagName = "subscript-write") {
  if (!customElements.get(tagName)) customElements.define(tagName, SubscriptWriteElement);
}

defineCustomElement();
