// Clerk issues the JWTs (template "convex"); Convex checks them against this issuer.
// Set CLERK_JWT_ISSUER_DOMAIN in the Convex deployment, e.g. https://xxx.clerk.accounts.dev
export default {
  providers: [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN!, applicationID: "convex" }],
};
