import resizer from "./resizer.js";
import { fetchParseFeed } from "./net.js";

const TITLE = "Clean Feeds";
const NUMENTRIES = 25;

var cache;
var lastQuery = "";

resizer(function (prevSibling) {
  // save settings
  chrome.storage.local.get({ style: {} }, function (obj) {
    obj["style"][prevSibling["id"]] = {
      height: prevSibling.style.height,
      width: prevSibling.style.width,
    };
    chrome.storage.local.set(obj);
  });
});

// add entries to entry pane
function addEntries(entries) {
  const entryList = document.getElementById("entry-list");
  entryList.innerHTML = ""; // clear

  // sort entries
  entries.sort(function (fst, snd) {
    return new Date(snd["updated"]) - new Date(fst["updated"]);
  });

  let entryCount = 0;
  for (const entry of entries) {
    if (entry["deleted"] === true) continue;

    const elem = document.createElement("li");
    elem.classList.add("entry-list-elem");
    elem.setAttribute("feed-id", entry["feedid"]);
    elem.setAttribute("entry-id", entry["id"]);
    // elem.addEventListener("click", () => {
    //   fillContentPane(entry["feedid"], entry["id"]);
    // });

    const titleElem = document.createElement("div");
    titleElem.appendChild(document.createTextNode(entry["title"]));
    titleElem.setAttribute("title", entry["title"]);
    titleElem.classList.add("entry-list-elem-title");
    titleElem.classList.add(entry["read"] ? "read" : "unread");
    elem.appendChild(titleElem);

    const iconElem = document.createElement("img");
    iconElem.setAttribute("src", entry["icon"]);
    iconElem.classList.add("favicon");
    elem.appendChild(iconElem);

    const titleDateElem = document.createElement("span");
    titleDateElem.classList.add("entry-list-elem-feed-date-cont");
    const feedElem = document.createElement("span");
    feedElem.appendChild(document.createTextNode(entry["feedtitle"]));
    feedElem.classList.add("entry-list-elem-feed");
    titleDateElem.appendChild(feedElem);

    if (entry["updated"]) {
      const dateElem = document.createElement("span");
      const date = new Date(entry["updated"]);
      const dateStr =
        date.toLocaleDateString("tr-TR") +
        " " +
        date.toLocaleTimeString("tr-TR");
      dateElem.appendChild(document.createTextNode(dateStr));
      dateElem.classList.add("entry-list-elem-date");
      titleDateElem.appendChild(dateElem);
    }
    elem.appendChild(titleDateElem);

    entryList.appendChild(elem);
    entryCount += 1;
  }
}

// when a feed (feed-list-elem) on left pane is clicked
// fill entry-pane (mid-pane)
function fillEntryPaneByFeed(feedId) {
  console.log("fillEntryPaneByFeed:", feedId);

  if (!(feedId in cache["feeds"])) {
    return false;
  }

  // add/remove 'clicked' class
  for (const elem of document.getElementsByClassName("feed-list-elem")) {
    elem.classList.remove("clicked");
  }
  for (const elem of document.getElementsByClassName("function-list-elem")) {
    elem.classList.remove("clicked");
  }
  let feedElem = document.getElementById(feedId);
  if (feedElem) {
    feedElem.classList.add("clicked");
  }
  document.title = `${TITLE} (${cache["feeds"][feedId]["title"]})`;
  const entries = Object.values(cache["feeds"][feedId]["entries"]);
  addEntries(entries);
  return true;
}

// fill feed pane (left pane), using cached data
function fillFeedPane() {
  console.log("fillFeedPane");
  const elems = [];
  for (const [feedId, feed] of Object.entries(cache["feeds"])) {
    const elem = document.createElement("li");
    elem.classList.add("feed-list-elem");
    elem.setAttribute("id", feedId);
    elem.setAttribute("order", feed["order"]);
    elem.setAttribute("title", feed["title"]);
    elem.addEventListener("click", () => {
      fillEntryPaneByFeed(feedId);
    });

    const iconElem = document.createElement("img");
    iconElem.setAttribute("src", feed["icon"]);
    iconElem.classList.add("favicon");
    elem.appendChild(iconElem);

    const titleElem = document.createElement("span");
    titleElem.classList.add("feed-list-elem-title");
    titleElem.appendChild(document.createTextNode(feed["title"]));
    elem.appendChild(titleElem);

    elems.push(elem);
  }

  // sort elements
  elems.sort((fst, snd) => {
    return fst.getAttribute("order") - snd.getAttribute("order");
  });

  // add everything to the list
  const feedsList = document.getElementById("feed-list");
  feedsList.innerHTML = ""; // clear all
  for (const elem of elems) {
    feedsList.appendChild(elem);
  }
}

// get next order from cache for new feed
function getNextOrder() {
  let order = 0;
  for (const feed of Object.values(cache["feeds"])) {
    if (feed["order"] > order) {
      order = feed["order"];
    }
  }
  return order + 1;
}

// add new feed, initiated by either clicking the button or pressing 'e'
// changes global object
async function addFeed() {
  const url = prompt("Enter url").trim();
  if (url) {
    try {
      const feed = await fetchParseFeed(url);

      // save
      if (!(url in cache["feeds"])) {
        feed["order"] = getNextOrder();
        cache["feeds"][feed["id"]] = feed;
        chrome.storage.local.set(cache, () => {
          fillFeedPane();
        });
      } else {
        window.alert(`url (${url}) is already added as ${cache["feeds"][url]}`);
      }
    } catch (error) {
      console.error(error);
    }
  }
}

function fillFunctionPane() {
  console.log("fillFunctionPane");
  const listElem = document.getElementById("function-list");
  listElem.innerHTML = "";

  const allFeedsElem = document.createElement("li");
  allFeedsElem.classList.add("function-list-elem");
  allFeedsElem.setAttribute("id", "all-feeds");
  allFeedsElem.appendChild(document.createTextNode("All Feeds"));
  allFeedsElem.addEventListener("click", () => {
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set("all", true);
    window.history.pushState({}, "", url);
    fillEntryPaneAll();
  });
  listElem.appendChild(allFeedsElem);

  const queryElem = document.createElement("li");
  queryElem.classList.add("function-list-elem");
  queryElem.setAttribute("id", "query-feeds");
  queryElem.appendChild(document.createTextNode("Query Feeds"));
  queryElem.addEventListener("click", () => {
    // if lastQuery is empty try to find query from url
    if (lastQuery === "") {
      const params = new URLSearchParams(window.location.search);
      const qParam = params.get("query");
      if (qParam) {
        lastQuery = decodeURIComponent(qParam);
      }
    }

    const input = prompt(
      "Enter query (boolean algebra using '&', '|', '!', '(', ')')",
      lastQuery,
    );
    makeQuery(input);
  });
  listElem.appendChild(queryElem);

  let tags = new Set();
  for (const [_url, feed] of Object.entries(cache["feeds"])) {
    if (feed["tags"]) {
      for (const tag of feed["tags"]) {
        tags.add(tag);
      }
    }
  }
  tags = new Array(...tags).sort();
  for (const tag of tags) {
    const tagElem = document.createElement("li");
    tagElem.classList.add("function-list-elem");
    tagElem.classList.add("querytag-feeds");
    tagElem.appendChild(document.createTextNode("#" + tag));
    tagElem.setAttribute("id", "#" + tag);
    tagElem.addEventListener("click", () => {
      const url = new URL(window.location.origin + window.location.pathname);
      url.searchParams.set("tag", tag);
      window.history.pushState({}, "", url);
      fillEntryPaneByTag(tag);
    });
    listElem.appendChild(tagElem);
  }
}

function clearInternalData() {
  const res = window.confirm("Are you sure you want to delete all the data?");
  if (res) {
    chrome.storage.local.clear(function () {
      location.reload();
    });
  }
}

// set last style
function setLastStyle() {
  console.log("setLastStyle");
  chrome.storage.local.get({ style: {} }, function (obj) {
    for (const [id, rule] of Object.entries(obj["style"])) {
      const elem = document.getElementById(id);
      let rulestr = JSON.stringify(rule);
      rulestr = rulestr.substr(1, rulestr.length - 2);
      rulestr = rulestr.replaceAll('"', "");
      rulestr = rulestr.replaceAll(",", ";");
      console.log("id:", id, ", setting:", rulestr);
      elem["style"] = rulestr;
    }
  });
  chrome.storage.local.get({ theme: "" }, function (obj) {
    if (obj["theme"]) {
      console.log("setting theme:", obj["theme"]);
      document.documentElement.setAttribute("theme", obj["theme"]);
    } else {
      document.documentElement.setAttribute("theme", "light");
    }
  });
}

function init() {
  document.addEventListener("DOMContentLoaded", function () {
    setLastStyle();
    chrome.storage.local.get({ feeds: {} }, (obj) => {
      cache = obj;
      fillFunctionPane();
      fillFeedPane();
    });
  });

  // toolbar buttons
  document.getElementById("add-feed").addEventListener("click", addFeed);
  document
    .getElementById("clear-data")
    .addEventListener("click", clearInternalData);
}

init();
