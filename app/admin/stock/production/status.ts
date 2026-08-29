/** წარმოების სტატუსები — ცალკე ფაილში, რადგან Next-ის გვერდი
 *  თვითნებურ ექსპორტს არ უშვებს. */

export const PSTATUS: Record<string, string> = {
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

export const PTONE: Record<string, React.CSSProperties> = {
  in_progress: { background: "#fdf3d6", color: "#8a6a12" },
  done: { background: "#e8f2e8", color: "#3f7d3f" },
  cancelled: { background: "#fdecea", color: "#b3261e" },
};
