const testVariations = async () => {
  // Test 1: GET with domain param
  let r = await fetch("https://ip.thc.org/api/v1/lookup/cnames?domain=github.com");
  console.log("GET ?domain:", await r.text());

  // Test 2: GET with url param
  r = await fetch("https://ip.thc.org/api/v1/lookup/cnames?url=github.com");
  console.log("GET ?url:", await r.text());

  // Test 3: POST with domain
  r = await fetch("https://ip.thc.org/api/v1/lookup/cnames", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain: "github.com" })
  });
  console.log("POST {domain}:", await r.text());
};
testVariations();
