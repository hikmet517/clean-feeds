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

var leftSelection;  // 'all', 'feed', 'tag', 'query'
var leftData;

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


async function fetchParseFeed(url, init) {
  console.log('fetching:', url);

  let feed;
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
	feed = parseFeed(content, url);

	if (!feed) {
	  console.error('fetchParseFeed, parseFeed returned false:', url);
	  return false;
	}
  }
  catch (error) {
	console.error('fetchParseFeed catched:', error);
	return false;
  }

  // initialize other data
  if (init) {
	feed['numEntries'] = NUMENTRIES;
	for (const [_link, entry] of Object.entries(feed['entries']))
	  entry['read'] = false;

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


// add new feed, initiated by either clicking the button or pressing 'f'
async function addFeed() {
  const url = prompt('Enter url');
  if (url && url.trim()) {
	const feed = await fetchParseFeed(url.trim(), true);

	if (!feed) {
	  console.error('fetchParseFeed failed');
	  return;
	}

	// save
	if (!(url in objCache['feeds'])) {
	  let order = 0;
	  for (const feed of Object.values(objCache['feeds']))
		if (feed['order'] > order)
		  order = feed['order'];
	  order = order + 1;
	  feed['order'] = order;
	  objCache['feeds'][url] = feed;
	  chrome.storage.local.set(objCache, function() {
		fillFeedPane();
		restoreLeft();
	  });
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
  for (const [url, feed] of Object.entries(objCache['feeds'])) {
	const elem = document.createElement('li');

	elem.classList.add('feed-list-elem');
	elem.setAttribute('id', url);
	elem.setAttribute('order', feed['order']);
	elem.setAttribute('title', feed['title']);
	elem.addEventListener('click', fillEntryPaneByFeed);

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
  const feedUrl = event.currentTarget.parentElement.getAttribute('id');
  event.stopPropagation();
  const feedMenu = document.getElementById('feed-menu');
  if (('hidden' in feedMenu.attributes)) {
	feedMenu.setAttribute('feed-url', feedUrl);
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
  const feedUrl = document.getElementById('feed-menu').getAttribute('feed-url');

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
  const feedUrl = document.getElementById('feed-menu').getAttribute('feed-url');
  const newFeed = await fetchParseFeed(feedUrl, false);
  if (!newFeed) {
	console.error('fetchParseFeed failed');
	return;
  }
  objCache['feeds'][feedUrl] = mergeFeeds(objCache['feeds'][feedUrl], newFeed);
  chrome.storage.local.set(objCache, function() {
	restoreLeft();
  });
}

function changeFeedTitle() {
  hideFeedContextMenu();
  const feedUrl = document.getElementById('feed-menu').getAttribute('feed-url');
  const oldTitle = objCache['feeds'][feedUrl]['title'];
  const input = prompt('Enter new title', oldTitle);
  if (input && input.trim()) {
	objCache['feeds'][feedUrl]['title'] = input.trim();
	for (const [_entryUrl, entry] of Object.entries(objCache['feeds'][feedUrl]['entries']))
	  entry['feedtitle'] = objCache['feeds'][feedUrl]['title'];
	chrome.storage.local.set(objCache, function() {
	  fillFeedPane();
	  restoreLeft();
	});
  }
}

function changeNumEntries() {
  hideFeedContextMenu();
  const feedUrl = document.getElementById('feed-menu').getAttribute('feed-url');
  const oldNumEntries = objCache['feeds'][feedUrl]['numEntries'];
  const input = prompt('Enter number of entries to keep', oldNumEntries);
  if (input && input.trim()) {
	objCache['feeds'][feedUrl]['numEntries'] = parseInt(input.trim());
	chrome.storage.local.set(objCache);
  }
}

function deleteFeed() {
  hideFeedContextMenu();
  const feedUrl = document.getElementById('feed-menu').getAttribute('feed-url');
  const res = window.confirm(`Are you sure you want to delete the feed '${objCache['feeds'][feedUrl]['title']}'`);
  if (res) {
	delete objCache['feeds'][feedUrl];
	chrome.storage.local.set(objCache, function() {
	  fillFunctionPane();
	  fillFeedPane();
	  restoreLeft();
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
  const feedUrl = document.getElementById('feed-menu').getAttribute('feed-url');
  document.getElementById('feed-info-title').textContent = objCache['feeds'][feedUrl]['title'];
  document.getElementById('feed-info-url').textContent = feedUrl;
  const entryCount = Object.values(objCache['feeds'][feedUrl]['entries']).length;
  document.getElementById('feed-info-entries').textContent = entryCount;
  document.getElementById('feed-info-numentries').textContent = objCache['feeds'][feedUrl]['numEntries'];
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
  allFeedsElem.addEventListener('click', fillEntryPaneAll);
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
	tagElem.addEventListener('click', fillEntryPaneByTag);
	listElem.appendChild(tagElem);
  }
}

function fillEntryPaneByTag(event) {
  console.log('fillEntryPaneByTag');

  // add/remove 'clicked'
  for (const elem of document.getElementsByClassName('function-list-elem')) {
	elem.classList.remove('clicked');
  }
  for (const elem of document.getElementsByClassName('feed-list-elem')) {
	elem.classList.remove('clicked');
  }
  event.currentTarget.classList.add('clicked');

  const tag = event.currentTarget.innerText.substr(1);
  const entries = [];
  for (const [_url, feed] of Object.entries(objCache['feeds'])) {
	if (feed['tags'] && feed['tags'].includes(tag)) {
	  entries.push(...Object.values(feed['entries']));
	}
  }
  addEntries(entries);
  restoreMid();

  leftSelection = 'tag';
  leftData = '#' + tag;
}

function makeQuery(input) {
  if (input && input.trim().length != 0) {
	const result = queryFilter(input, Object.values(objCache['feeds']), 'tags');
	const entries = [];
	for (const feed of result) {
	  entries.push(...Object.values(feed['entries']));
	}
	addEntries(entries);
	restoreMid();

	// change clicked
	for (const elem of document.getElementsByClassName('function-list-elem')) {
	  elem.classList.remove('clicked');
	}
	for (const elem of document.getElementsByClassName('feed-list-elem')) {
	  elem.classList.remove('clicked');
	}
	document.getElementById('query-feeds').classList.add('clicked');

	leftSelection = 'query';
	leftData = input;
  }
}

function queryFeeds(_event) {
  console.log('queryFeeds');
  const dflt = leftSelection === 'query' ? leftData : "";
  const input = prompt("Enter query (boolean algebra using ['&', '|', '!', '(', ')'])", dflt);
  makeQuery(input);
}


function restoreMid() {
  const entryElems = document.getElementsByClassName('entry-list-elem');
  if (entryElems.length > 0)
	entryElems[0].click();
  document.getElementById('entry-pane').scrollTo(0, 0);
}

// add entries to entry pane
function addEntries(entries) {
  const entryList = document.getElementById('entry-list');
  entryList.innerHTML = '';  // clear

  // sort entries
  entries.sort(function(fst, snd) {
	return (new Date(snd['updated'])) - (new Date(fst['updated']));
  });

  for (const entry of entries) {
	if (entry['deleted'] === true)
	  continue;

	const elem = document.createElement('li');
	elem.classList.add('entry-list-elem');
	elem.setAttribute('feed-url', entry['feedlink']);
	elem.setAttribute('entry-link', entry['link']);
	elem.addEventListener('click', fillContentPane);

	const titleElem = document.createElement('div');
	titleElem.appendChild(document.createTextNode(entry['title']));
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
  }
  document.getElementById('status-text').textContent = `${entries.length} entries`;
}


function fillEntryPaneAll(event) {
  console.log('fillEntryPaneAll');
  // add/remove 'clicked'
  for (const elem of document.getElementsByClassName('function-list-elem')) {
	elem.classList.remove('clicked');
  }
  for (const elem of document.getElementsByClassName('feed-list-elem')) {
	elem.classList.remove('clicked');
  }
  event.currentTarget.classList.add('clicked');

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
  restoreMid();

  leftSelection = 'all';
  leftData = '';
}


// when a feed (feed-list-elem) on left pane is clicked
// fill entry-pane (mid-pane)
function fillEntryPaneByFeed(event) {
  console.log('fillEntryPaneByFeed');
  const feedUrl = event.currentTarget.getAttribute('id');

  // add/remove 'clicked' class
  for (const elem of document.getElementsByClassName('feed-list-elem')) {
	elem.classList.remove('clicked');
  }
  for (const elem of document.getElementsByClassName('function-list-elem')) {
	elem.classList.remove('clicked');
  }
  event.currentTarget.classList.add('clicked');

  const entries = Object.values(objCache['feeds'][feedUrl]['entries']);
  addEntries(entries);
  restoreMid();

  leftSelection = 'feed';
  leftData = feedUrl;
}

// when an entry clicked
// fill content pane
function fillContentPane(event) {
  console.log('fillContentPane');
  const feedUrl = event.currentTarget.getAttribute('feed-url');
  const entryLink = event.currentTarget.getAttribute('entry-link');

  // add/remove 'clicked' class
  for (const elem of event.currentTarget.parentElement.children) {
	elem.classList.remove('clicked');
  }
  event.currentTarget.classList.add('clicked');

  const contentPane = document.getElementById('content-pane');
  contentPane.setAttribute('feed-url', feedUrl);
  contentPane.setAttribute('entry-link', entryLink);
  contentPane.innerHTML = '';  // clear old data

  // header and link
  const headerDiv = document.createElement('div');
  headerDiv.setAttribute('id', 'content-header');
  const headerElem = document.createElement('h1');
  headerElem.appendChild(document.createTextNode(objCache['feeds'][feedUrl]['entries'][entryLink]['title']));
  const linkElem = document.createElement('a');
  linkElem.setAttribute('href', objCache['feeds'][feedUrl]['entries'][entryLink]['link']);
  linkElem.appendChild(headerElem);
  headerDiv.appendChild(linkElem);
  contentPane.appendChild(headerDiv);

  // content
  const contentElem = document.createElement('div');
  contentElem.setAttribute('id', 'content-body');
  contentElem.innerHTML = objCache['feeds'][feedUrl]['entries'][entryLink]['content'];

  // fix relative img, a links
  if (objCache['feeds'][feedUrl]['link'] !== '') {
	for (const elem of contentElem.getElementsByTagName('img')) {
	  let src = elem.getAttribute('src');
	  if (src) {
		src = (new URL(src, objCache['feeds'][feedUrl]['link'])).href;
		elem.setAttribute('src', src);
	  }
	}
	for (const elem of contentElem.getElementsByTagName('a')) {
	  let src = elem.getAttribute('href');
	  if (src) {
		src = (new URL(src, objCache['feeds'][feedUrl]['link'])).href;
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
  const feedUrl = document.getElementById('feed-menu').getAttribute('feed-url');
  const days = parseInt(window.prompt('Delete entries older than (days)'));
  if (days) {
	const d = new Date();
	d.setDate(d.getDate() - days);
	for (const [entryUrl, entry] of Object.entries(objCache['feeds'][feedUrl]['entries'])) {
	  if (new Date(entry['updated']) < d)
		delete objCache['feeds'][feedUrl]['entries'][entryUrl];
	}
	chrome.storage.local.set(objCache, function() {
	  restoreLeft();
	});
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
	chrome.storage.local.set(objCache, function() {
	  restoreLeft();
	});
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
  for (const [url, entry] of Object.entries(newFeed['entries'])) {
	if (!(url in oldFeed['entries'])) {
	  entry['icon'] = oldFeed['icon'];
	  entry['feedtitle'] = oldFeed['title'];
	  oldFeed['entries'][url] = entry;
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
  for (const [url, feed] of Object.entries(objCache['feeds'])) {

	// fetch and check
	const newFeed = await fetchParseFeed(url, false);
	if (!newFeed) {
	  console.error('fetchParseFeed failed:', url);
	  continue;
	}

	// no new data
	if (newFeed['updated'] !== feed['updated']) {
	  objCache['feeds'][url] = mergeFeeds(objCache['feeds'][url], newFeed);
	  updated = true;
	}
  }

  if (updated) {
	// save
	chrome.storage.local.set(objCache);
  }

  restoreLeft();

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
  const feedUrl = contentItem.getAttribute('feed-url');
  const entryLink = contentItem.getAttribute('entry-link');

  if (feedUrl && entryLink) {
	const oldState = objCache['feeds'][feedUrl]['entries'][entryLink]['read'];
	const newState = !oldState;

	objCache['feeds'][feedUrl]['entries'][entryLink]['read'] = newState;
	chrome.storage.local.set(objCache, function() {
	  for (const elem of document.getElementsByClassName('entry-list-elem')) {
		if (elem.getAttribute('entry-link') === entryLink &&
			elem.getAttribute('feed-url') === feedUrl) {
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
  const feedUrl = contentItem.getAttribute('feed-url');
  const entryLink = contentItem.getAttribute('entry-link');

  objCache['feeds'][feedUrl]['entries'][entryLink]['deleted'] = true;
  chrome.storage.local.set(objCache, function() {
	if (!selectNextEntry())
	  selectPreviousEntry();
	for (const elem of document.getElementsByClassName('entry-list-elem')) {
	  if (elem.getAttribute('entry-link') === entryLink &&
		  elem.getAttribute('feed-url') === feedUrl) {
		elem.remove();
		break;
	  }
	}
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

  // else if (e.key === 'i' || e.key === 'I' || e.key === '??') {
  //   importFeeds();
  // }

}

function exportFeeds() {
  const feeds = [];
  for (const [url, feed] of Object.entries(objCache['feeds'])) {
	const temp = {};
	temp['title'] = feed['title'];
	temp['url'] = url;
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
			const feedUrl = val['feedlink'];
			objCache['feeds'][feedUrl] = val;
			objCache['feeds'][feedUrl]['title'] = data['feeds'][i]['title'];
			for (const [_entryUrl, entry] of Object.entries(objCache['feeds'][feedUrl]['entries']))
			  entry['feedtitle'] = objCache['feeds'][feedUrl]['title'];
			objCache['feeds'][feedUrl]['tags'] = data['feeds'][i]['tags'];
			objCache['feeds'][feedUrl]['order'] = data['feeds'][i]['order'];
		  }
		  i++;
		}
		chrome.storage.local.set(objCache, function() {
		  statusElem.textContent = "";
		  fillFunctionPane();
		  fillFeedPane();
		  restoreLeft();
		});
	  });
	};
	reader.readAsText(file);
  }
  inputElem.click();
}

function restoreLeft() {
  console.log('restoreLeft');
  if (!leftSelection || leftSelection === 'all') {
	leftSelection = 'all';
	document.getElementById('all-feeds').click();
  }

  else if (leftSelection === 'feed') {
	const elem = document.getElementById(leftData);
	if (elem)  // might be deleted
	  elem.click();
	else
	  document.getElementById('all-feeds').click();
  }

  else if (leftSelection === 'tag') {
	const elem = document.getElementById(leftData);
	if (elem)
	  elem.click();
	else
	  document.getElementById('all-feeds').click();
  }

  else if (leftSelection === 'query') {
	makeQuery(leftData);
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
	  restoreLeft();
	});
  });
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
