// A sealed domain as ONE DNS label, for the gateway's per-project subdomain (a wildcard certificate covers one
// level only; TapeKit's gateway does the same with "<id>-<cpu>").  app.example.org <-> app-example-org
//   "."  ->  "-"        "-"  ->  "--"
// It decodes without ambiguity because a domain label never starts or ends with "-": a single dash is always a
// dot, and a run of 2k dashes is always k hyphens.
export function encodeLabel(domain: string): string | null {
  const label = domain.replace(/-/g, '--').replace(/\./g, '-');
  return label.length <= 63 && /^[a-z0-9-]+$/.test(label) ? label : null; // longer than a DNS label: no gateway address
}

export function decodeLabel(label: string): string | null {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) return null;
  let bad = false;
  const domain = label.replace(/-+/g, (run) => {
    if (run.length === 1) return '.';
    if (run.length % 2) bad = true; // "---": a dot next to a hyphen can't happen in a valid domain
    return '-'.repeat(run.length / 2);
  });
  return !bad && domain.includes('.') ? domain : null;
}

/// The project a gateway host shows: "app-example-org.gateway.tld" -> "app.example.org". Null: not a gateway host.
export function domainOfGatewayHost(host: string, gatewayHost: string): string | null {
  const h = host.toLowerCase();
  const g = gatewayHost.toLowerCase();
  if (!h.endsWith(`.${g}`)) return null;
  const label = h.slice(0, -g.length - 1);
  return label.includes('.') ? null : decodeLabel(label);
}
