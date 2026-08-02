import type { NextConfig } from "next";

/**
 * Refuse to produce a deployable build from a development configuration.
 *
 * These run at build time, in the Vercel build container, so a bad value fails
 * the deploy instead of shipping. Each is a setting that is correct locally and
 * wrong once the output is served to someone else.
 *
 * GATED ON THE INVOKED COMMAND, and neither of the two obvious alternatives
 * works: `next lint` sets NODE_ENV=production AND loads this config with
 * `PHASE_PRODUCTION_BUILD`, so both an NODE_ENV check and a phase check made
 * `npm run lint` fail with a deployment error on a developer machine whose
 * NEXT_PUBLIC_API_URL is quite correctly http://localhost:8000 (CI runs lint,
 * so this would have broken the pipeline, not just a laptop).
 *
 * The argv check is blunt but it is the thing that actually differs between
 * "emit an artifact someone will be served" and "read the config to lint".
 */
function isProductionBuild(): boolean {
  return process.argv.some((a) => a === "build" || a.endsWith("/build"));
}

function assertDeployableEnv() {
  const problems: string[] = [];
  const {
    NEXT_PUBLIC_PEAK3_E2E_AUTH,
    NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL,
  } = process.env;

  // The E2E auth bridge. It is already dead code in a production bundle — the
  // NODE_ENV check in lib/supabase/config.ts folds it away — so this is not the
  // security boundary. It is here because its PRESENCE means someone copied a
  // test environment into a deploy, and whatever else came with it is the
  // actual problem.
  if (NEXT_PUBLIC_PEAK3_E2E_AUTH) {
    problems.push(
      "NEXT_PUBLIC_PEAK3_E2E_AUTH is set. It is inert in a production build, " +
        "but its presence means a test environment was copied into a deploy.",
    );
  }

  const localish = (v?: string) =>
    !!v && /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/i.test(v);

  // A production bundle inlines these at build time, so a localhost value is
  // baked into every visitor's JavaScript and cannot be fixed without rebuilding.
  for (const [name, value] of [
    ["NEXT_PUBLIC_API_URL", NEXT_PUBLIC_API_URL],
    ["NEXT_PUBLIC_SUPABASE_URL", NEXT_PUBLIC_SUPABASE_URL],
    ["NEXT_PUBLIC_SITE_URL", NEXT_PUBLIC_SITE_URL],
  ] as const) {
    if (localish(value)) {
      problems.push(`${name}=${value} points at localhost and would be inlined into the bundle.`);
    }
  }

  if (!NEXT_PUBLIC_API_URL) {
    problems.push("NEXT_PUBLIC_API_URL is required; without it the app calls http://localhost:8000.");
  }
  for (const [name, value] of [
    ["NEXT_PUBLIC_API_URL", NEXT_PUBLIC_API_URL],
    ["NEXT_PUBLIC_SUPABASE_URL", NEXT_PUBLIC_SUPABASE_URL],
    ["NEXT_PUBLIC_SITE_URL", NEXT_PUBLIC_SITE_URL],
  ] as const) {
    if (value && value.startsWith("http://")) {
      problems.push(`${name} is http://; use https:// for a deployed environment.`);
    }
  }

  // Auth is optional by design, but half-configured auth is not: a URL with no
  // key renders the account surface and then cannot construct a client.
  if (Boolean(NEXT_PUBLIC_SUPABASE_URL) !== Boolean(NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    problems.push(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set together.",
    );
  }

  // A service-role key is a server secret and must never be inlined. Checked by
  // shape (Supabase JWTs carry the role in the payload) rather than by name, so
  // pasting one into the anon-key slot is caught too.
  for (const [name, value] of [
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", NEXT_PUBLIC_SUPABASE_ANON_KEY],
  ] as const) {
    if (value && /service_role/.test(Buffer.from(value.split(".")[1] ?? "", "base64").toString("utf8"))) {
      problems.push(`${name} contains a SERVICE ROLE key. This would be public in the browser bundle.`);
    }
  }

  if (problems.length) {
    throw new Error(
      "Refusing to build: this environment is not deployable.\n  - " + problems.join("\n  - "),
    );
  }
}

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default function config(): NextConfig {
  if (isProductionBuild()) assertDeployableEnv();
  return nextConfig;
}
