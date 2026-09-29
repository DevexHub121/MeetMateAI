/**
 * The origin a browser actually used to reach us.
 *
 * Behind a reverse proxy — DigitalOcean App Platform, and most hosts — the
 * request the app receives has been rewritten to an internal address. `req.url`
 * there is `http://localhost:8080`, so a redirect built from it sends the
 * person's browser to their own machine.
 */
export function siteOrigin(req: Request): string {
  const h = req.headers;
  const url = new URL(req.url);

  /*
   * The forwarded host wins over APP_URL, and that order is load-bearing.
   *
   * APP_URL is a value someone typed into a dashboard once, so it goes stale.
   * This app was called Echo, and an APP_URL still pointing at the old domain
   * sent everyone who signed out to a host that no longer serves them. The
   * forwarded host cannot go stale: it is the domain the browser is on right
   * now, which for a redirect back into the same app is exactly right.
   *
   * APP_URL remains the fallback for a deployment whose proxy sets no
   * forwarded headers, and req.url is last — correct in local development,
   * where nothing sits in front of us.
   *
   * Email is a separate problem and still needs APP_URL: a background job
   * writing minutes has no request to read a host from.
   */
  const fwdHost = h.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (fwdHost) {
    const proto = (h.get("x-forwarded-proto") ?? "https").split(",")[0].trim();
    return `${proto}://${fwdHost}`;
  }

  const env = process.env.APP_URL?.trim();
  if (env) return env.replace(/\/+$/, "");

  const host = (h.get("host") ?? url.host).split(",")[0].trim();
  return `${url.protocol.replace(":", "")}://${host}`;
}

/** An absolute URL for a path on this app, as the browser should see it. */
export function siteUrl(req: Request, path: string): string {
  return new URL(path, siteOrigin(req)).toString();
}
