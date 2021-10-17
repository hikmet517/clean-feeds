// TODO: add rdf support

function parseAtom(dom, feedUrl) {
  let feed = {};
  feed['entries'] = {};
  feed['checked'] = (new Date()).toJSON();
  feed['feedlink'] = feedUrl;

  feed['title'] = '';
  let titleNode = dom.querySelector('feed > title');
  if (titleNode) {
    feed['title'] = titleNode.textContent.trim();
  }

  let base = '';
  let feedNode = dom.querySelector('feed');
  if (feedNode && feedNode.getAttribute('xml:base')) {
    base = feedNode.getAttribute('xml:base').trim();
  }

  feed['link'] = '';
  let linkNode = dom.querySelector('link:not([rel]), link[rel=alternate]');
  if (linkNode && linkNode.getAttribute('href'))
    feed['link'] = linkNode.getAttribute('href').trim();
  if (!(feed['link'].startsWith('http://') && feed['link'].startsWith('http://'))) {
    feed['link'] = base + feed['link'];
  }

  feed['updated'] = new Date();
  let updatedNode = dom.querySelector('feed > updated');
  if (updatedNode)
    feed['updated'] = (new Date(updatedNode.textContent.trim())).toJSON();

  // entries
  for (let entryNode of dom.querySelectorAll('feed > entry')) {
    let entry = {};
    entry['feedlink'] = feed['feedlink'];
    entry['feedtitle'] = feed['title'];

    // entry title
    entry['title'] = '';
    let entryTitle = entryNode.querySelector('title');
    if (entryTitle)
      entry['title'] = entryTitle.textContent.trim();

    // entry link
    let entryLink = entryNode.querySelector('link:not([rel]), link[rel=alternate]');
    if (entryLink && entryLink.getAttribute('href')) {
      entry['link'] = entryLink.getAttribute('href').trim();
    }
    if (!(feed['link'].startsWith('http://') && feed['link'].startsWith('http://'))) {
      feed['link'] = base + feed['link'];
    }

    if (!entry['link'] || !entry['title']) {
      console.warn('Entry does not have a link or title:', entry);
      continue;
    }

    entry['updated'] = (new Date()).toJSON();
    let updatedNode = entryNode.querySelector('updated');
    if (updatedNode)
      entry['updated'] = (new Date(updatedNode.textContent.trim())).toJSON();

    // entry content
    entry['content'] = '';
    let contentNode = entryNode.querySelector('content, summary');
    if (contentNode)
      entry['content'] = contentNode.textContent.trim();

    feed['entries'][entry['link']] = entry;
  }
  return feed;
}

function parseRss(dom, feedUrl) {
  let feed = {};
  feed['entries'] = {};
  feed['checked'] = (new Date()).toJSON();
  feed['feedlink'] = feedUrl;

  feed['title'] = '';
  let titleNode = dom.querySelector('rss > channel > title');
  if (titleNode)
    feed['title'] = titleNode.textContent.trim();

  feed['link'] = '';
  let linkNode = dom.querySelector('rss > channel > link:not([rel]), rss > channel > link[rel=alternate]');
  if (linkNode) {
    if (linkNode.textContent.trim()) {
      feed['link'] = linkNode.textContent.trim();
    }
    else if ('href' in linkNode.attributes) {
      feed['link'] = linkNode.getAttribute('href').trim();
    }
  }

  feed['updated'] = new Date();
  let updatedNode = dom.querySelector('rss > channel > pubDate, rss > channel > updated, rss > channel > lastBuildDate');
  if (updatedNode)
    feed['updated'] = (new Date(updatedNode.textContent.trim())).toJSON();

  // entries
  for (let entryNode of dom.querySelectorAll('rss > channel > item')) {
    let entry = {};
    entry['feedlink'] = feed['feedlink'];
    entry['feedtitle'] = feed['title'];

    // entry title
    entry['title'] = '';
    let entryTitle = entryNode.querySelector('title');
    if (entryTitle)
      entry['title'] = entryTitle.textContent.trim();

    // entry link
    entry['link'] = '';
    let entryLink = entryNode.querySelector('link');
    if (entryLink)
      entry['link'] = entryLink.textContent.trim();

    if (!entry['link'] || !entry['title']) {
      console.warn('Entry does not have a link or title:', entry);
      continue;
    }

    entry['updated'] = (new Date()).toJSON();
    let updatedNode = entryNode.querySelector('pubDate, date');
    if (updatedNode)
      entry['updated'] = (new Date(updatedNode.textContent.trim())).toJSON();

    // entry content
    let entryContent = entryNode.querySelector('encoded');
    if (entryContent)
      entry['content'] = entryContent.textContent.trim();
    else {
      entryContent = entryNode.querySelector('description');
      if (entryContent)
        entry['content'] = entryContent.textContent.trim();
    }

    feed['entries'][entry['link']] = entry;
  }
  return feed;
}


/**
 * takes textual `content` and returns an object
 * @param {string} content
 * @returns {Object}
 */
function parseFeed(content, url) {
  const parser = new DOMParser();
  const dom = parser.parseFromString(content, 'application/xml');
  const error = dom.querySelector('parsererror');
  if (error) {
    console.error('Parse Error');
    return false;
  }

  let rootNode = dom.documentElement.nodeName.trim();

  let feed = {};
  feed['entries'] = {};
  feed['checked'] = (new Date()).toJSON();

  // PARSE ATOM FEED
  if (rootNode === 'feed') {
    return parseAtom(dom, url);
  }

  // PARSE RSS FEED
  else if (rootNode === 'rss') {
    return parseRss(dom, url);
  }
  else {
    console.error('unknown feed type');
    return false;
  }
}

export default parseFeed;
