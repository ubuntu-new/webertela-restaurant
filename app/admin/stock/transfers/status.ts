/** გადატანის სტატუსები — ცალკე ფაილში, რადგან Next-ის გვერდი
 *  თვითნებურ ექსპორტს არ უშვებს. */

export const STATUS: Record<string, string> = {
  draft: "Draft",
  requested: "Requested",
  approved: "Approved",
  sent: "In transit",
  received: "Received",
  cancelled: "Cancelled",
};

export const TONE: Record<string, React.CSSProperties> = {
  requested: { background: "#fdf3d6", color: "#8a6a12" },
  approved: { background: "#e6eefc", color: "#1f4b99" },
  sent: { background: "#fdf3d6", color: "#8a6a12" },
  received: { background: "#e8f2e8", color: "#3f7d3f" },
  cancelled: { background: "#fdecea", color: "#b3261e" },
};
