export const encodeBase64Url = (bytes: Uint8Array): string =>
  Buffer.from(bytes)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

export const decodeBase64Url = (text: string): Uint8Array | undefined => {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) {
    return undefined;
  }
  const padded = `${text}${"=".repeat((4 - (text.length % 4)) % 4)}`;
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
};
