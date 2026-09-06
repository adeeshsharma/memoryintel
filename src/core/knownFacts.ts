export interface KnownFact {
  // Dependency name(s) (as they'd appear as a package.json dependencies/devDependencies key)
  // that trigger this fact. An array covers a library published under multiple common names.
  match: string | string[];
  fact: string;
  target: 'techContext' | 'integrations';
}

// A curated, deliberately small starter set covering common frameworks, CMS, DB, payment, and
// auth libraries. Extending this is a one-line PR to this file - no plugin system needed at this
// scale (see spec's "Non-goals").
export const KNOWN_FACTS: KnownFact[] = [
  { match: 'next', fact: 'Next.js (React framework)', target: 'techContext' },
  { match: 'react', fact: 'React', target: 'techContext' },
  { match: 'vue', fact: 'Vue', target: 'techContext' },
  { match: 'svelte', fact: 'Svelte', target: 'techContext' },
  { match: 'typescript', fact: 'TypeScript', target: 'techContext' },
  { match: 'express', fact: 'Express', target: 'techContext' },
  { match: 'fastify', fact: 'Fastify', target: 'techContext' },
  { match: 'prisma', fact: 'Prisma (ORM)', target: 'techContext' },
  { match: 'mongoose', fact: 'MongoDB (via Mongoose)', target: 'techContext' },
  { match: 'tailwindcss', fact: 'Tailwind CSS', target: 'techContext' },
  { match: ['@sanity/client', 'sanity'], fact: 'Sanity (headless CMS)', target: 'integrations' },
  { match: 'contentful', fact: 'Contentful (headless CMS)', target: 'integrations' },
  { match: 'stripe', fact: 'Stripe (payments)', target: 'integrations' },
  { match: '@supabase/supabase-js', fact: 'Supabase', target: 'integrations' },
  { match: 'firebase', fact: 'Firebase', target: 'integrations' },
  { match: 'firebase-admin', fact: 'Firebase Admin SDK', target: 'integrations' },
  { match: 'next-auth', fact: 'NextAuth.js (authentication)', target: 'integrations' },
  { match: '@auth0/nextjs-auth0', fact: 'Auth0 (authentication)', target: 'integrations' },
  { match: '@clerk/nextjs', fact: 'Clerk (authentication)', target: 'integrations' },
  { match: '@sendgrid/mail', fact: 'SendGrid (email)', target: 'integrations' },
  { match: 'resend', fact: 'Resend (email)', target: 'integrations' },
  { match: 'twilio', fact: 'Twilio', target: 'integrations' },
  { match: '@aws-sdk/client-s3', fact: 'AWS S3', target: 'integrations' },
  { match: 'openai', fact: 'OpenAI API', target: 'integrations' },
  { match: '@anthropic-ai/sdk', fact: 'Anthropic API', target: 'integrations' },
  { match: '@sentry/node', fact: 'Sentry (error tracking)', target: 'integrations' },
  { match: '@sentry/nextjs', fact: 'Sentry (error tracking)', target: 'integrations' },
  { match: 'posthog-js', fact: 'PostHog (analytics)', target: 'integrations' },
  { match: '@vercel/analytics', fact: 'Vercel Analytics', target: 'integrations' },
  { match: 'graphql', fact: 'GraphQL', target: 'techContext' },
  { match: 'redis', fact: 'Redis', target: 'techContext' },
  { match: 'pg', fact: 'PostgreSQL (via pg)', target: 'techContext' }
];

// Each returned fact line is self-documenting about its evidence (which exact dependency name
// triggered it) - a reader should never have to take the tool's word for a fact it can't trace
// back to something real in the repo. `${matched}` is deliberately the specific name that was
// actually present, not `known.match` itself, since that may be an array of aliases.
export function matchKnownFacts(dependencies: string[]): { techContext: string[]; integrations: string[] } {
  const deps = new Set(dependencies);
  const result: { techContext: string[]; integrations: string[] } = { techContext: [], integrations: [] };

  for (const known of KNOWN_FACTS) {
    const candidates = Array.isArray(known.match) ? known.match : [known.match];
    const matched = candidates.find((c) => deps.has(c));
    if (matched) {
      result[known.target].push(`${known.fact} — via \`${matched}\` in package.json`);
    }
  }

  return result;
}
