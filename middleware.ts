import { NextResponse, type NextRequest } from "next/server";
import { ALL_LOCALES, LOCALES, DEFAULT_LOCALE } from "./lib/locales";
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

  /**
   * ⚠️ The `Host` header, and nothing cleverer. Two things were wrong before.
   *
   * ── The fallback was dead code ──
   *
   * It read `x-forwarded-host` first "which Caddy sets on every request", and
   * fell back to NEXT_PUBLIC_SITE_URL. But **Next sets x-forwarded-host itself,
   * on every request**, proxy or no proxy — so the first branch always won and
   * the configured value was never once used. A fallback that cannot run is not
   * a fallback; it is a comment.
   *
   * ── And the port was thrown away ──
   *
   *   url.host = fwdHost;
   *   url.port = "";
   *
   * Correct behind Caddy, where the public site is on 443 — and wrong
   * everywhere else. Through an SSH tunnel, `localhost:3006/admin` redirected
   * to `http://localhost/admin/login`: port 80, nothing listening, connection
   * refused. Which is how this was found, by somebody trying to log in.
   *
   * ── What is actually true ──
   *
   * `Host` is the address the browser asked for. It carries the port when there
   * is one and omits it when there is not, which is exactly the distinction
   * being destroyed above. Caddy overwrites it with the public hostname, so
   * behind the proxy it is the public name; hit directly, it is whatever you
   * typed. Both are right, and neither needs configuring.
   *
   * Only the scheme needs help: TLS ends at Caddy, so the request arrives as
   * http and `x-forwarded-proto` is the one honest thing it adds.
   */
  /**
   * ⚠️ hostname and port set separately, and never `url.host = …`.
   *
   * Assigning `host` looks like it replaces both. It does not: given a value
   * with no port, the URL spec leaves the existing port **untouched**. So
   *
   *   url.host = "testkitchen.webertela.online"   // request arrived on :3006
   *
   * produced `https://testkitchen.webertela.online:3006/admin/login` — the
   * public hostname with the internal port stapled to it, which is a worse
   * address than either half.
   *
   * That is the mirror image of the bug being fixed. The old code cleared the
   * port unconditionally and was right behind Caddy and wrong on a tunnel; the
   * first attempt at a fix preserved it unconditionally and was right on a
   * tunnel and wrong behind Caddy. Both were tested against one case.
   *
   * The Host header already carries the answer — a port when the browser used
   * one, none when it did not. Reading both halves out of it is the only
   * version that is right in both places.
   */
  const host = req.headers.get("host");
  if (host) {
    // lastIndexOf, and a digits check, so `[::1]:3006` and a bare IPv6 host
    // both survive.
    const at = host.lastIndexOf(":");
    const port = at > -1 ? host.slice(at + 1) : "";
    const hasPort = at > -1 && /^\d+$/.test(port);

    url.hostname = hasPort ? host.slice(0, at) : host;
    url.port = hasPort ? port : "";
  }

  const proto = req.headers.get("x-forwarded-proto");
  if (proto) url.protocol = `${proto.split(",")[0].trim()}:`;

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

  // ── site i18n ──
  const hasLocale = LOCALES.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
  if (hasLocale) return NextResponse.next();

  // A language this build knows about but this restaurant does not offer —
  // /ka on an English-only menu. Replace that segment instead of prefixing it,
  // or every request grows another /ka and the browser gives up after twenty.
  const first = pathname.split("/")[1];
  if ((ALL_LOCALES as readonly string[]).includes(first)) {
    const rest = pathname.slice(first.length + 1) || "";
    return NextResponse.redirect(publicUrl(req, `/${DEFAULT_LOCALE}${rest}`));
  }

  // What the browser asks for only counts if the restaurant serves it. A Monroe
  // pizzeria offers English; a visitor whose phone is set to Georgian still
  // gets the English menu, because there is no other one.
  const accept = (req.headers.get("accept-language") || "").toLowerCase();
  const wanted =
    accept.includes("ka") || accept.includes("ge") ? "ka"
    : accept.includes("en") ? "en"
    : DEFAULT_LOCALE;
  const detected = (LOCALES as readonly string[]).includes(wanted) ? wanted : DEFAULT_LOCALE;

  const url = publicUrl(req, `/${detected}${pathname === "/" ? "" : pathname}`);
  return NextResponse.redirect(url);
}

// Skip Next internals, API routes, and anything with a file extension.
export const config = {
  matcher: ["/((?!_next|api|.*\\.).*)"],
};
