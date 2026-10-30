import { NextResponse, type NextRequest } from "next/server";

const LOCALES = ["am", "en"];

/** Every page lives under /am or /en; send other paths to the user's saved or default language. */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const first = pathname.split("/")[1];
  if (first && LOCALES.includes(first)) return NextResponse.next();
  const saved = request.cookies.get("locale")?.value;
  const locale = saved && LOCALES.includes(saved) ? saved : "am";
  return NextResponse.redirect(new URL(`/${locale}${pathname === "/" ? "" : pathname}${search}`, request.url));
}

export const config = {
  matcher: ["/((?!_next|api|icon.svg|manifest.webmanifest|favicon.ico|sw.js|offline.html).*)"],
};
