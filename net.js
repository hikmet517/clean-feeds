import parseFeed from "./feed-parser.js";

AbortSignal.timeout ??= function timeout(ms) {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
};

async function fetchParseFeed(url) {
  let feed = {};

  // fetch and parse
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      console.error(
        `fetchParseFeed, fetch failed, url: ${url}, response: ${response}`,
      );
      return null;
    }

    const content = await response.text();
    feed = parseFeed(content, url);
  } catch (error) {
    throw error;
  }

  // if icon is missing try to fetch page and extract icon's url
  if (!feed["icon"]) {
    if (feed["link"]) {
      feed["icon"] =
        `https://www.google.com/s2/favicons?domain=${new URL(feed["link"]).hostname}`;
      for (const entry of Object.values(feed["entries"])) {
        entry["icon"] = feed["icon"];
      }
    }
  }

  return feed;
}

export { fetchParseFeed };
