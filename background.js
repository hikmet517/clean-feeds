function openViewer() {
  const u = chrome.extension.getURL('viewer.html');
  chrome.tabs.query({ url: u }, (tabs) => {
    // tab is not opened
    if (!tabs || tabs.length === 0) {
      chrome.tabs.create({ url: u });
    }
    // already open, select the tab
    else {
      chrome.windows.update(tabs[0].windowId, { focused: true }, () => {
        chrome.tabs.update(tabs[0].id, { highlighted: true, active: true });
      });
    }
  });
}

chrome.browserAction.onClicked.addListener(openViewer);
