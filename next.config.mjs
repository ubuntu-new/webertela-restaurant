/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /**
   * Where a build is written — normally `.next`, and somewhere else while a
   * deploy is in progress.
   *
   * This exists because of an outage. `next build` replaces `.next` *while the
   * running server is still reading from it*, so a build that fails halfway
   * leaves the live process on a half-replaced directory. The deploy script's
   * guard — "never restart on a failed build, the site keeps serving the old
   * code" — then makes it worse rather than better: the old code is exactly
   * what has just been destroyed, and every request returns 502 until somebody
   * notices and rebuilds by hand.
   *
   * With this, `scripts/deploy.sh` builds into a scratch directory and only
   * swaps it into place once the build has succeeded. A failed build now
   * touches nothing the running server can see, which is what the guard always
   * claimed. `next start` leaves the variable unset and reads `.next`.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",

  eslint: {
    /**
     * Lint runs, but it does not hold the door.
     *
     * ESLint was never installed here, so `next build` has been skipping it
     * silently for the life of the project and years of warnings have piled up
     * unseen. Turning it on as a build gate would mean the next deploy fails on
     * a decade of unused imports rather than on anything to do with the change
     * being deployed — and a check that blocks work it did not cause is a check
     * people disable.
     *
     * So: `npm run lint` reports, the deploy script prints the count, and the
     * list gets worked down deliberately. Types are the gate (`npm run
     * typecheck`), because a type error is always about the change in front of
     * you.
     */
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
