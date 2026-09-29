/**
 * The origin a browser actually used to reach us.
 *
 * Behind a reverse proxy — DigitalOcean App Platform, and most hosts — the
 * request the app receives has been rewritten to an internal address. `req.url`
 * there is `http://localhost:8080`, so a redirect built from it sends the
 * person's browser to their own machine. That is exactly what signing out did.
 *
 * The proxy forwards the real values in x-forwarded-proto / x-forwarded-host,
 * so those are honoured first. APP_URL overrides both, for a deployment whose
 * proxy does not set them; req.url is the last resort and is correct in local
 * development, where there is no proxy in the way.
 */
export function siteOrigin(req: Request): string {
  const env = process.env.APP_URL?.trim();
  if (env) return env.replace(/\/+$/, "");

  const h = req.headers;
  const url = new URL(req.url);
  // May be a list ("https,http") when more than one proxy has appended to it;
  // the client-facing one is first.
  const proto = (h.get("x-forwarded-proto") ?? url.protocol.replace(":", ""))
    .split(",")[0]
    .trim();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? url.host)
    .split(",")[0]
    .trim();

  return `${proto}://${host}`;
}

/** An absolute URL for a path on this app, as the browser should see it. */
export function siteUrl(req: Request, path: string): string {
  return new URL(path, siteOrigin(req)).toString();
}
