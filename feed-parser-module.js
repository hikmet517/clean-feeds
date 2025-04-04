// TODO: add rdf support

function parseAtom(dom, feedUrl) {
  const feed = {};
  feed['checked'] = (new Date()).toJSON(); // last time it's fetched
  feed['feedlink'] = feedUrl;

  const titleNode = dom.querySelector('feed > title');
  if (titleNode) {
    feed['title'] = titleNode.textContent.trim();
  }

  let base = '';
  const feedNode = dom.querySelector('feed');
  if (feedNode && feedNode.getAttribute('xml:base')) {
    base = feedNode.getAttribute('xml:base').trim();
  }

  const linkNode = dom.querySelector('link:not([rel]), link[rel=alternate]');
  if (linkNode && linkNode.getAttribute('href'))
    feed['link'] = linkNode.getAttribute('href').trim();
  if ( !(feed['link'].startsWith('http://') || feed['link'].startsWith('https://'))) {
    feed['link'] = base + feed['link'];
  }
  if ( !(feed['link'].startsWith('http://') || feed['link'].startsWith('https://'))) {
    feed['link'] = (new URL(feedUrl)).origin;
  }

  const iconNode = dom.querySelector('icon');
  if (iconNode && iconNode.textContent.trim()) {
    feed['icon'] = iconNode.textContent.trim();
  }

  feed['updated'] = new Date();
  const updatedNode = dom.querySelector('feed > updated');
  if (updatedNode)
    feed['updated'] = (new Date(updatedNode.textContent.trim())).toJSON();

  // entries
  const entries = [];
  for (const entryNode of dom.querySelectorAll('feed > entry')) {
    const entry = {};
    entry['feedlink'] = feed['feedlink'];
    entry['feedtitle'] = feed['title'];

    // entry title
    const entryTitle = entryNode.querySelector('title');
    if (entryTitle)
      entry['title'] = entryTitle.textContent.trim();

    // entry link
    const entryLink = entryNode.querySelector('link:not([rel]), link[rel=alternate]');
    if (entryLink && entryLink.getAttribute('href')) {
      if ( entryLink.getAttribute('href').startsWith('http://') ||
           entryLink.getAttribute('href').startsWith('https://') ) {
        entry['link'] = entryLink.getAttribute('href').trim();
      }
      else {
        entry['link'] = (new URL(entryLink.getAttribute('href'), feed['link'])).href;
      }
    }

    if (!entry['link'] || !entry['title']) {
      console.warn('Entry does not have a link or title:', entry);
      continue;
    }

    entry['updated'] = (new Date()).toJSON();
    let updatedNode = entryNode.querySelector('updated');
    if (!updatedNode)
      updatedNode = entryNode.querySelector('published');
    if (updatedNode) {
      entry['updated'] = (new Date(updatedNode.textContent.trim())).toJSON();
    }

    // entry content
    entry['content'] = '';
    let contentNode = entryNode.querySelector('content');
    if (contentNode)
      entry['content'] = contentNode.textContent.trim();

    if (entry['content'] === '') {
      contentNode = entryNode.querySelector('summary');
      if (contentNode)
        entry['content'] = contentNode.textContent.trim();
    }
    entries.push(entry);
  }
  return [feed, entries];
}

function parseRss(dom, feedUrl) {
  const feed = {};
  feed['checked'] = (new Date()).toJSON(); // last time it's fetched
  feed['feedlink'] = feedUrl;

  const titleNode = dom.querySelector('rss > channel > title');
  if (titleNode)
    feed['title'] = titleNode.textContent.trim();

  const linkNode = dom.querySelector('rss > channel > link:not([rel]), rss > channel > link[rel=alternate]');
  if (linkNode) {
    if (linkNode.textContent.trim()) {
      feed['link'] = linkNode.textContent.trim();
    }
    else if ('href' in linkNode.attributes) {
      feed['link'] = linkNode.getAttribute('href').trim();
    }
  }

  feed['updated'] = new Date();
  const updatedNode = dom.querySelector('rss > channel > pubDate, rss > channel > updated, rss > channel > lastBuildDate');
  if (updatedNode)
    feed['updated'] = (new Date(updatedNode.textContent.trim())).toJSON();

  // entries
  const entries = [];
  for (const entryNode of dom.querySelectorAll('rss > channel > item')) {
    const entry = {};
    entry['feedlink'] = feed['feedlink'];
    entry['feedtitle'] = feed['title'];

    // entry title
    const entryTitle = entryNode.querySelector('title');
    if (entryTitle)
      entry['title'] = entryTitle.textContent.trim();

    // entry link
    const entryLink = entryNode.querySelector('link');
    if (entryLink) {
      let link = entryLink.textContent.trim();
      if (link.length > 0 && link[0] == '/') {
        let base = new URL(feed['feedlink']);
        base.pathname = link;
        link = base.href;
      }
      entry['link'] = link;
    }

    if (!entry['link'] || !entry['title']) {
      console.warn('Entry does not have a link or title:', entry);
      continue;
    }

    entry['updated'] = (new Date()).toJSON();
    const updatedNode = entryNode.querySelector('pubDate, date');
    if (updatedNode)
      entry['updated'] = (new Date(updatedNode.textContent.trim())).toJSON();

    // entry content
    entry['content'] = '';
    let entryContent = entryNode.querySelector('encoded');
    if (entryContent)
      entry['content'] = entryContent.textContent.trim();
    if (entry['content'] === '') {
      entryContent = entryNode.querySelector('description');
      if (entryContent)
        entry['content'] = entryContent.textContent.trim();
    }

    entries.push(entry);
  }
  return [feed, entries];
}

function parseRdf(dom, feedUrl) {
  const feed = {};
  feed['checked'] = (new Date()).toJSON(); // last time it's fetched
  feed['feedlink'] = feedUrl;

  const titleNode = dom.querySelector('RDF > channel > title');
  if (titleNode)
    feed['title'] = titleNode.textContent.trim();

  const linkNode = dom.querySelector('RDF > channel > link');
  if (linkNode) {
    feed['link'] = linkNode.textContent.trim();
  }

  feed['updated'] = new Date();

  const entries = [];
  for (const entryNode of dom.querySelectorAll('RDF > item')) {
    const entry = {};
    entry['feedlink'] = feed['feedlink'];
    entry['feedtitle'] = feed['title'];

    // entry title
    const entryTitle = entryNode.querySelector('title');
    if (entryTitle)
      entry['title'] = entryTitle.textContent.trim();

    // entry link
    const entryLink = entryNode.querySelector('link');
    if (entryLink)
      entry['link'] = entryLink.textContent.trim();

    if (!entry['link'] || !entry['title']) {
      console.warn('Entry does not have a link or title:', entry);
      continue;
    }

    entry['updated'] = (new Date()).toJSON();
    const updatedNode = entryNode.querySelector('date');
    if (updatedNode)
      entry['updated'] = (new Date(updatedNode.textContent.trim())).toJSON();

    const contentNode = entryNode.querySelector('description');
    if (contentNode)
      entry['content'] = contentNode.textContent.trim();

    entries.push(entry);
  }
  return [feed, entries];
}


/**
 * takes textual `content` and returns an object
 * @param {string} content
 * @returns {Object}
 */
function parseFeed(content, url) {
  try {
    const parser = new DOMParser();
    const dom = parser.parseFromString(content, 'application/xml');
    const error = dom.querySelector('parsererror');
    if (error) {
      console.error('parseFeed parse error');
      return false;
    }

    const rootNode = dom.documentElement.nodeName.trim();

    // PARSE ATOM FEED
    if (rootNode === 'feed') {
      return parseAtom(dom, url);
    }

    // PARSE RSS FEED
    else if (rootNode === 'rss') {
      return parseRss(dom, url);
    }

    else if (rootNode === 'rdf:RDF') {
      return parseRdf(dom, url);
    }

    else {
      console.error('parseFeed, unknown feed type');
      return false;
    }
  }
  catch (error) {
    console.error('parseFeed, catched:', error);
  }

}

export default parseFeed;
