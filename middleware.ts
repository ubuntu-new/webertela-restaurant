import { NextResponse, type NextRequest } from "next/server";
import { LOCALES, DEFAULT_LOCALE } from "./lib/locales";
import { jwtVerify } from "jose";

const ADMIN_COOKIE = "ronnys_admin";

async function hasValidSession(token?: string) {
  if (!token || !process.env.AUTH_SECRET) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET));
    return true;
  } catch {
    return false;
  }
}

/**
 * A redirect target the browser can actually follow.
 *
 * Behind a reverse proxy Next sees `localhost:3001` as the host, so
 * `req.nextUrl.clone()` produces `https://localhost:3001/…` — a URL that works
 * from inside the server and nowhere else. The locale redirect already worked
 * around this; the admin one did not, so the very first login on a fresh
 * instance sent the owner to a dead address. Onboarding a customer is exactly
 * when nobody has a session cookie yet.
 *
 * Two sources, in order of trust: X-Forwarded-Host, which Caddy sets on every
 * request, then NEXT_PUBLIC_SITE_URL.
 */
function publicUrl(req: NextRequest, pathname: string): URL {
  const url = req.nextUrl.clone();
  url.pathname = pathname;

  const fwdHost = req.headers.get("x-forwarded-host");
  if (fwdHost) {
    url.protocol = `${req.headers.get("x-forwarded-proto") ?? "https"}:`;
    url.host = fwdHost;
    url.port = "";
    return url;
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) {
    try {
      const base = new URL(site);
      url.protocol = base.protocol;
      url.host = base.host;
      url.port = base.port;
    } catch {
      /* a malformed value is not worth failing a request over */
    }
  }
  return url;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── /pos — ტერმინალს ენის პრეფიქსი არ სჭირდება.
  // სესიას თვითონ ამოწმებს (ცალკე cookie), ამიტომ აქ მხოლოდ გვატარებთ.
  if (pathname === "/pos" || pathname.startsWith("/pos/")) {
    return NextResponse.next();
  }

  // ── /driver — კურიერის ეკრანს ენის პრეფიქსი არ სჭირდება ──
  if (pathname === "/driver" || pathname.startsWith("/driver/")) {
    return NextResponse.next();
  }

  // ── /admin — locale-რედირექტი არ ვრცელდება, სამაგიეროდ სესია მოწმდება ──
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (pathname === "/admin/login") return NextResponse.next();

    const ok = await hasValidSession(req.cookies.get(ADMIN_COOKIE)?.value);
    if (!ok) {
      const url = publicUrl(req, "/admin/login");
      url.search = "";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // ── საიტის i18n (უცვლელი) ──
  const hasLocale = LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
  if (hasLocale) return NextResponse.next();

  const accept = (req.headers.get("accept-language") || "").toLowerCase();
  const detected = accept.includes("ka") || accept.includes("ge") ? "ka" : accept.includes("en") ? "en" : DEFAULT_LOCALE;
  const url = publicUrl(req, `/${detected}${pathname === "/" ? "" : pathname}`);
  return NextResponse.redirect(url);
}

// Skip Next internals, API routes, and anything with a file extension.
export const config = {
  matcher: ["/((?!_next|api|.*\\.).*)"],
};
