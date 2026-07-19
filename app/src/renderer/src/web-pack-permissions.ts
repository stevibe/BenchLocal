export function getWebPackIframeAllow(permissions: readonly string[]): string | undefined {
  return permissions.includes("media:microphone") ? "microphone" : undefined;
}

