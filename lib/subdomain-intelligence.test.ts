import {
  parseSubdomainResponse,
  classifySubdomain,
  isValidDomain,
  isValidIpAddress,
} from "@/lib/subdomain-intelligence";

describe("subdomain intelligence helpers", () => {
  it("parses CLI-friendly text into deduplicated table rows", () => {
    const rawResponse = [
      ";;Subdomains For: example.com",
      ";;Entries: 4/4",
      "example.com",
      "www.example.com",
      "dev.example.com",
      "admin.example.com",
      "www.example.com",
      "",
    ].join("\n");

    expect(parseSubdomainResponse(rawResponse, "example.com")).toEqual([
      {
        id: "example.com-0",
        subdomain: "example.com",
        type: "Apex",
        status: "Primary",
      },
      {
        id: "www.example.com-1",
        subdomain: "www.example.com",
        type: "Application",
        status: "Live",
      },
      {
        id: "dev.example.com-2",
        subdomain: "dev.example.com",
        type: "Environment",
        status: "Review",
      },
      {
        id: "admin.example.com-3",
        subdomain: "admin.example.com",
        type: "Infrastructure",
        status: "Watch",
      },
    ]);
  });

  it("classifies delivery and messaging hosts with infrastructure-aware labels", () => {
    expect(classifySubdomain("cdn.example.com", "example.com")).toEqual({
      type: "Delivery",
      status: "Edge",
    });
    expect(classifySubdomain("mx.example.com", "example.com")).toEqual({
      type: "Messaging",
      status: "Service",
    });
  });

  it("validates domains before sending upstream requests", () => {
    expect(isValidDomain("example.com")).toBe(true);
    expect(isValidDomain("api.example.co.uk")).toBe(true);
    expect(isValidDomain("http://example.com")).toBe(false);
    expect(isValidDomain("localhost")).toBe(false);
  });

  it("validates IP addresses for reverse DNS lookups", () => {
    expect(isValidIpAddress("142.251.43.46")).toBe(true);
    expect(isValidIpAddress("142.251.43.46/24")).toBe(true);
    expect(isValidIpAddress("2001:4860:4860::8888")).toBe(true);
    expect(isValidIpAddress("not-an-ip")).toBe(false);
    expect(isValidIpAddress("999.1.1.1")).toBe(false);
  });
});
