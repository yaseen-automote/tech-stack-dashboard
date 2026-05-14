import {
  isValidTechStackTarget,
  normalizeTechStackTarget,
} from "@/lib/tech-stack/normalize";

describe("normalizeTechStackTarget", () => {
  it("accepts a bare domain and normalizes it to https", () => {
    expect(normalizeTechStackTarget("stripe.com")).toEqual({
      rawInput: "stripe.com",
      canonicalHostname: "stripe.com",
      normalizedUrl: "https://stripe.com",
      displayTarget: "stripe.com",
    });
  });

  it("accepts a full URL and preserves its origin hostname", () => {
    expect(normalizeTechStackTarget("https://www.shopify.com/pricing?x=1")).toEqual({
      rawInput: "https://www.shopify.com/pricing?x=1",
      canonicalHostname: "www.shopify.com",
      normalizedUrl: "https://www.shopify.com",
      displayTarget: "www.shopify.com",
    });
  });
});

describe("isValidTechStackTarget", () => {
  it("accepts valid domains and URLs", () => {
    expect(isValidTechStackTarget("vercel.com")).toBe(true);
    expect(isValidTechStackTarget("https://vercel.com")).toBe(true);
  });

  it("rejects invalid targets", () => {
    expect(isValidTechStackTarget("not a target")).toBe(false);
    expect(isValidTechStackTarget("ftp://example.com")).toBe(false);
  });
});
