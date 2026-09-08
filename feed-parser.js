import { createIdFromUrl, resolveUrl } from "./utils.js";

const ATOM_QUERIES = {
  namespace: "http://www.w3.org/2005/Atom",
  title: { xpath: "/ns:feed/ns:title" },
  link: [
    { xpath: "/ns:feed/ns:link[@rel='alternate']/@href" },
    { xpath: "/ns:feed/ns:link[not(@rel)]/@href" },
    { xpath: "/ns:feed/ns:id" },
  ],
  updated: { xpath: "/ns:feed/ns:updated" },
  icon: { xpath: "/ns:feed/ns:icon" },
  entries: { xpath: "/ns:feed/ns:entry" },
  entrytitle: { xpath: "ns:title" },
  entrylink: { xpath: "ns:link/@href" },
  entryupdated: [{ xpath: "ns:updated" }, { xpath: "ns:published" }],
  entrycontent: [{ xpath: "ns:content" }, { xpath: "ns:summary" }],
};

const RSS_QUERIES = {
  title: { xpath: "/rss/channel/title/text()" },
  link: [
    { xpath: "/rss/channel/link[@rel='alternate']/@href" },
    { xpath: "/rss/channel/link[not(@rel)]" },
  ],
  updated: [
    { xpath: "/rss/channel/lastBuildDate" },
    { xpath: "/rss/channel/pubDate" },
  ],
  icon: { xpath: "*[local-name()='icon']" },
  entries: { xpath: "/rss/channel/item" },
  entrytitle: { xpath: "title" },
  entrylink: { xpath: "link" },
  entryupdated: [
    { xpath: "pubDate" },
    { xpath: "*[local-name()='published']" },
  ],
  entrycontent: [{ xpath: "description" }, { xpath: "encoded" }],
};

function isQueryObject(x) {
  return typeof x === "object" && !Array.isArray(x) && x["xpath"];
}

function isQueryArray(x) {
  return Array.isArray(x) && x.length > 0 && x[0]["xpath"];
}

function executeXpath(doc, node, xpath, namespace, type) {
  let namespaceResolver = null;
  if (namespace) {
    namespaceResolver = function (prefix) {
      if (prefix === "ns") {
        return namespace;
      }
      return null;
    };
  }
  const resultType =
    type === "str"
      ? XPathResult.STRING_TYPE
      : XPathResult.ORDERED_NODE_ITERATOR_TYPE;

  if (!node) {
    node = doc;
  }

  const res = doc.evaluate(xpath, node, namespaceResolver, resultType);

  if (type === "str") {
    const res_str = res.stringValue.trim();
    if (res_str && res_str !== "") {
      return res_str;
    }
  }
  if (type === "nodes") {
    const nodes = [];
    let item;
    while ((item = res.iterateNext())) {
      nodes.push(item);
    }
    if (nodes && nodes.length > 0) {
      return nodes;
    }
  }
  return null;
}

function execute_query(doc, node, query, namespace, type) {
  if (isQueryObject(query)) {
    return executeXpath(doc, node, query["xpath"], namespace, type);
  }
  if (isQueryArray(query)) {
    for (const q of query) {
      const res = executeXpath(doc, node, q["xpath"], namespace, type);
      if (res) {
        return res;
      }
    }
  }
  return null;
}

// Atom spec: https://www.rfc-editor.org/info/rfc4287/
function parse(doc, feedUrl, queries) {
  const feed = {};
  feed["feedlink"] = feedUrl;
  feed["id"] = createIdFromUrl(feed["feedlink"]);
  feed["title"] = execute_query(
    doc,
    doc,
    queries["title"],
    queries["namespace"],
    "str",
  );
  feed["link"] = execute_query(
    doc,
    doc,
    queries["link"],
    queries["namespace"],
    "str",
  );

  // if there is no link, resolve origin from feedurl
  if (!feed["link"]) {
    feed["link"] = new URL(feedUrl).origin;
  }

  feed["updated"] = execute_query(
    doc,
    doc,
    queries["updated"],
    queries["namespace"],
    "str",
  );
  if (feed["updated"]) {
    feed["updated"] = new Date(feed["updated"]).toJSON();
  }

  feed["icon"] = execute_query(
    doc,
    doc,
    queries["icon"],
    queries["namespace"],
    "str",
  );

  // parse entries
  feed["entries"] = {};
  const entry_nodes = execute_query(
    doc,
    doc,
    queries["entries"],
    queries["namespace"],
    "nodes",
  );
  for (const entry_node of entry_nodes) {
    const entry = {};

    entry["title"] = execute_query(
      doc,
      entry_node,
      queries["entrytitle"],
      queries["namespace"],
      "str",
    );

    entry["link"] = execute_query(
      doc,
      entry_node,
      queries["entrylink"],
      queries["namespace"],
      "str",
    );
    // relative link to full
    entry["link"] = resolveUrl(feed["feedlink"], entry["link"]);

    entry["updated"] = execute_query(
      doc,
      entry_node,
      queries["entryupdated"],
      queries["namespace"],
      "str",
    );
    if (entry["updated"]) {
      entry["updated"] = new Date(entry["updated"]).toJSON();
    }

    entry["content"] = execute_query(
      doc,
      entry_node,
      queries["entrycontent"],
      queries["namespace"],
      "str",
    );

    // if all good, add the entry
    if (
      entry["title"] &&
      entry["link"] &&
      entry["updated"] &&
      entry["content"]
    ) {
      const id = createIdFromUrl(entry["link"]);
      entry["id"] = id;
      entry["feedtitle"] = feed["title"];
      entry["feedlink"] = feed["feedlink"];
      entry["icon"] = feed["icon"];
      feed["entries"][id] = entry;
    }
  }

  // if there is no update date in feed-wise
  // traverse entries and find the most recent one and set it
  if (!feed["updated"]) {
    let mostRecent = null;
    for (const entry of feed["entries"]) {
      if (mostRecent === null || entry["updated"] > mostRecent) {
        mostRecent = entry["updated"];
      }
    }
    if (mostRecent) {
      feed["updated"] = mostRecent;
    }
  }

  return feed;
}

/**
 * takes textual `content` and returns an object
 * @param {string} content
 * @returns {Object}
 */
function parseFeed(content, url) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, "application/xml");
    if (doc.querySelector("parsererror")) {
      throw new Error("parsererror");
    }

    let queries = null;
    const rootNode = doc.documentElement.nodeName.trim();
    if (rootNode === "feed") {
      queries = ATOM_QUERIES;
    } else if (rootNode === "rss") {
      queries = RSS_QUERIES;
    }
    if (!queries) {
      throw new Error("Unknown feed type");
    }

    return parse(doc, url, queries);
  } catch (error) {
    throw error;
  }
}

export default parseFeed;

// ================================================================

// python -m http.server 8001  # in directory

// {
//   content = await fetch("feeds/https-alexwlchan-net-atom-xml.xml").then(r => r.text());
//   parser = new DOMParser();
//   doc = parser.parseFromString(content, "application/xml");
//   elems = executeXpath(doc, doc, "/ns:feed/ns:entry", ATOM_QUERIES["namespace"], "nodes");
//   elem = elems[0]
//   executeXpath(doc, elems[0], "ns:title",ATOM_QUERIES["namespace"], "str");
// }

// {
//   const urls = [
//     "http://www.howardism.org/index.xml",
//     "http://xahlee.info/comp/blog.xml",
//     "https://arstechnica.com/feed/",
//     "https://begriffs.com/atom.xml",
//     "https://gizmodo.com/rss",
//     "https://karthinks.com/index.xml",
//     "https://learningenglish.voanews.com/api/zmg_pe$myp",
//     "https://lobste.rs/rss",
//     "https://mathspp.com/blog.atom",
//     "https://news.ycombinator.com/rss",
//     "https://nullprogram.com/feed/",
//     "https://sneak.berlin/feed.xml",
//     "https://thume.ca/atom.xml",
//     "https://www.angrymetalguy.com/feed/",
//     "https://ecc-comp.blogspot.com/feeds/posts/default?alt=atom",
//     "https://www.comicsrss.com/rss/calvinandhobbes.rss",
//     "https://www.fluentcpp.com/feed/",
//     "https://www.foonathan.net/feed.xml",
//     "https://www.reddit.com/r/emacs/.rss",
//     "https://www.reddit.com/r/linux/.rss",
//     "https://xkcd.com/atom.xml",
//     "https://www.newsinlevels.com/level/level-3/feed/",
//     "https://www.daysinlevels.com/level/level-3/feed/",
//     "https://learningenglish.voanews.com/api/zoroqqegtoqq",
//     "https://learningenglish.voanews.com/api/zpyp_e-rm_",
//     "https://www.englishclub.com/ref/idiom-of-the-day.xml",
//     "https://www.englishclub.com/ref/slang-of-the-day.xml",
//     "https://www.englishclub.com/ref/phrasal-verb-of-the-day.xml",
//     "https://blog.wordnik.com/feed",
//     "https://www.theregister.com/headlines.atom",
//     "http://www.gnu.org/rss/whatsnew.rss",
//     "https://planet.gentoo.org/atom.xml",
//     "https://planet.kde.org/atom.xml",
//     "https://www.dedoimedo.com/rss_feed.xml",
//     "https://www.allmusic.com/rss",
//     "https://planet.debian.org/atom.xml",
//     "https://pointieststick.com/feed/",
//     "https://www.metalepidemic.com/feed/",
//     "https://cestlaz.github.io/rss.xml",
//     "https://www.youtube.com/feeds/videos.xml?channel_id=UCxHAlbZQNFU2LgEtiqd2Maw",
//     "https://akrzemi1.wordpress.com/feed/",
//     "https://brevzin.github.io/feed.xml",
//     "https://christiantietze.de/feed.atom",
//     "https://www.cppstories.com/index.xml",
//     "https://isocpp.org/blog/rss",
//     "https://reclaimthenet.org/feed/",
//     "http://xahlee.info/emacs/emacs/blog.xml",
//     "https://www.nocleansinging.com/feed/",
//     "http://feeds.feedburner.com/metalunderground",
//     "https://www.joelonsoftware.com/feed/",
//     "https://metalstorm.net/rss/news.xml",
//     "https://torrentfreak.com/feed/",
//     "https://unixsheikh.com/feed.rss",
//     "https://radekmie.github.io/atom.xml",
//     "http://blog.practicalethics.ox.ac.uk/feed/",
//     "https://drewdevault.com/blog/index.xml",
//     "https://writings.stephenwolfram.com/feed/atom/",
//     "https://api.quantamagazine.org/feed/",
//     "https://www.bleepingcomputer.com/feed/",
//     "https://macwright.com/atom.xml",
//     "https://mjg59.dreamwidth.org/data/rss",
//     "https://blog.meain.io/feed.xml",
//     "https://blog.codinghorror.com/rss/",
//     "https://blog.rust-lang.org/feed.xml",
//     "https://lars.ingebrigtsen.no/feed/",
//     "http://deeperintomovies.net/journal/feed",
//     "https://jasonsmovieblog.com/feed/",
//     "http://kevinscave13.blogspot.com/feeds/posts/default",
//     "https://happyotter666.blogspot.com/feeds/posts/default",
//     "https://feeds.feedburner.com/glyph",
//     "http://bmovieshelf.blogspot.com/feeds/posts/default",
//     "https://www.masteringemacs.org/feed",
//     "https://awesomekling.github.io/feed.xml",
//     "https://www.linux-magazine.com/rss/feed/lmi_news",
//     "https://hackaday.com/blog/feed/",
//     "https://realpython.com/atom.xml",
//     "https://trashortreasure.blog/feed/",
//     "https://csdl-api.computer.org/api/rss/periodicals/mags/co/rss.xml",
//     "https://edwardsnowden.substack.com/feed/",
//     "http://boston.conman.org/index.atom",
//     "https://cdn.jwz.org/blog/feed/",
//     "https://github.blog/feed/",
//     "https://ciechanow.ski/atom.xml",
//     "http://thevagrantrises.blogspot.com/feeds/posts/default",
//     "https://eli.thegreenplace.net/feeds/all.atom.xml",
//     "https://moofmag.com/feed/",
//     "https://cadence.moe/blog/rss.xml",
//     "http://schwitzsplinters.blogspot.com/feeds/posts/default",
//     "https://www.videosinlevels.com/feed/",
//     "https://manifold.press/rss",
//     "https://brushingupscience.com/feed/",
//     "https://scalibq.wordpress.com/feed/",
//     "https://magpi.raspberrypi.com/feed",
//     "https://www.electronicsweekly.com/feed/",
//     "https://www.eetimes.com/feed",
//     "https://linuxgizmos.com/feed/",
//     "https://www.linuxjournal.com/node/feed",
//     "https://phys.org/rss-feed/",
//     "https://lwn.net/headlines/newrss",
//     "https://computerhistory.org/feed/atom",
//     "https://blog.archive.org/feed/",
//     "https://til.simonwillison.net/tils/feed.atom",
//     "https://penguinpetes.com/wordpress/feed/",
//     "https://www.sandordargo.com/feed.xml",
//     "https://blog.python.org/feeds/posts/default?alt=rss",
//     "https://randomascii.wordpress.com/feed",
//     "https://changelog.com/posts/feed",
//     "https://wearethemutants.com/feed/",
//     "https://tsdh.org/rss.xml",
//     "https://ervin.ipsquad.net/atom.xml",
//     "https://kickstartembedded.com/feed/",
//     "https://www.phoronix.com/rss.php",
//     "https://belaycpp.com/feed/",
//     "https://vas3k.blog/rss/",
//     "https://tonsky.me/atom.xml",
//     "https://theactionelite.com/feed/",
//     "https://betterexplained.com/feed/",
//     "https://michaelochurch.wordpress.com/feed",
//     "https://www.atlasobscura.com/feeds/latest",
//     "http://www.badmovies.org/rssfeed.xml",
//     "https://www.ghacks.net/feed/",
//     "https://www.osnews.com/feed/",
//     "https://www.tomshardware.com/feeds/all",
//     "https://distrowatch.com/news/headline.xml",
//     "https://www.oglaf.com/feeds/rss/",
//     "https://what-if.xkcd.com/feed.atom",
//     "https://www.menarebetterthanwomen.com/feed/atom/",
//     "https://improbable.com/feed/",
//     "https://www.electroboom.com/?feed=rss2",
//     "https://spectrum.ieee.org/feeds/feed.rss",
//     "https://www.snopes.com/feed/",
//     "https://world.hey.com/dhh/feed.atom",
//     "https://computer.rip/rss.xml",
//     "https://coredumped.dev/index.xml",
//     "https://tildes.net/topics.atom",
//     "https://tildes.net/~comp/topics.atom",
//     "https://www.righto.com/feeds/posts/default",
//     "https://viewpointmag.com/feed/",
//     "https://rarelust.com/feed/",
//     "https://lexi-lambda.github.io/feeds/all.atom.xml",
//     "https://kleinembedded.com/feed/",
//     "https://www.delikasap.org/feed/",
//     "https://world-playground-deceit.net/global.xml",
//     "https://old.reddit.com/r/embedded/.rss",
//     "https://www.beningo.com/blog/feed",
//     "https://justine.lol/rss.xml",
//     "https://fhur.me/feed.xml",
//     "https://akselmo.dev/feed.xml",
//     "https://www.newscientist.com/feed/home/",
//     "https://fishshell.com/blog/feed.xml",
//     "https://www.engins.org/feed/",
//     "https://www.vintagecomputing.com/index.php/feed/atom",
//     "https://www.marginalia.nu/index.xml",
//     "https://ersei.net/en/blog.atom",
//     "https://bentsukun.ch//index.xml",
//     "https://okmij.org/ftp/rss.xml",
//     "https://www.datagubbe.se/atom.xml",
//     "https://faultlore.com/blah/rss.xml",
//     "http://localhost:8000/chrisdone-com-posts",
//     "http://localhost:8000/chiark-greenend-org-uk-~sgtatham-quasiblog",
//     "https://guix.gnu.org/feeds/blog.atom",
//     "https://steveklabnik.com/feed.xml",
//     "https://v8.dev/blog.atom",
//     "https://greatscottgadgets.com/feed.xml",
//     "https://steve-yegge.blogspot.com/feeds/posts/default",
//     "https://leontrolski.github.io/leontrolski.rss",
//     "https://pointersgonewild.com/rss.xml",
//     "https://ratfactor.com/atom.xml",
//     "https://lxer.com/module/newswire/headlines.rss",
//     "https://www.baldurbjarnason.com/essays.xml",
//     "https://arcan-fe.com/feed/",
//     "https://henrikwarne.com/feed/",
//     "https://www.livescience.com/feeds.xml",
//     "https://www.scientificamerican.com/platform/syndication/rss/",
//     "https://www.ams.org/cgi-bin/content/news_items.cgi?rss=1",
//     "https://www.invisibleoranges.com/feed/",
//     "https://gwern.substack.com/feed",
//     "https://blog.whenhen.com/rss.xml",
//     "https://lambdacreate.com/static/feed.xml",
//     "https://seirdy.one/atom.xml",
//     "https://twdev.blog/posts/index.xml",
//     "https://0pointer.net/blog/index.atom",
//     "https://www.embeddedrelated.com/blogs_rss.php",
//     "https://glfmn.io/rss.xml/",
//     "https://feed.tedium.co/",
//     "https://kyo.iroiro.party/en/rss.xml",
//     "https://sachachua.com/blog/feed",
//     "https://alexwlchan.net/atom.xml",
//     "https://nesbitt.io/feed.xml",
//     "https://susam.net/feed.xml",
//     "https://thelibre.news/latest/rss/",
//     "https://shkspr.mobi/blog/feed/atom",
//     "https://aartaka.me/rss.xml",
//     "https://matklad.github.io/feed.xml",
//     "https://medium.com/feed/@peternorvig",
//     "https://www.404media.co/rss/",
//     "https://ladyobscure.com/feed/",
//     "https://mattlakeman.org/feed/",
//     "https://beneri.se/rss.php",
//     "https://michael.stapelberg.ch/feed.xml",
//     "https://pxlnv.com/feed/",
//     "https://tilde.town/~ramin_hal9001/atom.xml",
//     "https://veronneau.org/feeds/atom.xml",
//     "https://xn--gckvb8fzb.com/index.xml",
//     "https://lmnt.me/feed.xml",
//     "https://pluralistic.net/feed/",
//     "https://www.wheresyoured.at/rss/",
//     "https://tinfoil-hat.net/posts/index.xml",
//     "https://mutantreviewersmovies.com/feed/",
//     "https://jamie-wong.com/atom.xml",
//     "https://www.wired.com/feed/rss",
//     "https://mcyoung.xyz/feed.xml",
//     "https://annas-archive.gd/blog/rss.xml",
//     "https://manueluberti.eu/feed.xml",
//     "https://www.flyingpenguin.com/feed/",
//     "https://maskray.me/blog/atom.xml",
//     "https://gmpy.dev/feeds/atom.all.xml",
//     "https://davidgraeber.org/feed/",
//     "https://www.theatlantic.com/feed/all/",
//     "https://nelson.cloud/posts/index.xml",
//     "https://justdario.com/feed/",
//     "https://garymarcus.substack.com/feed",
//     "https://paulkrugman.substack.com/feed",
//   ];

//   for (const url of urls) {
//     console.log(url);
//     try {
//       const id = createIdFromUrl(url);
//       const filename = `feeds/${id}.xml`;
//       console.log();
//       console.log(filename);
//       const content = await fetch(filename).then((r) => r.text());
//       const feed = parseFeed(content, url);
//       console.log(feed["updated"]);
//       // for (let entry of feed["entries"]) {
//       //   console.log(entry["link"]);
//       // }
//     } catch (error) {
//       //console.log(error);
//       console.log("error");
//     }
//   }
// }
