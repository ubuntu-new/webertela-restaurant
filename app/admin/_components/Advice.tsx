import Link from "next/link";
import type { Finding } from "@/lib/advice";

/**
 * What the software would say if it were standing next to the owner.
 *
 * Three findings, ranked by what is at stake. Not eleven — an owner who opens
 * this at nine in the morning with a delivery arriving is going to read the
 * first one and maybe the second. Anything below that is decoration, and a
 * screen full of warnings teaches him to ignore the screen.
 *
 * Each one reads consequence first, action second. "Food cost is 38%" is a
 * fact; "38% — every point above 33 is $340 a month, and it is usually
 * portions" is something he can do something about before lunch.
 */
export default function Advice({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return null;

  const shown = findings.slice(0, 3);
  const rest = findings.length - shown.length;

  return (
    <div className="advice">
      <h2>
        Worth your attention
        {rest > 0 && <span className="hint"> · {rest} more below the fold</span>}
      </h2>

      {shown.map((f) => (
        <div key={f.id} className={`advice-item sev-${f.severity}`}>
          <div className="advice-body">
            <div className="advice-title">{f.title}</div>
            <p className="advice-why">{f.why}</p>
          </div>
          {f.action && (
            <Link className="btn btn-ghost advice-do" href={f.action.href}>
              {f.action.label} →
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
