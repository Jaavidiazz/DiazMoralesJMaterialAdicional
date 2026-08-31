import type { NextConfig } from "next";

// Orígenes con los que el navegador contacta directamente: el backend y
// Supabase. Se usan para construir la cabecera Content-Security-Policy.
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

const connectSrc = ["'self'", API_URL, SUPABASE_URL].filter(Boolean).join(" ");
const imgSrc = ["'self'", "data:", "blob:", API_URL, SUPABASE_URL].filter(Boolean).join(" ");

// Next.js inyecta scripts y estilos inline para la hidratación, así que
// script-src/style-src necesitan 'unsafe-inline'. Una CSP con nonces
// exigiría generarlos por petición en el middleware.
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src ${imgSrc}`,
  `font-src 'self' data:`,
  `connect-src ${connectSrc}`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
