function lstrip(str, s) {
  if (s && s !== "") {
    while (str.startsWith(s)) {
      str = str.substring(s.length);
    }
  }
  return str;
}

function rstrip(str, s) {
  if (s && s !== "") {
    while (str.endsWith(s)) {
      return str.substring(0, str.length - s.length);
    }
  }
  return str;
}

function createIdFromUrl(url) {
  const u = new URL(url);
  let base = lstrip(u.hostname, "www.") + u.pathname;
  for (const [key, val] of u.searchParams) {
    base += "-" + key + "-" + val;
  }
  base = base.replaceAll(".", "-");
  base = base.replaceAll("/", "-");
  base = base.replaceAll(":", "-");
  base = base.replaceAll("?", "-");
  base = base.replaceAll("&", "-");
  base = base.replaceAll("#", "-");
  base = base.replaceAll("--", "-");
  base = lstrip(base, "-");
  base = rstrip(base, "-");
  base = encodeURIComponent(base);
  return base;
}

function resolveUrl(baseUrl, relativeUrl) {
  return new URL(relativeUrl, baseUrl).href;
}

export { lstrip, rstrip, createIdFromUrl, resolveUrl };
