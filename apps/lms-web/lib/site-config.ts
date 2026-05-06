import type { Plan } from "@tracey/types";

export const siteConfig = {
  name: "Tracey",
  tagline: "Staff training that doesn't get in the way of the work.",
  description:
    "Tracey is the multi-tenant staff-training platform for operations teams. " +
    "Quizzes, qualifications, and audit trails — without the LMS bloat.",
  url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  contact: {
    sales: "sanjay.khadka@germanbutchery.com.au",
  },
  links: {
    flask: process.env.FLASK_BASE_URL ?? "http://localhost:5000",
  },
} as const;

export interface PricingTier {
  id: Plan;
  name: string;
  priceLabel: string;
  priceSubLabel: string;
  description: string;
  features: string[];
  cta: { kind: "signup" | "contact"; href: string; label: string };
  featured?: boolean;
  priceEnvVar?: "STRIPE_PRICE_STARTER" | "STRIPE_PRICE_PRO";
}

export const pricingTiers: readonly PricingTier[] = [
  {
    id: "starter",
    name: "Starter",
    priceLabel: "$TBD",
    priceSubLabel: "/seat / month",
    description: "For small teams getting their training programme off the ground.",
    features: [
      "Up to 25 seats",
      "Unlimited modules and quizzes",
      "Email support",
      "14-day free trial — no card required",
    ],
    cta: { kind: "signup", href: "/sign-up?plan=starter", label: "Start free trial" },
    priceEnvVar: "STRIPE_PRICE_STARTER",
  },
  {
    id: "pro",
    name: "Pro",
    priceLabel: "$TBD",
    priceSubLabel: "/seat / month",
    description: "For growing operations that need AI-generated quizzes and branding.",
    features: [
      "Everything in Starter",
      "Unlimited seats",
      "AI quiz generation from your SQF/NC documents",
      "Custom branding",
      "Priority support",
    ],
    cta: { kind: "signup", href: "/sign-up?plan=pro", label: "Start free trial" },
    featured: true,
    priceEnvVar: "STRIPE_PRICE_PRO",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    priceLabel: "Contact sales",
    priceSubLabel: "",
    description: "For large operations with SSO, SLAs, and dedicated success.",
    features: [
      "Everything in Pro",
      "SSO (SAML / OIDC)",
      "Custom SLAs",
      "Dedicated customer success manager",
      "Procurement-ready paperwork",
    ],
    cta: {
      kind: "contact",
      href: `mailto:sanjay.khadka@germanbutchery.com.au?subject=${encodeURIComponent(
        "Tracey Enterprise enquiry",
      )}`,
      label: "Contact sales",
    },
  },
] as const;

export function priceIdFor(plan: Plan): string | null {
  if (plan === "starter") return process.env.STRIPE_PRICE_STARTER ?? null;
  if (plan === "pro") return process.env.STRIPE_PRICE_PRO ?? null;
  return null;
}
