import { clerkMiddleware } from "@clerk/nextjs/server";

// Every page is public; Clerk's middleware only makes the session available.
export default clerkMiddleware();

export const config = {
  matcher: ["/((?!_next|draco|models|books|covers|.*\\.(?:html?|css|js|json|jpe?g|webp|png|gif|svg|ico|glb|pdf|woff2?)).*)", "/(api|trpc)(.*)"],
};
