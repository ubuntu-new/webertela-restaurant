import Link from "next/link";
import type { Checklist, Goal, Step } from "@/lib/setup-checklist";

/**
 * What is still between this restaurant and a true prime cost.
 *
 * The shape is the argument. One thing at the top, large, with what it gets you
 * and how long it takes — then the rest, grouped under the figure each group
 * unlocks, so that the order carries meaning instead of being nine equal boxes.
 *
 * An owner reads the first block and nothing else. That is not a failure of
 * attention; it is a delivery arriving in ten minutes. So the first block has
 * to be worth the whole screen on its own.
 */

function minutes(m: number): string {
  if (m <= 0) return "";
  if (m < 60) return `about ${m} minutes`;
  const h = Math.round((m / 60) * 10) / 10;
  return `about ${h % 1 === 0 ? h : h.toFixed(1)} hours`;
}

function StepRow({ step }: { step: Step }) {
  return (
    <div className="setup-step">
      <span className={`setup-mark ${step.done ? "setup-mark-done" : "setup-mark-todo"}`}>
        {step.done ? "✓" : "•"}
      </span>
      <div className="setup-step-body">
        <b style={step.done ? { color: "var(--a-muted)", fontWeight: 500 } : undefined}>{step.title}</b>

        {step.done ? (
          <span>{step.detail}</span>
        ) : (
          <>
            <span>{step.why}</span>

            {/* A count rather than a tick. "34 of 41" is the difference between
                knowing there is work left and knowing how much. */}
            {step.progress && step.progress.total > 0 && (
              <span className="setup-count">
                {step.progress.done} of {step.progress.total} {step.progress.noun}
                <span className="setup-bar">
                  <i style={{ width: `${Math.round((step.progress.done / step.progress.total) * 100)}%` }} />
                </span>
              </span>
            )}

            {/* Named, because "4 ingredients have no price" sends somebody
                looking and "mozzarella, flour, parmesan, basil" does not. */}
            {step.missing && step.missing.length > 0 && (
              <span className="setup-missing">{step.missing.join(" · ")}</span>
            )}

            <Link href={step.href}>
              Open →{step.minutes > 0 && <span className="hint"> {minutes(step.minutes)}</span>}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function GoalBlock({ goal }: { goal: Goal }) {
  return (
    <div className={`setup-goal${goal.reached ? " setup-goal-done" : ""}`}>
      <div className="setup-goal-head">
        <b>
          {goal.reached && <span className="setup-goal-tick">✓</span>}
          {goal.title}
        </b>
        {!goal.reached && goal.minutes > 0 && <span className="hint">{minutes(goal.minutes)} left</span>}
      </div>
      <p>{goal.why}</p>
      {goal.steps.map((s) => (
        <StepRow key={s.id} step={s} />
      ))}
    </div>
  );
}

export default function SetupChecklist({ goals, next, done, total }: Checklist) {
  if (!next) {
    return (
      <div className="admin-panel">
        <h2>Setup</h2>
        <p style={{ margin: 0, fontSize: 14.5 }}>
          <b>Everything is in.</b> Food cost, prime cost and profit on this page are all worked out
          from your own trading — no estimates, nothing assumed.
        </p>
      </div>
    );
  }

  // Time still owed to this goal once the next step is out of the way.
  const rest = Math.max(0, next.goal.minutes - next.step.minutes);

  return (
    <div className="admin-panel">
      <h2>
        Getting set up <span className="hint">· {done} of {total}</span>
      </h2>

      {/* One thing, said properly. Everything below is for whoever wants it. */}
      <div className="setup-next">
        <span className="setup-next-label">Next</span>
        <b>{next.step.title}</b>
        <p>{next.step.why}</p>

        {next.step.progress && next.step.progress.total > 0 && (
          <p className="setup-next-count">
            {next.step.progress.done} of {next.step.progress.total} {next.step.progress.noun} done
            {next.step.missing && next.step.missing.length > 0 && (
              <>
                {" — still missing: "}
                <b>{next.step.missing.join(", ")}</b>
              </>
            )}
          </p>
        )}

        <div className="setup-next-actions">
          <Link className="btn" href={next.step.href}>
            Open this
          </Link>
          {/* What this one step costs, and what stands between it and the
              figure. Assembled from parts rather than a template string,
              because "about 0 minutes · then" is what a template produces on
              the step that takes no time at all. */}
          <span className="hint">
            {rest > 0
              ? `${minutes(next.step.minutes)} — then ${minutes(rest)} more to ${next.goal.after}`
              : `${minutes(next.step.minutes)} — and you can ${next.goal.after}`}
          </span>
        </div>
      </div>

      {goals.map((g) => (
        <GoalBlock key={g.id} goal={g} />
      ))}
    </div>
  );
}
