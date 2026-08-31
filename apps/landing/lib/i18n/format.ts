// Dictionary entries that need a runtime value (the client-detected
// platform name) are plain `{placeholder}` templates, not closures — a
// function can't cross the server/client boundary when `dict` is passed
// into a "use client" component. This is the one substitution rule the
// templates use.
export function formatTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
