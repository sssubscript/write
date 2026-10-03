// Get Feedback must land on the canonical Subscript site, where SSO works,
// even when the editor is served from another host such as write.subscript.to.
export const feedbackRedirectUrl = (
  redirectUrl: string,
  homepage: string,
  currentOrigin: string,
): string => {
  const canonical = new URL(homepage);
  const target = new URL(redirectUrl, canonical);
  if (target.origin === currentOrigin && currentOrigin !== canonical.origin) {
    target.protocol = canonical.protocol;
    target.host = canonical.host;
  }
  return target.toString();
};
