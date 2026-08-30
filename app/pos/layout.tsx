import type { Metadata, Viewport } from "next";
import "./pos.css";

/**
 * The till is installed, not visited.
 *
 * `manifest` plus `appleWebApp` let the cashier add it to the home screen and
 * launch it without browser chrome. That is worth more than it looks: an
 * installed page keeps its own storage, is far less likely to be discarded by
 * the browser when memory runs short, and cannot be closed by someone reaching
 * for a tab. Together with the service worker it is what turns "a website that
 * mostly works offline" into something a restaurant can put on a counter.
 */
export const metadata: Metadata = {
  title: "Ronny's — POS",
  robots: { index: false, follow: false },
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "Till", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

/** A till is a fixed screen: no zoom, no accidental pinch mid-order. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#c94a24",
};

export default function PosLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="pos-body">{children}</body>
    </html>
  );
}
