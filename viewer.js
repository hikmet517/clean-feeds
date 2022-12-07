// TODOs:
// settings panel (refresh period)
// add rdf support
// show unread entries in feed elem
// improve error handling, return values of async when failed
// const correctness
// regex based auto-filtering, (delete automatically if matches)
// favorited entries (always keep these, do not automatically delete)
// check: http://www.getfavicon.org/
// better favicon handling: https://dev.to/derlin/get-favicons-from-any-website-using-a-hidden-google-api-3p1e

import queryFilter from './boolean-filter-module.js';
import parseFeed from './feed-parser-module.js';
import initResizer from './resizer-module.js';

var draggedElement;  // for dragging feed elem
var objCache;      // cache of feed data

var lastQuery = "";

const TITLE = 'Clean Feeds';
const NUMENTRIES = 40;

initResizer(function(prevSibling) {
  // save settings
  chrome.storage.local.get({ style: {} }, function(obj) {
    obj['style'][prevSibling['id']] = {
      height: prevSibling.style.height,
      width: prevSibling.style.width
    };
    chrome.storage.local.set(obj);
  });
});


// utility functions
function lstrip(str, s) {
  if(s && s !== "") {
    while (str.startsWith(s)) {
      str = str.substring(s.length);
    }
  }
  return str;
}

function rstrip(str, s) {
  if(s && s !== "") {
    while (str.endsWith(s)) {
      return str.substring(0, str.length - s.length);
    }
  }
  return str;
}

function createId(url) {
  const u = new URL(url);
  let base = lstrip(u.hostname, "www.") + u.pathname;
  for (const [key, val] of u.searchParams) {
    base += key + '-' + val;
  }
  base = base.replaceAll('.', '-');
  base = base.replaceAll('/', '-');
  base = base.replaceAll(':', '-');
  base = base.replaceAll('?', '-');
  base = base.replaceAll('&', '-');
  base = base.replaceAll('#', '-');
  base = base.replaceAll('--', '-');
  base = lstrip(base, '-');
  base = rstrip(base, '-');
  base = encodeURIComponent(base);
  return base;
}

async function fetchParseFeed(url, init) {
  console.log('fetching:', url);

  let feed;
  let entries;
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      referrerPolicy: 'no-referrer'
    });

    if (!response.ok) {
      console.error('fetchParseFeed, fetch failed, response:', response);
      return false;
    }

    const content = await response.text();
    [feed, entries] = parseFeed(content, url);
    feed['id'] = createId(url);

    if (!feed) {
      console.error('fetchParseFeed, parseFeed returned false:', url);
      return false;
    }
  }
  catch (error) {
    console.error('fetchParseFeed catched:', error);
    return false;
  }

  // bind entries to feed
  feed['entries'] = {};
  for (const entry of entries) {
    entry['feedid'] = feed['id'];
    const entryId = createId(entry['link']);
    entry['id'] = entryId;
    feed['entries'][entryId] = entry;
  }


  // initialize other data
  if (init) {
    feed['numEntries'] = NUMENTRIES;
    for (const entry of entries) {
      entry['read'] = false;
    }

    // read icon
    let success = false;
    if (feed['icon']) {
      try {
        console.log('first try', feed['icon']);
        const response = await fetch(feed['icon'], {redirect: 'error'});
        if (response.ok) {
          success = true;
        }
      }
      catch {
        console.log('first try failed');
        delete feed['icon'];
      }
    }
    if (!success && feed['link']) {
      try {
        console.log('second try');
        const response = await fetch(feed['link']);
        if (response.ok) {
          const content = await response.text();
          const parser = new DOMParser();
          const dom = parser.parseFromString(content, 'text/html');
          for (const elem of dom.getElementsByTagName('link')) {
            const att = elem.getAttribute('rel');
            if (att && att == 'icon' || att == 'shortcut icon') {
              const url = elem.getAttribute('href').trim();
              const newurl = (new URL(url, feed['link'])).href;
              console.log('second try, new url:', newurl);
              const resp = await fetch(newurl, {redirect: 'error'});
              if (resp.ok) {
                feed['icon'] = newurl;
                success = true;
              }
            }
          }
        }
      }
      catch {
        console.log('second try failed');
      }
    }
    if (!success) {
      try {
        console.log('third try');
        const url = (new URL('/favicon.ico', feed['link'])).href;
        console.log('third try, new url', url);
        const response = await fetch(url);
        if (response.ok) {
          feed['icon'] = url;
          success = true;
        }
      }
      catch {
        console.log('third try failed');
      }
    }
    if (feed['icon']) {
      for (const [_url, entry] of Object.entries(feed['entries'])) {
        entry['icon'] = feed['icon'];
      }
    }
  }
  return feed;
}


// add new feed, initiated by either clicking the button or pressing 'e'
async function addFeed() {
  let url = prompt('Enter url');
  if (url) {
    url = url.trim();
    const feed = await fetchParseFeed(url, true);

    if (!feed) {
      console.error('fetchParseFeed failed');
      return;
    }

    // save
    if (!(url in objCache['feeds'])) {
      // find order (max(order) + 1)
      let order = 0;
      for (const feed of Object.values(objCache['feeds']))
        if (feed['order'] > order)
          order = feed['order'];
      order = order + 1;
      feed['order'] = order;

      objCache['feeds'][feed['id']] = feed;
      chrome.storage.local.set(objCache, function() {
        fillFeedPane();
      });
    }
    else {
      window.alert(`url (${url}) is already added as ${objCache['feeds'][url]}`);
    }
  }
}


function feedListElemDragStart(event) {
  draggedElement = event.target;
  event.target.style.background = "lavender";
}
function feedListElemDragEnd(event) {
  event.target.style.background = "";
}
function feedListElemDragOver(event) {
  event.preventDefault();
}
function feedListElemDrop(event) {
  event.preventDefault();
  let target = null;
  if (event.target.classList.contains("feed-list-elem"))
    target = event.target;
  else if (event.target.parentElement.classList.contains("feed-list-elem"))
    target = event.target.parentElement;

  if (target && target != draggedElement) {
    draggedElement.parentNode.removeChild(draggedElement);
    target.parentElement.insertBefore(draggedElement, target);
    // save feeds' orders into storage
    let i = 1;
    for (const elem of document.getElementsByClassName('feed-list-elem')) {
      const feedUrl = elem.getAttribute('id');
      elem.setAttribute('order', i);
      objCache['feeds'][feedUrl]['order'] = i;
      i++;
    }
    chrome.storage.local.set(objCache);
  }
}


// fill feed pane (left pane), using cached data
function fillFeedPane() {
  console.log('fillFeedPane');
  const tempArray = [];
  for (const [feedId, feed] of Object.entries(objCache['feeds'])) {
    const elem = document.createElement('li');

    elem.classList.add('feed-list-elem');
    elem.setAttribute('id', feedId);
    elem.setAttribute('order', feed['order']);
    elem.setAttribute('title', feed['title']);
    elem.addEventListener('click', () => {
      const url = new URL(window.location.origin + window.location.pathname);
      url.searchParams.set('feed', feedId);
      window.history.pushState({}, '', url);
      fillEntryPaneByFeed(feedId)
    });

    // ==== ELEM'S DRAG FUNCTIONS BEGIN ====
    elem.setAttribute('draggable', 'true');
    elem.addEventListener("dragstart", feedListElemDragStart);
    elem.addEventListener("dragend", feedListElemDragEnd);
    elem.addEventListener("dragover", feedListElemDragOver);
    elem.addEventListener("drop", feedListElemDrop);
    // ==== ELEM'S DRAG FUNCTIONS END ====

    const iconElem = document.createElement('img');
    if (feed['icon'])
      iconElem.setAttribute('src', feed['icon']);
    else
      iconElem.setAttribute('src', 'icons/16.png');
    iconElem.classList.add('favicon');
    elem.appendChild(iconElem);

    const titleElem = document.createElement('div');
    titleElem.classList.add('feed-list-elem-title');
    const content = document.createTextNode(feed['title']);
    titleElem.appendChild(content);
    elem.appendChild(titleElem);

    const menuElem = document.createElement('button');
    menuElem.classList.add('feed-list-elem-menu');
    let im = document.createElement('i');
    im.setAttribute('class', 'fa fa-ellipsis-v');
    menuElem.appendChild(im);
    menuElem.addEventListener('click', showHideFeedMenu);
    menuElem.addEventListener('mousedown', function(event) {
      event.stopPropagation();
    });
    elem.appendChild(menuElem);

    tempArray.push(elem);
  }

  // sort and create elements
  tempArray.sort(function(fst, snd) {
    return fst.getAttribute('order') - snd.getAttribute('order');
  });

  const feedsList = document.getElementById('feed-list');
  feedsList.innerHTML = '';  // clear all
  for (const elem of tempArray)
    feedsList.appendChild(elem);
}

function showHideFeedMenu(event) {
  const feedId = event.currentTarget.parentElement.getAttribute('id');
  event.stopPropagation();
  const feedMenu = document.getElementById('feed-menu');
  if (('hidden' in feedMenu.attributes)) {
    feedMenu.setAttribute('feed-id', feedId);
    feedMenu.style.left = event.clientX + 10 + 'px';
    feedMenu.style.top = event.clientY + 10 + 'px';
    feedMenu.removeAttribute('hidden');
    const rect = feedMenu.getBoundingClientRect();
    if (rect.bottom > document.documentElement.clientHeight) {
      const clientHeight = document.documentElement.clientHeight;
      feedMenu.style.top = (clientHeight - feedMenu.scrollHeight - 10) + 'px';
    }
    event.currentTarget.classList.add('clicked');
    initFeedMenu();
  }
  else {
    hideFeedContextMenu();
  }
}

function hideFeedContextMenu() {
  const feedMenu = document.getElementById('feed-menu');
  if (!('hidden' in feedMenu.attributes)) {
    feedMenu.setAttribute('hidden', 'true');
    for (const elem of document.getElementsByClassName('feed-list-elem-menu'))
      elem.classList.remove('clicked');
  }
}

function addTag() {
  hideFeedContextMenu();
  const feedUrl = document.getElementById('feed-menu').getAttribute('feed-id');

  let savedTags = objCache['feeds'][feedUrl]['tags'];
  if (!savedTags)
    savedTags = [];

  // prepare prompt
  const defaultPrompt = savedTags.join(' ');

  // ask
  const input = prompt('Enter tags (separated by space)', defaultPrompt);
  if (input) {
    savedTags = new Set();
    for (let tag of input.trim().split(' ')) {
      tag = lstrip(tag, '#').trim();
      if (tag)
        savedTags.add(tag);
    }
    savedTags = new Array(...savedTags);

    // update it
    objCache['feeds'][feedUrl]['tags'] = savedTags;

    // save it
    chrome.storage.local.set(objCache, function() {
      fillFunctionPane();
    });
  }
}

async function refreshFeed() {
  hideFeedContextMenu();
  const feedId = document.getElementById('feed-menu').getAttribute('feed-id');
  const newFeed = await fetchParseFeed(objCache['feeds'][feedId]['feedLink'], false);
  if (!newFeed) {
    console.error('fetchParseFeed failed');
    return;
  }
  objCache['feeds'][feedId] = mergeFeeds(objCache['feeds'][feedId], newFeed);
  chrome.storage.local.set(objCache, function() {
  });
}

function changeFeedTitle() {
  hideFeedContextMenu();
  const feedId = document.getElementById('feed-menu').getAttribute('feed-id');
  const oldTitle = objCache['feeds'][feedId]['title'];
  const input = prompt('Enter new title', oldTitle);
  if (input && input.trim()) {
    objCache['feeds'][feedId]['title'] = input.trim();
    for (const [_entryUrl, entry] of Object.entries(objCache['feeds'][feedId]['entries']))
      entry['feedtitle'] = objCache['feeds'][feedId]['title'];
    chrome.storage.local.set(objCache, function() {
      fillFeedPane();
    });
  }
}

function changeNumEntries() {
  hideFeedContextMenu();
  const feedId = document.getElementById('feed-menu').getAttribute('feed-id');
  const oldNumEntries = objCache['feeds'][feedId]['numEntries'];
  const input = prompt('Enter number of entries to keep', oldNumEntries);
  if (input && input.trim()) {
    objCache['feeds'][feedId]['numEntries'] = parseInt(input.trim());
    chrome.storage.local.set(objCache);
  }
}

function deleteFeed() {
  hideFeedContextMenu();
  const feedId = document.getElementById('feed-menu').getAttribute('feed-id');
  const res = window.confirm(`Are you sure you want to delete the feed '${objCache['feeds'][feedId]['title']}'`);
  if (res) {
    delete objCache['feeds'][feedId];
    chrome.storage.local.set(objCache, function() {
      fillFunctionPane();
      fillFeedPane();
    });
  }
}

function initFeedMenu() {
  const addItem = document.getElementById('add-tag-item');
  addItem.addEventListener('click', addTag);
  // mousedown normally closed open menus, when clicked it's also called. stop that.
  addItem.addEventListener('mousedown', function(event) {
    event.stopPropagation();
  });

  const updateItem = document.getElementById('update-feed-item');
  updateItem.addEventListener('click', refreshFeed);
  updateItem.addEventListener('mousedown', function(event) {
    event.stopPropagation();
  });

  const changeTitleItem = document.getElementById('change-title-item');
  changeTitleItem.addEventListener('click', changeFeedTitle);
  changeTitleItem.addEventListener('mousedown', function(event) {
    event.stopPropagation();
  });

  const changeNumEntriesItem = document.getElementById('change-numentries-item');
  changeNumEntriesItem.addEventListener('click', changeNumEntries);
  changeNumEntriesItem.addEventListener('mousedown', function(event) {
    event.stopPropagation();
  });

  const deleteItem = document.getElementById('delete-feed-item');
  deleteItem.addEventListener('click', deleteFeed);
  deleteItem.addEventListener('mousedown', function(event) {
    event.stopPropagation();
  });

  const deleteOldItem = document.getElementById('delete-old-item');
  deleteOldItem.addEventListener('click', deleteOldEntriesFeed);
  deleteOldItem.addEventListener('mousedown', function(event) {
    event.stopPropagation();
  });

  const propertiesItem = document.getElementById('properties-item');
  propertiesItem.addEventListener('click', showPropertiesFeed);
  propertiesItem.addEventListener('mousedown', function(event) {
    event.stopPropagation();
  });
}

function showPropertiesFeed() {
  hideFeedContextMenu();
  const feedId = document.getElementById('feed-menu').getAttribute('feed-id');
  document.getElementById('feed-info-title').textContent = objCache['feeds'][feedId]['title'];

  const url_elem = document.getElementById('feed-info-url').children[0];
  url_elem.textContent = feedId;
  url_elem.setAttribute('href', feedId);

  const link_elem = document.getElementById('feed-info-link').children[0];
  const link = objCache['feeds'][feedId]['link'] || '';
  link_elem.textContent = link;
  link_elem.setAttribute('href', link);

  const entryCount = Object.values(objCache['feeds'][feedId]['entries']).length;
  document.getElementById('feed-info-entries').textContent = entryCount;
  document.getElementById('feed-info-numentries').textContent = objCache['feeds'][feedId]['numEntries'];
  let tags = objCache['feeds'][feedId]['tags'];
  if(tags)
    tags = tags.join(' ');
  document.getElementById('feed-info-tags').textContent = tags;
  const feedInfoElem = document.getElementById('feed-info');
  feedInfoElem.hidden = false;
  const rect = feedInfoElem.getBoundingClientRect();
  feedInfoElem.style.left = `${(document.documentElement.clientWidth - rect.width) / 2}px`;
  feedInfoElem.style.top = `${(document.documentElement.clientHeight - rect.height) / 3}px`;
  document.getElementById('feed-info-close').addEventListener('click', () => {
    document.getElementById('feed-info').hidden = true;
  });
}

function fillFunctionPane() {
  console.log('fillFunctionPane');
  const listElem = document.getElementById('function-list');
  listElem.innerHTML = '';

  const allFeedsElem = document.createElement('li');
  allFeedsElem.classList.add('function-list-elem');
  allFeedsElem.setAttribute('id', 'all-feeds');
  allFeedsElem.appendChild(document.createTextNode('All Feeds'));
  allFeedsElem.addEventListener('click', () => {
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('all', true);
    window.history.pushState({}, '', url);
    fillEntryPaneAll();
  });
  listElem.appendChild(allFeedsElem);

  const queryElem = document.createElement('li');
  queryElem.classList.add('function-list-elem');
  queryElem.setAttribute('id', 'query-feeds');
  queryElem.appendChild(document.createTextNode('Query Feeds'));
  queryElem.addEventListener('click', queryFeeds);
  listElem.appendChild(queryElem);

  let tags = new Set();
  for (const [_url, feed] of Object.entries(objCache['feeds'])) {
    if (feed['tags']) {
      for (const tag of feed['tags']) {
        tags.add(tag);
      }
    }
  }
  tags = new Array(...tags).sort();
  for (const tag of tags) {
    const tagElem = document.createElement('li');
    tagElem.classList.add('function-list-elem');
    tagElem.classList.add('querytag-feeds');
    tagElem.appendChild(document.createTextNode('#' + tag));
    tagElem.setAttribute('id', '#' + tag);
    tagElem.addEventListener('click', () => {
      const url = new URL(window.location.origin + window.location.pathname);
      url.searchParams.set('tag', tag);
      window.history.pushState({}, '', url);
      fillEntryPaneByTag(tag);
    });
    listElem.appendChild(tagElem);
  }
}

function fillEntryPaneByTag(tag) {
  console.log('fillEntryPaneByTag');

  // add/remove 'clicked'
  for (const elem of document.getElementsByClassName('function-list-elem')) {
    elem.classList.remove('clicked');
  }
  for (const elem of document.getElementsByClassName('feed-list-elem')) {
    elem.classList.remove('clicked');
  }
  document.getElementById('#' + tag).classList.add('clicked');
  document.title = `${TITLE} (#${tag})`;

  const entries = [];
  for (const [_url, feed] of Object.entries(objCache['feeds'])) {
    if (feed['tags'] && feed['tags'].includes(tag)) {
      entries.push(...Object.values(feed['entries']));
    }
  }
  addEntries(entries);
}

function makeQuery(input) {
  if (input && input.trim().length != 0) {
    lastQuery = input;
    const result = queryFilter(input, Object.values(objCache['feeds']), 'tags');
    const entries = [];
    for (const feed of result) {
      entries.push(...Object.values(feed['entries']));
    }
    addEntries(entries);

    // change clicked
    for (const elem of document.getElementsByClassName('function-list-elem')) {
      elem.classList.remove('clicked');
    }
    for (const elem of document.getElementsByClassName('feed-list-elem')) {
      elem.classList.remove('clicked');
    }
    document.getElementById('query-feeds').classList.add('clicked');

    document.title = `${TITLE} (${input})`;

    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('query', encodeURIComponent(input));
    window.history.pushState({}, '', url);
  }
}

function queryFeeds() {
  // if lastQuery is empty try to find query from url
  if (lastQuery === '') {
    const params = new URLSearchParams(window.location.search);
    const qParam = params.get('query');
    if(qParam) {
      lastQuery = decodeURIComponent(qParam);
    }
  }

  const input = prompt("Enter query (boolean algebra using '&', '|', '!', '(', ')')", lastQuery);
  makeQuery(input);
}

// add entries to entry pane
function addEntries(entries) {
  const entryList = document.getElementById('entry-list');
  entryList.innerHTML = '';  // clear

  // sort entries
  entries.sort(function(fst, snd) {
    return (new Date(snd['updated'])) - (new Date(fst['updated']));
  });

  let entryCount = 0;
  for (const entry of entries) {
    if (entry['deleted'] === true)
      continue;

    const elem = document.createElement('li');
    elem.classList.add('entry-list-elem');
    elem.setAttribute('feed-id', entry['feedid']);
    elem.setAttribute('entry-id', entry['id']);
    elem.addEventListener('click', () => {
      const url = new URL(window.location);
      url.searchParams.set('entryId', entry['id']);
      url.searchParams.set('feedId', entry['feedid']);
      window.history.pushState({}, '', url);
      fillContentPane(entry['feedid'], entry['id']);
    });

    const titleElem = document.createElement('div');
    titleElem.appendChild(document.createTextNode(entry['title']));
    titleElem.setAttribute('title', entry['title']);
    titleElem.classList.add('entry-list-elem-title');
    titleElem.classList.add(entry['read'] ? 'read' : 'unread');
    elem.appendChild(titleElem);

    const iconElem = document.createElement('img');
    if (entry['icon'])
      iconElem.setAttribute('src', entry['icon']);
    else
      iconElem.setAttribute('src', 'icons/16.png');
    iconElem.classList.add('favicon');
    elem.appendChild(iconElem);

    const titleDateElem = document.createElement('div');
    titleDateElem.classList.add('entry-list-elem-feed-date-cont');
    const feedElem = document.createElement('div');
    feedElem.appendChild(document.createTextNode(entry['feedtitle']));
    feedElem.classList.add('entry-list-elem-feed');
    titleDateElem.appendChild(feedElem);

    if (entry['updated']) {
      const dateElem = document.createElement('div');
      const date = new Date(entry['updated']);
      const dateStr = date.toLocaleDateString('tr-TR') + ' ' + date.toLocaleTimeString('tr-TR');
      dateElem.appendChild(document.createTextNode(dateStr));
      dateElem.classList.add('entry-list-elem-date');
      titleDateElem.appendChild(dateElem);
    }
    elem.appendChild(titleDateElem);

    entryList.appendChild(elem);
    entryCount += 1;
  }
  document.getElementById('status-text').textContent = `${entryCount} entries`;
}


function fillEntryPaneAll() {
  console.log('fillEntryPaneAll');

  // add/remove 'clicked'
  for (const elem of document.getElementsByClassName('function-list-elem')) {
    elem.classList.remove('clicked');
  }
  for (const elem of document.getElementsByClassName('feed-list-elem')) {
    elem.classList.remove('clicked');
  }
  document.getElementById('all-feeds').classList.add('clicked');
  document.title = `${TITLE} (all)`;

  const entryList = document.getElementById('entry-list');
  entryList.innerHTML = '';  // clear

  const entries = [];
  for (const [_feedUrl, feed] of Object.entries(objCache['feeds'])) {
    for (const [_entryUrl, entry] of Object.entries(feed['entries'])) {
      entries.push(entry);
    }
  }
  console.log('total number of entry:', entries.length);
  addEntries(entries);
}


// when a feed (feed-list-elem) on left pane is clicked
// fill entry-pane (mid-pane)
function fillEntryPaneByFeed(feedId) {
  console.log('fillEntryPaneByFeed');

  // add/remove 'clicked' class
  for (const elem of document.getElementsByClassName('feed-list-elem')) {
    elem.classList.remove('clicked');
  }
  for (const elem of document.getElementsByClassName('function-list-elem')) {
    elem.classList.remove('clicked');
  }
  let feedElem = document.getElementById(feedId);
  if(feedElem) {
    feedElem.classList.add('clicked');
  }
  document.title = `${TITLE} (${objCache['feeds'][feedId]['title']})`;
  const entries = Object.values(objCache['feeds'][feedId]['entries']);
  addEntries(entries);
}


// when an entry clicked
// fill content pane
function fillContentPane(feedId, entryId) {
  console.log('fillContentPane');

  if ( !feedId || !entryId) {
    return;
  }

  // add/remove 'clicked' class
  for (const elem of document.getElementsByClassName('entry-list-elem')) {
    if (elem.getAttribute('feed-id') == feedId && elem.getAttribute('entry-id') == entryId) {
      elem.classList.add('clicked');
      scrollToEntry(elem);
    }
    else {
      elem.classList.remove('clicked');
    }
  }

  const contentPane = document.getElementById('content-pane');
  contentPane.setAttribute('feed-id',feedId);
  contentPane.setAttribute('entry-id', entryId);
  contentPane.innerHTML = '';  // clear old data

  // header and link
  const headerDiv = document.createElement('div');
  headerDiv.setAttribute('id', 'content-header');
  const headerElem = document.createElement('h1');
  headerElem.appendChild(document.createTextNode(objCache['feeds'][feedId]['entries'][entryId]['title']));
  const linkElem = document.createElement('a');
  linkElem.setAttribute('href', objCache['feeds'][feedId]['entries'][entryId]['link']);
  linkElem.appendChild(headerElem);
  headerDiv.appendChild(linkElem);
  contentPane.appendChild(headerDiv);

  // content
  const contentElem = document.createElement('div');
  contentElem.setAttribute('id', 'content-body');
  contentElem.innerHTML = objCache['feeds'][feedId]['entries'][entryId]['content'];

  // fix relative img, a links
  if (objCache['feeds'][feedId]['link'] !== '') {
    for (const elem of contentElem.getElementsByTagName('img')) {
      let src = elem.getAttribute('src');
      if (src) {
        src = (new URL(src, objCache['feeds'][feedId]['link'])).href;
        elem.setAttribute('src', src);
      }
    }
    for (const elem of contentElem.getElementsByTagName('a')) {
      let src = elem.getAttribute('href');
      if (src) {
        src = (new URL(src, objCache['feeds'][feedId]['link'])).href;
        elem.setAttribute('href', src);
      }
    }
  }

  // remove background element if exist (for techrights site)
  for (const elem of contentElem.getElementsByTagName('div')) {
    if (elem.style.background)
      elem.style.background = '';
  }

  // remove problematic elements
  for (const elem of contentElem.querySelectorAll('script, object, applet, iframe, embed'))
    elem.remove();

  contentPane.appendChild(contentElem);
  contentPane.scrollTo(0, 0);

  // links open in new tab
  for (const elem of contentPane.getElementsByTagName('a')) {
    elem.setAttribute('target', '_blank');
    elem.setAttribute('rel', 'noopener');
  }
}


// set last style
function setLastStyle() {
  console.log('setLastStyle');
  chrome.storage.local.get({ style: {} }, function(obj) {
    for (const [id, rule] of Object.entries(obj['style'])) {
      const elem = document.getElementById(id);
      let rulestr = JSON.stringify(rule);
      rulestr = rulestr.substr(1, rulestr.length - 2);
      rulestr = rulestr.replaceAll('"', '');
      rulestr = rulestr.replaceAll(',', ';');
      console.log('id:', id, ', setting:', rulestr);
      elem['style'] = rulestr;
    }
  });
  chrome.storage.local.get({ theme : '' }, function(obj) {
    if (obj['theme']) {
      console.log('setting theme:', obj['theme']);
      document.documentElement.setAttribute('theme', obj['theme']);
    }
    else {
      document.documentElement.setAttribute('theme', 'light');
    }
  });
}

function deleteOldEntriesFeed() {
  hideFeedContextMenu();
  const feedUrl = document.getElementById('feed-menu').getAttribute('feed-id');
  const days = parseInt(window.prompt('Delete entries older than (days)'));
  if (days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    for (const [entryUrl, entry] of Object.entries(objCache['feeds'][feedUrl]['entries'])) {
      if (new Date(entry['updated']) < d)
        delete objCache['feeds'][feedUrl]['entries'][entryUrl];
    }
    chrome.storage.local.set(objCache);
  }
}

function deleteOldEntries() {
  const days = parseInt(window.prompt('Delete entries older than (days)'));
  if (days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    for (const [url, feed] of Object.entries(objCache['feeds'])) {
      for (const [entryUrl, entry] of Object.entries(feed['entries'])) {
        if (new Date(entry['updated']) < d)
          delete objCache['feeds'][url]['entries'][entryUrl];
      }
    }
    chrome.storage.local.set(objCache);
  }
}

function clearInternalData() {
  const res = window.confirm('Are you sure you want to delete all the data?');
  if (res) {
    chrome.storage.local.clear(function() {
      location.reload();
    });
  }
}

function mergeFeeds(oldFeed, newFeed) {
  // merge entries
  for (const [id, entry] of Object.entries(newFeed['entries'])) {
    if (!(id in oldFeed['entries'])) {
      entry['icon'] = oldFeed['icon'];
      entry['feedtitle'] = oldFeed['title'];
      oldFeed['entries'][id] = entry;
    }
  }
  oldFeed['updated'] = newFeed['updated'];
  oldFeed['checked'] = (new Date()).toJSON();

  if(!oldFeed['numEntries'])
    oldFeed['numEntries'] = NUMENTRIES;

  // sort everything
  let entries = Object.values(oldFeed['entries']);
  entries.sort(function(fst, snd) {
    return (new Date(snd['updated'])) - (new Date(fst['updated']));
  });

  // keep only last `NUMENTRIES`
  oldFeed['entries'] = {};
  for (let i=0; i<NUMENTRIES && i<entries.length; i++) {
    oldFeed['entries'][entries[i]['link']] = entries[i];
  }

  return oldFeed;
}

async function refreshFeeds() {
  let statusElem = document.getElementById('status-text');
  statusElem.textContent = "Refreshing...";
  let updated = false;
  for (const [id, feed] of Object.entries(objCache['feeds'])) {
    const url = feed['feedlink'];

    // fetch and check
    const newFeed = await fetchParseFeed(url, false);
    if (!newFeed) {
      console.error('fetchParseFeed failed:', url);
      continue;
    }

    // new data exists
    if (newFeed['updated'] !== feed['updated']) {
      objCache['feeds'][id] = mergeFeeds(objCache['feeds'][id], newFeed);
      updated = true;
    }
  }

  if (updated) {
    // save
    chrome.storage.local.set(objCache);
  }

  // send notification
  chrome.notifications.create(null,
    {
      "type": "basic",
      "iconUrl": chrome.runtime.getURL("icons/icon-48.png"),
      "title": "Clean Feeds",
      "message": "Refreshing is completed"
    });
}

function switchTheme() {
  const curr = document.documentElement.getAttribute('theme');
  const next = curr === 'light' ? 'dark' : 'light';
  chrome.storage.local.get({ theme: {} }, function(obj) {
    obj['theme'] = next;
    chrome.storage.local.set(obj, function () {
      document.documentElement.setAttribute('theme', next);
    });
  });
}

function markReadUnread() {
  const contentItem = document.getElementById('content-pane');
  const feedId = contentItem.getAttribute('feed-id');
  const entryId = contentItem.getAttribute('entry-id');

  if (feedId && entryId) {
    const oldState = objCache['feeds'][feedId]['entries'][entryId]['read'];
    const newState = !oldState;

    objCache['feeds'][feedId]['entries'][entryId]['read'] = newState;
    chrome.storage.local.set(objCache, function() {
      for (const elem of document.getElementsByClassName('entry-list-elem')) {
        if (elem.getAttribute('entry-id') === entryId &&
            elem.getAttribute('feed-id') === feedId) {
              const elemTitle = elem.getElementsByClassName('entry-list-elem-title')[0];
              elemTitle.classList.add(newState ? 'read' : 'unread');
              elemTitle.classList.remove(oldState ? 'read' : 'unread');
              break;
            }
      }
    });
  }
}

function deleteEntry() {
  const contentItem = document.getElementById('content-pane');
  const feedId = contentItem.getAttribute('feed-id');
  const entryId = contentItem.getAttribute('entry-id');

  objCache['feeds'][feedId]['entries'][entryId]['deleted'] = true;
  chrome.storage.local.set(objCache, function() {
    if (!selectNextEntry())
      selectPreviousEntry();
    for (const elem of document.getElementsByClassName('entry-list-elem')) {
      if (elem.getAttribute('entry-id') === entryId &&
          elem.getAttribute('feed-id') === feedId) {
            elem.remove();
            break;
          }
    }
    const statusElem = document.getElementById('status-text');
    let entryCount = Number.parseInt(rstrip(statusElem.textContent, " entries"))
    entryCount -= 1;
    statusElem.textContent = `${entryCount} entries`;
  });
}

function scrollToEntry(elem) {
  const pane = document.getElementById('entry-pane');
  const rect = elem.getBoundingClientRect();
  const topOffset = window.innerHeight - pane.clientHeight;
  if (rect.top - 10 < topOffset) {
    elem.scrollIntoView(true);
    pane.scrollBy(0, -10);
  }
  else if (rect.bottom + 10 > window.innerHeight) {
    elem.scrollIntoView(false);
    pane.scrollBy(0, 10);
  }
}

function selectPreviousEntry() {
  const entries = document.getElementsByClassName('entry-list-elem');
  let i = 0;
  for (const elem of entries) {
    if (elem.classList.contains('clicked')) {
      if (i - 1 >= 0) {
        entries[i - 1].click();
        scrollToEntry(entries[i - 1]);
        return true;
      }
    }
    i++;
  }
  return false;
}

function selectNextEntry() {
  const entries = document.getElementsByClassName('entry-list-elem');
  let i = 0;
  for (const elem of entries) {
    if (elem.classList.contains('clicked')) {
      if (i + 1 < entries.length) {
        entries[i + 1].click();
        scrollToEntry(entries[i + 1]);
        return true;
      }
    }
    i++;
  }
  return false;
}

function keyHandler(e) {
  // if (!e.repeat)
  //   console.log(`Key "${e.key}" pressed  [event: keydown]`);
  // else
  //   console.log(`Key "${e.key}" repeating  [event: keydown]`);

  if (e.key === 'e' || e.key === 'E') {
    addFeed();
  }

  else if (e.key === 'r' || e.key === 'R') {
    refreshFeeds();
  }

  else if (e.key === 'm' || e.key === 'M') {
    markReadUnread();
  }

  else if (e.key === 'o' || e.key === 'O'
           || e.key === 'v' || e.key === 'V') {
             const link =document.getElementById('content-header').children[0].getAttribute('href');
             chrome.tabs.getCurrent(function (tab) {
               chrome.tabs.create({ url: link, openerTabId: tab.id});
             });
           }

  else if (e.key === 'b' || e.key === 'B') {
    const link =document.getElementById('content-header').children[0].getAttribute('href');
    chrome.tabs.getCurrent(function (tab) {
      chrome.tabs.create({ url: link, openerTabId: tab.id, active: false});
    });
  }

  else if (e.key === 'd' || e.key === 'D' || e.key == 'Delete') {
    deleteEntry();
  }

  else if(e.key === 'n' || e.key === 'N') {
    selectNextEntry();
  }

  else if(e.key === 'p' || e.key === 'P') {
    selectPreviousEntry();
  }

  // else if (e.key === 'e' || e.key === 'E') {
  //   exportFeeds();
  // }

  // else if (e.key === 'i' || e.key === 'I' || e.key === 'İ') {
  //   importFeeds();
  // }

}

function exportFeeds() {
  const feeds = [];
  for (const [_url, feed] of Object.entries(objCache['feeds'])) {
    const temp = {};
    temp['title'] = feed['title'];
    temp['url'] = feed['title'];
    temp['order'] = feed['order'];
    temp['tags'] = feed['tags'] ? feed['tags'] : [];
    feeds.push(temp);
  }

  const object = { 'feeds': feeds };
  const blob = new Blob([JSON.stringify(object, null, 2)], { type: 'application/json' });
  chrome.downloads.download({
    url: URL.createObjectURL(blob),
    filename: 'feeds.json',
    saveAs: true
  });
}

function exportFeedsOPML() {
  // create data object first, stripped down version of objCache
  let data = {}
  for (const feed of Object.values(objCache['feeds'])) {
    let feedData = {};
    feedData['feedlink'] = feed['feedlink'];
    feedData['link'] = feed['link'];
    feedData['title'] = feed['title'];

    if (!feed['tags'] || feed['tags'].length == 0) {
      if(!data['untagged'])
        data['untagged'] = []

      data['untagged'].push(feed);
    }
    else {
      for (const tag of feed['tags']) {
        if (!data[tag])
          data[tag] = [];

        data[tag].push(feedData);
      }
    }
  }

  // create xml data
  let doc = document.implementation.createDocument("", "", null);
  let opmlElem = doc.createElement("opml");
  opmlElem.setAttribute("version", "1.0");

  let headElem = doc.createElement("head");
  let titleElem = doc.createElement("title");
  titleElem.appendChild(doc.createTextNode("Feed Subscriptions"));
  headElem.appendChild(titleElem);
  opmlElem.appendChild(headElem);

  let bodyElem = doc.createElement("body");
  for(const [tag, feeds] of Object.entries(data)) {
    let outlineTagElem = doc.createElement("outline");
    outlineTagElem.setAttribute("title", tag);
    outlineTagElem.setAttribute("text", tag);

    for(const feed of feeds) {
      let outlineFeedElem = doc.createElement("outline");
      outlineFeedElem.setAttribute("type", "rss");
      outlineFeedElem.setAttribute("text", feed["title"]);
      outlineFeedElem.setAttribute("title", feed["title"]);
      outlineFeedElem.setAttribute("xmlUrl", feed["feedlink"]);
      outlineFeedElem.setAttribute("htmlUrl", feed["link"]);
      outlineTagElem.appendChild(outlineFeedElem);
    }

    bodyElem.appendChild(outlineTagElem);
  }

  opmlElem.appendChild(bodyElem);
  doc.appendChild(opmlElem);

  const blob = new Blob(['<?xml version="1.0"?>',
    doc.documentElement.outerHTML], { type: 'application/xml' });
  chrome.downloads.download({
    url: URL.createObjectURL(blob),
    filename: 'feeds.opml',
    saveAs: true
  });
}

function importFeeds() {
  const inputElem = document.getElementById('input');
  inputElem.addEventListener("change", handleFiles, false);
  function handleFiles() {
    let statusElem = document.getElementById('status-text');
    statusElem.textContent = "Importing...";
    const file = this.files[0];
    console.log('importing from file:', file);

    // chrome.runtime.getURL(file);
    const reader = new FileReader();
    reader.onload = function(event) {
      const content = event.target.result;
      const data = JSON.parse(content);
      const fetchedArray = [];
      for (const feed of data['feeds']) {
        const feedRes = fetchParseFeed(feed['url'], true);
        fetchedArray.push(feedRes);
      }
      Promise.allSettled(fetchedArray).then(function(fetchedArray) {
        let i = 0;
        for (const fetched of fetchedArray) {
          if (fetched.status === 'fulfilled' && fetched.value !== false) {
            const val = fetched.value;
            const feedId = val['id'];
            objCache['feeds'][feedId] = val;
            objCache['feeds'][feedId]['title'] = data['feeds'][i]['title'];
            for (const [_entryUrl, entry] of Object.entries(objCache['feeds'][feedId]['entries']))
              entry['feedtitle'] = objCache['feeds'][feedId]['title'];
            objCache['feeds'][feedId]['tags'] = data['feeds'][i]['tags'];
            objCache['feeds'][feedId]['order'] = data['feeds'][i]['order'];
          }
          i++;
        }
        chrome.storage.local.set(objCache, function() {
          statusElem.textContent = "";
          fillFunctionPane();
          fillFeedPane();
        });
      });
    };
    reader.readAsText(file);
  }
  inputElem.click();
}


function urlHandler() {
  const params = new URLSearchParams(window.location.search);
  if (window.location.search === '') {
    document.getElementById('all-feeds').click();
    return;
  }
  for (const [key, value] of params) {
    if (key === 'query') {
      makeQuery(decodeURIComponent(value));
    }
    else if (key === 'tag') {
      console.log('handler tag:', value);
      fillEntryPaneByTag(value);
    }
    else if (key === 'feed') {
      console.log('handler feed:', value);
      fillEntryPaneByFeed(value);
    }
    else if (key === 'all') {
      console.log('handler all');
      fillEntryPaneAll();
    }
  }
  const feedId = params.get('feedId');
  const entryId = params.get('entryId');
  if (feedId && entryId) {
    fillContentPane(feedId, entryId);
  }
}

function init() {
  document.addEventListener('mousedown', function () {
    hideFeedContextMenu();
  });
  document.addEventListener('DOMContentLoaded', function() {
    initFeedMenu();
    setLastStyle();
    chrome.storage.local.get({ feeds: {} }, function(obj) {
      objCache = obj;
      fillFunctionPane();
      fillFeedPane();
      urlHandler();
    });
  });

  window.addEventListener('popstate', urlHandler);

  // toolbar buttons
  document.getElementById('add-feed').addEventListener('click', addFeed);
  document.getElementById('refresh-feeds').addEventListener('click', refreshFeeds);
  document.getElementById('switch-theme').addEventListener('click', switchTheme);
  document.getElementById('import-feeds').addEventListener('click', importFeeds);
  document.getElementById('export-feeds').addEventListener('click', exportFeeds);
  document.getElementById('export-feeds-opml').addEventListener('click', exportFeedsOPML);
  document.getElementById('delete-old').addEventListener('click', deleteOldEntries);
  document.getElementById('clear-data').addEventListener('click', clearInternalData);
  document.getElementById('delete-entry').addEventListener('click', deleteEntry);
  document.getElementById('mark-read').addEventListener('click', markReadUnread);
  document.addEventListener('keydown', keyHandler);
}

init();
