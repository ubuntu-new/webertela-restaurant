-- The token a branch's local print agent authenticates with.
--
-- Nullable, so this changes nothing for a branch that has no agent yet: the
-- endpoint refuses a branch whose token is null rather than reading it as
-- "no token needed".
--
-- Additive and idempotent, like every migration in this project.

ALTER TABLE "Branch" ADD COLUMN IF NOT EXISTS "agentToken" TEXT;

-- Unique so a token identifies exactly one branch — which is what makes the
-- lookup safe: the agent presents a token and the server decides which queue
-- that is, rather than the agent naming a branch and the server believing it.
CREATE UNIQUE INDEX IF NOT EXISTS "Branch_agentToken_key"
  ON "Branch" ("agentToken");
