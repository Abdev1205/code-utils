/**
 * Portability placeholders.
 *
 * A shared track shouldn't hard-code one person's cluster. Writing
 * `{{env:AWS_ACCOUNT_ID}}` lets the same document render against whoever's
 * reading it: the value is substituted from the environment, and when it isn't
 * set the placeholder stays visible so nobody mistakes a template for a fact.
 *
 * A fallback after `|` — `{{env:TELEPHONY_CUSTOMER|the customer}}` — is what
 * readers without the variable see, so a shared document reads as prose
 * ("inside the customer's VPC") rather than as a form with blanks. Without a
 * fallback the placeholder stays visible as ⟨NAME⟩, so nobody mistakes a
 * template for a fact.
 *
 * The `{{env:…}}` form is deliberate — bare `${VAR}` collides with shell and JS
 * inside code blocks, and `{{ VAR }}` collides with Helm and Jinja templates,
 * both of which appear in real infrastructure docs.
 */
const PLACEHOLDER = /\{\{env:([A-Z_][A-Z0-9_]*)(?:\|([^}]*))?\}\}/g;

/** Rendered for a placeholder with nothing behind it and no fallback. */
function unresolved(name: string): string {
  return `⟨${name}⟩`;
}

export function resolvePlaceholders(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!text.includes("{{env:")) return text;
  return text.replace(
    PLACEHOLDER,
    (_match, name: string, fallback: string | undefined) => {
      const value = env[name];
      if (value && value.trim()) return value;
      return fallback !== undefined ? fallback : unresolved(name);
    },
  );
}

/** Every variable a document asks for, whether or not it is set. */
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))].sort();
}

/** Which of them the current environment can actually fill in. */
export function placeholderStatus(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
): { name: string; resolved: boolean }[] {
  return placeholdersIn(text).map((name) => ({
    name,
    resolved: Boolean(env[name] && env[name]!.trim()),
  }));
}
