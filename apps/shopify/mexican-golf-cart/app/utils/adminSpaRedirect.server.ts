import { redirect } from "@remix-run/node";

function resolveAdminSpaBaseUrl(request: Request): URL {
  const configuredBaseUrl =
    process.env.ADMIN_SPA_BASE_URL?.trim() || process.env.SHOPIFY_APP_URL?.trim();

  if (configuredBaseUrl) {
    try {
      return new URL(configuredBaseUrl);
    } catch {
      // Fall through to the current request origin when configuration is invalid.
    }
  }

  return new URL(request.url);
}

export function redirectToAdminSpaPath(
  request: Request,
  pathname: `/${string}` | "/",
) {
  const requestUrl = new URL(request.url);
  const targetUrl = resolveAdminSpaBaseUrl(request);
  const passthroughParams = new URLSearchParams(requestUrl.search);

  // These params are Remix-internal and should not leak into the admin SPA URL.
  passthroughParams.delete("_data");
  passthroughParams.delete("index");

  targetUrl.pathname = pathname;
  targetUrl.search = passthroughParams.toString()
    ? `?${passthroughParams.toString()}`
    : "";
  targetUrl.hash = "";

  return redirect(targetUrl.toString());
}
