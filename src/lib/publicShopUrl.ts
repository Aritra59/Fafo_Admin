/** Build buyer-facing shop URL from global settings template and shop code. */
export function buildPublicShopUrl(template: string | undefined, shopCode: string | undefined): string | null {
  const t = (template ?? "").trim();
  const code = (shopCode ?? "").trim();
  if (!t || !code) return null;
  if (t.includes("{shopCode}")) return t.split("{shopCode}").join(encodeURIComponent(code));
  const join = t.endsWith("/") ? "" : "/";
  return `${t}${join}${encodeURIComponent(code)}`;
}
