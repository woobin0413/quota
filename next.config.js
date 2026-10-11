const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      // Auth0 profile pictures
      {
        protocol: "https",
        hostname: "s.gravatar.com",
      },
      {
        protocol: "https",
        hostname: "*.gravatar.com",
      },
      {
        protocol: "https",
        hostname: "cdn.auth0.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // The in-app /login and /signup pages were removed in favour of sending
  // people straight to Auth0 Universal Login. Without these, an old bookmark
  // falls through to the auth middleware, which redirects with returnTo=/signup
  // and drops the user on a 404 *after* they successfully sign in. These run
  // before middleware, so the stale paths never reach it.
  async redirects() {
    return [
      { source: "/login", destination: "/auth/login?returnTo=%2Fdashboard", permanent: false },
      {
        source: "/signup",
        destination: "/auth/login?screen_hint=signup&returnTo=%2Fdashboard",
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
