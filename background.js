var tabId = -1;

function openViewer() {
  if (tabId === -1) {

    // create and store tabId
    chrome.tabs.create({
      url: "viewer.html"
    }, function(tab) {
      tabId = tab.id;

      // when closed set tabId to -1
      chrome.tabs.onRemoved.addListener(function(tabid, _removed) {
        if (tabid === tabId)
          tabId = -1;
      });
    });
  }
  else {
    chrome.tabs.update(tabId, { highlighted: true });
  }
}

chrome.browserAction.onClicked.addListener(openViewer);
