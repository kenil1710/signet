# The site on Cloudflare Pages (free), at signetguard.xyz

What is served: `packages/dashboard/dist`, the mainnet build (landing page `/`, dashboard and `/prove` at
`/app.html#/…`). It's static, with no server or keys. The browser reads the chain from xlayerrpc.okx.com and
xlayer.drpc.org. Headers (CSP, caching) are in `packages/dashboard/public/_headers`.

## Build and deploy

```bash
cd packages/dashboard
rm -rf dist && SIGNET_NETWORK=mainnet npx vite build
npx wrangler@4 login                                    # once; opens the browser
npx wrangler@4 pages project create signet --production-branch main   # once
npx wrangler@4 pages deploy dist --project-name signet --branch main --commit-dirty=true
```

The deploy prints a `https://<hash>.signet-XXX.pages.dev` URL; the production alias is `https://signet-XXX.pages.dev`
(Cloudflare picks the exact subdomain).

## Connect signetguard.xyz (bought on GoDaddy)

Cloudflare Pages can serve an **apex** domain (`signetguard.xyz` without `www`) only when the domain's DNS is on
Cloudflare. So the domain moves its **nameservers** to Cloudflare: still free, and it stays registered at GoDaddy.

### A. Add the domain to Cloudflare (free plan)

1. Cloudflare dashboard → **Add a domain** (or "Add site"). Enter `signetguard.xyz` and choose **Quick scan for DNS
   records**.
2. Pick the **Free** plan.
3. Review the DNS records it found. If GoDaddy's parking records show up (an `A` record for `@` pointing at a
   GoDaddy parking IP, or a `CNAME` for `www` to `…godaddysites.com`), **delete them**: Pages adds its own. Keep any
   `MX`/`TXT` records you use for email.
4. Cloudflare then shows **two nameservers**, like `xxx.ns.cloudflare.com` and `yyy.ns.cloudflare.com`. Copy both
   exactly; they're specific to your account.

### B. Change the nameservers on GoDaddy

1. Sign in at **godaddy.com** → profile menu → **My Products** → **Domains**. Click `signetguard.xyz`. This opens
   **Domain Settings** (Domain Portfolio).
2. Open the **DNS** tab, then **Nameservers** → **Change Nameservers**.
3. Choose **I'll use my own nameservers** (sometimes "Enter my own nameservers (advanced)").
4. Replace the GoDaddy entries (`nsXX.domaincontrol.com`) with the **two Cloudflare nameservers** from A4. Delete any
   extra rows so exactly those two remain.
5. **Save**, then confirm the warning ("your DNS records will no longer be managed by GoDaddy"). If GoDaddy asks
   to turn off **DNSSEC** first, turn it off; you can turn it on again later in Cloudflare.
6. Back in Cloudflare, click **Check nameservers now**. The change usually shows up within minutes to a few hours
   (up to 24–48 h). Cloudflare emails you when the domain is **Active**.

### C. Attach the domain to the Pages project

1. Cloudflare dashboard → **Workers & Pages** → the **signet** project → **Custom domains** → **Set up a custom
   domain**.
2. Enter `signetguard.xyz` → **Continue** → **Activate domain**. Cloudflare creates the DNS record (a `CNAME`
   `signetguard.xyz` → `signet-XXX.pages.dev`, proxied) and issues the HTTPS certificate. Status goes from
   *Initializing* to **Active**, usually within a few minutes once the zone is active.
3. Optional: repeat with `www.signetguard.xyz`. Then add a redirect from `www` to the apex (**Rules → Redirect
   Rules**, "Redirect from WWW to root" template).
4. Recommended: **SSL/TLS → Edge Certificates → Always Use HTTPS: On**.

### D. Check

```bash
dig +short NS signetguard.xyz            # the two *.ns.cloudflare.com names
curl -sI https://signetguard.xyz | head -5    # HTTP/2 200, with the content-security-policy header
```

Then open `https://signetguard.xyz/` and `https://signetguard.xyz/app.html#/prove`. /prove should end with
"All checks passed (0 pending deployment)".
