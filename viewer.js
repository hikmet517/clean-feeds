// TODOs:
// auto refresh
// settings panel (refresh period)
// add rdf support
// info about feed
// show unread entries in feed elem
// relative links in content (partially done, we handle imgs)
// improve error handling, return values of async when failed
// progress label, (like refreshing...)
// const correctness


import queryFilter from './boolean-filter-module.js';
import parseFeed from './feed-parser-module.js';
import initResizer from './resizer-module.js';

var draggedElement;

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
    feed['updatePeriod'] = 60 * 60 * 1000;  // 1 hour
    for (const [_link, entry] of Object.entries(feed['entries']))
      entry['read'] = false;

    // read icon
    let success = false;
    if (feed['icon']) {
      try {
        console.log('first try', feed['icon']);
        let response = await fetch(feed['icon'], {redirect: 'error'});
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
        let response = await fetch(feed['link']);
        if (response.ok) {
          let content = await response.text();
          const parser = new DOMParser();
          const dom = parser.parseFromString(content, 'text/html');
          for (let elem of dom.getElementsByTagName('link')) {
            let att = elem.getAttribute('rel');
            if (att && att == 'icon' || att == 'shortcut icon') {
              let url = elem.getAttribute('href').trim();
              let newurl = (new URL(url, feed['link'])).href;
              console.log('second try, new url:', newurl);
              let resp = await fetch(newurl, {redirect: 'error'});
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
        let url = (new URL('/favicon.ico', feed['link'])).href;
        console.log('third try, new url', url);
        let response = await fetch(url);
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
      for (let [_url, entry] of Object.entries(feed['entries'])) {
        entry['icon'] = feed['icon'];
      }
    }
  }
  return feed;
}


function selectAllFeeds() {
  document.getElementById('all-feeds').click();
}


// add new feed
async function addFeed() {
  const url = prompt('Enter url');
  if (url && url.trim()) {
    const feed = await fetchParseFeed(url.trim(), true);

    if (!feed) {
      console.error('fetchParseFeed failed');
      return;
    }

    // save
    chrome.storage.local.get({ feeds: {} }, function(obj) {
      if (!(url in obj['feeds'])) {
        let order = 0;
        for (let feed of Object.values(obj['feeds']))
          if (feed['order'] > order)
            order = feed['order'];
        order = order + 1;
        feed['order'] = order;
        obj['feeds'][url] = feed;
        chrome.storage.local.set(obj, function() {
          fillFeedsPane();
        });
      }
    });
  }
}

document.getElementById('add-feed').addEventListener('click', addFeed);


// fill feeds pane (left pane)
// using internal data
function fillFeedsPane() {
  chrome.storage.local.get( {feeds: {}}, function(obj) {
    let tempArray = [];
    for (const [url, feed] of Object.entries(obj['feeds'])) {
      let elem = document.createElement('li');

      elem.classList.add('feed-list-elem');
      elem.setAttribute('feed-url', url);
      elem.setAttribute('order', feed['order']);
      elem.setAttribute('title', feed['title']);
      elem.addEventListener('click', fillEntryPane);

      // ==== ELEM'S DRAG FUNCTIONS BEGIN ====
      elem.setAttribute('draggable', 'true');
      elem.addEventListener("dragstart", function(event) {
        draggedElement = event.target;
        event.target.style.background = "lavender";
      });
      elem.addEventListener("dragend", function(event) {
        event.target.style.background = "";
      });
      elem.addEventListener("dragover", function(event) {
        event.preventDefault();
      });
      elem.addEventListener("drop", function(event) {
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
          chrome.storage.local.get( {feeds: {}}, function(obj) {
            let i = 1;
            for (let elem of document.getElementsByClassName('feed-list-elem')) {
              let feedUrl = elem.getAttribute('feed-url');
              elem.setAttribute('order', i);
              obj['feeds'][feedUrl]['order'] = i;
              i++;
            }
            chrome.storage.local.set(obj);
          });
        }
      });
      // ==== ELEM'S DRAG FUNCTIONS END ====

      let iconElem = document.createElement('img');
      if (feed['icon'])
        iconElem.setAttribute('src', feed['icon']);
      else
        iconElem.setAttribute('src', 'icons/16.png');
      iconElem.classList.add('favicon');
      elem.appendChild(iconElem);

      let titleElem = document.createElement('div');
      titleElem.classList.add('feed-list-elem-title');
      let content = document.createTextNode(feed['title']);
      titleElem.appendChild(content);
      elem.appendChild(titleElem);

      let menuElem = document.createElement('button');
      menuElem.classList.add('feed-list-elem-menu');
      let menuElemImg = document.createElement('img');
      menuElemImg.src = 'icons/open-menu.svg';
      menuElemImg.title = 'Open menu';
      menuElem.appendChild(menuElemImg);
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

    // if there is feeds before, get selected one
    let selectedFeedUrl = '';
    for (let elem of document.getElementsByClassName('feed-list-elem')) {
      if (elem.classList.contains('clicked')) {
        selectedFeedUrl = elem.getAttribute('feed-url');
        break;
      }
    }

    let feedsList = document.getElementById('feed-list');
    feedsList.innerHTML = '';  // clear all
    for (let elem of tempArray)
      feedsList.appendChild(elem);

    // restore selected url
    if (selectedFeedUrl !== '') {
      for (let elem of document.getElementsByClassName('feed-list-elem')) {
        if (elem.getAttribute('feed-url') === selectedFeedUrl) {
          elem.click();
          return;
        }
      }
    }
    else {
      selectAllFeeds();
    }
  });
}


function showHideFeedMenu(event) {
  const feedUrl = event.currentTarget.parentElement.getAttribute('feed-url');
  event.stopPropagation();
  let feedMenu = document.getElementById('feed-menu');
  if (('hidden' in feedMenu.attributes)) {
    feedMenu.setAttribute('feed-url', feedUrl);
    feedMenu.style.left = event.clientX + 10 + 'px';
    feedMenu.style.top = event.clientY + 10 + 'px';
    feedMenu.removeAttribute('hidden');
    const rect = feedMenu.getBoundingClientRect();
    if (rect.bottom > document.documentElement.clientHeight) {
      let clientHeight = document.documentElement.clientHeight;
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
    for (let elem of document.getElementsByClassName('feed-list-elem-menu'))
      elem.classList.remove('clicked');
  }
}
document.addEventListener('mousedown', hideFeedContextMenu);


function addTag() {
  hideFeedContextMenu();
  const feedUrl = document.getElementById('feed-menu').getAttribute('feed-url');

  // get current tags
  chrome.storage.local.get({ feeds: {} }, function(obj) {
    let savedTags = obj['feeds'][feedUrl]['tags'];
    if (!savedTags)
      savedTags = [];

    // prepare prompt
    let defaultPrompt = '';
    for (let tag of savedTags)
      defaultPrompt += tag + ' ';

    // ask
    let input = prompt('Enter tags (separated by space)', defaultPrompt);
    if (input !== null) {
      savedTags = new Set();
      for (let tag of input.trim().split(' '))
        if (tag.trim())
          savedTags.add(tag.trim());
      savedTags = new Array(...savedTags);

      // update it
      obj['feeds'][feedUrl]['tags'] = savedTags;

      // save it
      chrome.storage.local.set(obj, function() {
        fillFunctionPane();
      });
    }
  });
}

async function refreshFeed() {
  hideFeedContextMenu();
  const feedUrl = document.getElementById('feed-menu').getAttribute('feed-url');
  const newFeed = await fetchParseFeed(feedUrl, false);
  if (!newFeed) {
    console.error('fetchParseFeed failed');
    return;
  }
  chrome.storage.local.get({ feeds: {} }, function(obj) {
    obj['feeds'][feedUrl] = mergeFeeds(obj['feeds'][feedUrl], newFeed);
    chrome.storage.local.set(obj, function() {
      for(let elem of document.getElementsByClassName('feed-list-elem'))
        if (elem.getAttribute('feed-url') === feedUrl)
          elem.click();
    });
  });
}

function changeFeedTitle() {
  hideFeedContextMenu();
  const feedUrl = document.getElementById('feed-menu').getAttribute('feed-url');
  chrome.storage.local.get({ feeds: {} }, function(obj) {
    let oldTitle = obj['feeds'][feedUrl]['title'];
    let input = prompt('Enter new title', oldTitle);
    if (input && input.trim()) {
      obj['feeds'][feedUrl]['title'] = input.trim();
      for (let [_entryUrl, entry] of Object.entries(obj['feeds'][feedUrl]['entries']))
        entry['feedtitle'] = obj['feeds'][feedUrl]['title'];
      chrome.storage.local.set(obj, function() {
        fillFeedsPane();
      });
    }
  });
}

function deleteFeed() {
  hideFeedContextMenu();
  const feedUrl = document.getElementById('feed-menu').getAttribute('feed-url');
  chrome.storage.local.get({ feeds: {} }, function(obj) {
    let res = window.confirm(`Are you sure you want to delete the feed '${obj['feeds'][feedUrl]['title']}'`);
    if (res) {
      delete obj['feeds'][feedUrl];
      chrome.storage.local.set(obj, function() {
        fillFunctionPane();
        fillFeedsPane();
      });
    }
  });
}


function initFeedMenu() {
  let addItem = document.getElementById('add-tag-item');
  addItem.addEventListener('click', addTag);
  // mousedown normally closed open menus, when clicked it's also called. stop that.
  addItem.addEventListener('mousedown', function(event) {
    event.stopPropagation();
  });

  let updateItem = document.getElementById('update-feed-item');
  updateItem.addEventListener('click', refreshFeed);
  updateItem.addEventListener('mousedown', function(event) {
    event.stopPropagation();
  });

  let changeTitleItem = document.getElementById('change-title-item');
  changeTitleItem.addEventListener('click', changeFeedTitle);
  changeTitleItem.addEventListener('mousedown', function(event) {
    event.stopPropagation();
  });

  let deleteItem = document.getElementById('delete-feed-item');
  deleteItem.addEventListener('click', deleteFeed);
  deleteItem.addEventListener('mousedown', function(event) {
    event.stopPropagation();
  });
}

document.addEventListener('DOMContentLoaded', initFeedMenu);


function fillFunctionPane() {
  let listElem = document.getElementById('function-list');
  listElem.innerHTML = '';

  let allFeedsElem = document.createElement('li');
  allFeedsElem.classList.add('function-list-elem');
  allFeedsElem.setAttribute('id', 'all-feeds');
  allFeedsElem.appendChild(document.createTextNode('All Feeds'));
  allFeedsElem.addEventListener('click', fillEntryPaneAll);
  listElem.appendChild(allFeedsElem);

  let queryElem = document.createElement('li');
  queryElem.classList.add('function-list-elem');
  queryElem.setAttribute('id', 'query-feeds');
  queryElem.appendChild(document.createTextNode('Query Feeds'));
  queryElem.addEventListener('click', queryFeeds);
  listElem.appendChild(queryElem);

  let tags = new Set();
  chrome.storage.local.get({ feeds: {} }, function(obj) {
    for (const [_url, feed] of Object.entries(obj['feeds'])) {
      if (feed['tags']) {
        for (let tag of feed['tags']) {
          tags.add(tag);
        }
      }
    }
    tags = new Array(...tags).sort();
    for (let tag of tags) {
      let tagElem = document.createElement('li');
      tagElem.classList.add('function-list-elem');
      tagElem.classList.add('querytag-feeds');
      tagElem.appendChild(document.createTextNode('#' + tag));
      tagElem.addEventListener('click', fillEntryByTag);
      listElem.appendChild(tagElem);
    }
  });

  allFeedsElem.click();
}

function fillEntryByTag(event) {
  // add/remove 'clicked'
  for (let elem of document.getElementsByClassName('function-list-elem')) {
    elem.classList.remove('clicked');
  }
  for (let elem of document.getElementsByClassName('feed-list-elem')) {
    elem.classList.remove('clicked');
  }
  event.currentTarget.classList.add('clicked');

  const tag = event.currentTarget.innerText.substr(1);
  const entries = [];
  chrome.storage.local.get({ feeds: {} }, function(obj) {
    for (const [_url, feed] of Object.entries(obj['feeds'])) {
      if (feed['tags'] && feed['tags'].includes(tag)) {
        entries.push(...Object.values(feed['entries']));
      }
    }
    addEntries(entries);
    selectFirstEntry();
  });
}

function queryFeeds(event) {
  const target = event.currentTarget;
  const input = prompt("Enter query (boolean algebra using ['&', '|', '!', '(', ')'])");
  if (input && input.trim().length != 0) {
    chrome.storage.local.get({ feeds: {} }, function(obj) {
      let result = queryFilter(input, Object.values(obj['feeds']), 'tags');
      let entries = [];
      for (let feed of result) {
        entries.push(...Object.values(feed['entries']));
      }
      addEntries(entries);
      selectFirstEntry();

      // change clicked
      for (let elem of document.getElementsByClassName('function-list-elem')) {
        elem.classList.remove('clicked');
      }
      for (let elem of document.getElementsByClassName('feed-list-elem')) {
        elem.classList.remove('clicked');
      }
      target.classList.add('clicked');
    });
  }
}

document.addEventListener('DOMContentLoaded', fillFunctionPane);


function selectFirstEntry() {
  // select first entry
  const entryElems = document.getElementsByClassName('entry-list-elem');
  if (entryElems.length > 0)
    entryElems[0].click();
  document.getElementById('entry-pane').scrollTo(0, 0);
}


// add entries to entry pane
function addEntries(entries) {
  let entryList = document.getElementById('entry-list');
  entryList.innerHTML = '';  // clear

  // sort entries
  entries.sort(function(fst, snd) {
    return (new Date(snd['updated'])) - (new Date(fst['updated']));
  });

  for (const entry of entries) {
    let elem = document.createElement('li');
    elem.classList.add('entry-list-elem');
    elem.setAttribute('feed-url', entry['feedlink']);
    elem.setAttribute('entry-link', entry['link']);
    elem.addEventListener('click', fillContentPane);

    let titleElem = document.createElement('div');
    titleElem.appendChild(document.createTextNode(entry['title']));
    titleElem.classList.add('entry-list-elem-title');
    titleElem.classList.add(entry['read'] ? 'read' : 'unread');
    elem.appendChild(titleElem);

    let iconElem = document.createElement('img');
    if (entry['icon'])
      iconElem.setAttribute('src', entry['icon']);
    else
      iconElem.setAttribute('src', 'icons/16.png');
    iconElem.classList.add('favicon');
    elem.appendChild(iconElem);



    let titleDateElem = document.createElement('div');
    titleDateElem.classList.add('entry-list-elem-feed-date-cont');
    let feedElem = document.createElement('div');
    feedElem.appendChild(document.createTextNode(entry['feedtitle']));
    feedElem.classList.add('entry-list-elem-feed');
    titleDateElem.appendChild(feedElem);

    if (entry['updated']) {
      let dateElem = document.createElement('div');
      let date = new Date(entry['updated']);
      let dateStr = date.toLocaleDateString('tr-TR') + ' ' + date.toLocaleTimeString('tr-TR');
      dateElem.appendChild(document.createTextNode(dateStr));
      dateElem.classList.add('entry-list-elem-date');
      titleDateElem.appendChild(dateElem);
    }
    elem.appendChild(titleDateElem);

    entryList.appendChild(elem);
  }
}


function fillEntryPaneAll(event) {
  // add/remove 'clicked'
  for (let elem of document.getElementsByClassName('function-list-elem')) {
    elem.classList.remove('clicked');
  }
  for (let elem of document.getElementsByClassName('feed-list-elem')) {
    elem.classList.remove('clicked');
  }
  event.currentTarget.classList.add('clicked');

  chrome.storage.local.get({ feeds: {} }, function(obj) {
    let entryList = document.getElementById('entry-list');
    entryList.innerHTML = '';  // clear

    let entries = [];
    for (const [_feedUrl, feed] of Object.entries(obj['feeds'])) {
      for (const [_entryUrl, entry] of Object.entries(feed['entries'])) {
        entries.push(entry);
      }
    }
    addEntries(entries);
    selectFirstEntry();
  });
}


// when a feed (feed-list-elem) on left pane is clicked
// fill entry-pane (mid-pane)
function fillEntryPane(event) {
  let feedUrl = event.currentTarget.getAttribute('feed-url');

  // add/remove 'clicked' class
  for (let elem of document.getElementsByClassName('feed-list-elem')) {
    elem.classList.remove('clicked');
  }
  for (let elem of document.getElementsByClassName('function-list-elem')) {
    elem.classList.remove('clicked');
  }
  event.currentTarget.classList.add('clicked');

  chrome.storage.local.get({ feeds: {} }, function(obj) {
    let entries = Object.values(obj['feeds'][feedUrl]['entries']);
    addEntries(entries);
    selectFirstEntry();
  });
}

// when an entry clicked
// fill content pane
function fillContentPane(event) {
  let feedUrl = event.currentTarget.getAttribute('feed-url');
  let entryLink = event.currentTarget.getAttribute('entry-link');

  // add/remove 'clicked' class
  for(let elem of event.currentTarget.parentElement.children) {
    elem.classList.remove('clicked');
  }
  event.currentTarget.classList.add('clicked');

  chrome.storage.local.get( {feeds: {}}, function(obj) {
    let contentPane = document.getElementById('content-pane');
    contentPane.setAttribute('feed-url', feedUrl);
    contentPane.setAttribute('entry-link', entryLink);
    contentPane.innerHTML = '';  // clear old data

    // header and link
    let headerDiv = document.createElement('div');
    headerDiv.setAttribute('id', 'content-header');
    let headerElem = document.createElement('h1');
    headerElem.appendChild(document.createTextNode(obj['feeds'][feedUrl]['entries'][entryLink]['title']));
    let linkElem = document.createElement('a');
    linkElem.setAttribute('href', obj['feeds'][feedUrl]['entries'][entryLink]['link']);
    linkElem.setAttribute('target', '_blank');
    linkElem.appendChild(headerElem);
    headerDiv.appendChild(linkElem);
    contentPane.appendChild(headerDiv);

    // content
    let contentElem = document.createElement('div');
    contentElem.setAttribute('id', 'content-body');
    contentElem.innerHTML = obj['feeds'][feedUrl]['entries'][entryLink]['content'];

    // fix relative img links
    if (obj['feeds'][feedUrl]['link'] !== '') {
      for (let elem of contentElem.getElementsByTagName('img')) {
        let src = elem.getAttribute('src');
        if (src) {
          src = (new URL(src, obj['feeds'][feedUrl]['link'])).href;
          elem.setAttribute('src', src);
        }
      }
    }
    for (let elem of contentElem.getElementsByTagName('a'))
      elem.setAttribute('target', '_blank');

    for (let elem of contentElem.querySelectorAll('script, object, applet, iframe, embed'))
      elem.remove();

    contentPane.appendChild(contentElem);
    contentPane.scrollTo(0, 0);
  });
}

// init feeds pane
document.addEventListener('DOMContentLoaded', fillFeedsPane);

// set last style
document.addEventListener('DOMContentLoaded', function() {
  console.log('setting last styles');
  chrome.storage.local.get( {style: {}}, function(obj) {
    for (const [id, rule] of Object.entries(obj['style'])) {
      const elem = document.getElementById( id );
      let rulestr = JSON.stringify(rule);
      rulestr = rulestr.substr(1, rulestr.length-2);
      rulestr = rulestr.replaceAll('"', '');
      rulestr = rulestr.replaceAll(',', ';');
      console.log('id:', id, ', setting:', rulestr);
      elem['style'] = rulestr;
    }
  });
});


function clearInternalData() {
  let res = window.confirm('Are you sure you want to delete all the data?');
  if (res) {
    chrome.storage.local.clear(function() {
      location.reload();
    });
  }
}

document.getElementById('clear-data').addEventListener('click', clearInternalData);

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
  return oldFeed;
}

async function refreshFeeds() {
  chrome.storage.local.get( {feeds: {}}, async function(obj) {
    let updated = false;
    for (const [url, feed] of Object.entries(obj['feeds'])) {
      let checked = (new Date(feed['checked'])).getTime();

      // fetch and check
      if (Date.now() - checked > feed['updatePeriod']) {
        let newFeed = await fetchParseFeed(url, false);
        if (!newFeed) {
          console.error('fetchParseFeed failed:', url);
          continue;
        }

        // no new data
        if (newFeed['updated'] === feed['updated'])
          continue;

        obj['feeds'][url] = mergeFeeds(obj['feeds'][url], newFeed);
        updated = true;
      }
    }

    if (updated) {
      // save
      chrome.storage.local.set(obj, function() {
        // location.reload();
        selectAllFeeds();
      });
    }
  });
}

document.getElementById('refresh-feeds').addEventListener('click', refreshFeeds);

function markReadUnread() {
  let contentItem = document.getElementById('content-pane');
  let feedUrl = contentItem.getAttribute('feed-url');
  let entryLink = contentItem.getAttribute('entry-link');

  if ( feedUrl && entryLink) {
    chrome.storage.local.get( {feeds: {}}, function(obj) {
      let oldState = obj['feeds'][feedUrl]['entries'][entryLink]['read'];
      let newState = !oldState;

      obj['feeds'][feedUrl]['entries'][entryLink]['read'] = newState;
      chrome.storage.local.set( obj, function() {
        for ( let elem of document.getElementsByClassName('entry-list-elem') ) {
          if ( elem.getAttribute('entry-link') === entryLink ) {
            let elemTitle = elem.getElementsByClassName('entry-list-elem-title')[0];
            elemTitle.classList.add( newState ? 'read' : 'unread' );
            elemTitle.classList.remove( oldState ? 'read' : 'unread' );
            break;
          }
        }
      });
    });
  }
}
document.getElementById('mark-read').addEventListener('click', markReadUnread);


function deleteEntry() {
  let contentItem = document.getElementById('content-pane');
  let feedUrl = contentItem.getAttribute('feed-url');
  let entryLink = contentItem.getAttribute('entry-link');

  chrome.storage.local.get({ feeds: {} }, function(obj) {
    delete obj['feeds'][feedUrl]['entries'][entryLink];
    chrome.storage.local.set(obj, function() {
      if (!selectNextEntry())
        selectPreviousEntry();
      for (let elem of document.getElementsByClassName('entry-list-elem')) {
        if (elem.getAttribute('entry-link') === entryLink) {
          elem.remove();
          break;
        }
      }
    });
  });
}

document.getElementById('delete-entry').addEventListener('click', deleteEntry);


function selectPreviousEntry() {
  let entries = document.getElementsByClassName('entry-list-elem');
  let i = 0;
  for (let elem of entries) {
    if (elem.classList.contains('clicked')) {
      if (i - 1 >= 0) {
        entries[i - 1].click();
        return true;
      }
    }
    i++;
  }
  return false;
}

function selectNextEntry() {
  let entries = document.getElementsByClassName('entry-list-elem');
  let i = 0;
  for (let elem of entries) {
    if (elem.classList.contains('clicked')) {
      if (i + 1 < entries.length) {
        entries[i + 1].click();
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

  if (e.key === 'f' || e.key === 'F') {
    addFeed();
  }

  else if (e.key === 'r' || e.key === 'R') {
    refreshFeeds();
  }

  else if (e.key === 'm' || e.key === 'M') {
    markReadUnread();
  }

  else if (e.key === 'b' || e.key === 'B'
           || e.key === 'o' || e.key === 'O'
           || e.key === 'v' || e.key === 'V') {
    document.getElementById('content-header').children[0].click();
  }

  else if (e.key === 'd' || e.key === 'D' || e.key == 'Delete') {
    deleteEntry();
  }

  else if(e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    selectNextEntry();
  }

  else if(e.key === 'p' || e.key === 'P') {
    e.preventDefault();
    selectPreviousEntry();
  }

  else if (e.key === 'e' || e.key === 'E') {
    exportFeeds();
  }

  else if (e.key === 'i' || e.key === 'I' || e.key === 'İ') {
    importFeeds();
  }

}

document.addEventListener('keydown', keyHandler);


function exportFeeds() {
  chrome.storage.local.get({ feeds: {} }, function(obj) {
    const feeds = [];
    for (const [url, feed] of Object.entries(obj['feeds'])) {
      let temp = {};
      temp['title'] = feed['title'];
      temp['url'] = url;
      temp['order'] = feed['order'];
      temp['tags'] = feed['tags'] ? feed['tags'] : [];
      feeds.push(temp);
    }

    const object = {'feeds': feeds};
    const blob = new Blob([JSON.stringify(object, null, 2)], { type: 'application/json' });
    chrome.downloads.download({
      url: URL.createObjectURL(blob),
      filename: 'exported.json',
      saveAs: true
    });
  });
}


function importFeeds() {
  const inputElem = document.getElementById('input');
  inputElem.addEventListener("change", handleFiles, false);
  function handleFiles() {
    let file = this.files[0];
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
      Promise.allSettled(fetchedArray).then(function (fetchedArray) {
        chrome.storage.local.get({ feeds: {} }, function(obj) {
          let i = 0;
          for (const fetched of fetchedArray) {
            if (fetched.status === 'fulfilled' && fetched.value !== false) {
              const val = fetched.value;
              const feedUrl = val['feedlink'];
              obj['feeds'][feedUrl] = val;
              obj['feeds'][feedUrl]['title'] = data['feeds'][i]['title'];
              for (let [_entryUrl, entry] of Object.entries(obj['feeds'][feedUrl]['entries']))
                entry['feedtitle'] = obj['feeds'][feedUrl]['title'];
              obj['feeds'][feedUrl]['tags'] = data['feeds'][i]['tags'];
              obj['feeds'][feedUrl]['order'] = data['feeds'][i]['order'];
            }
            i++;
          }
          chrome.storage.local.set(obj, function() {
            fillFeedsPane();
            fillFunctionPane();
            // location.reload();
          });
        });
      });
    };
    reader.readAsText(file);
  }
  inputElem.click();
}

document.getElementById('import-feeds').addEventListener('click', importFeeds);
document.getElementById('export-feeds').addEventListener('click', exportFeeds);
