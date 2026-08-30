/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

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
