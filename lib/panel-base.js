/* See license.txt for terms of usage */

"use strict";

// Add-on SDK
const self = require("sdk/self");
const options = require("@loader/options");
const { Cu, Ci } = require("chrome");
const { Panel } = require("dev/panel.js");
const { Class } = require("sdk/core/heritage");
const { viewFor } = require("sdk/view/core");
const { resolve } = require("sdk/core/promise");
const { loadSheet, removeSheet } = require("sdk/stylesheet/utils");
const { prefs } = require("sdk/simple-prefs");

// Firebug.SDK
const { Trace, TraceError } = require("./core/trace.js").get(module.id);
const { Locale } = require("./core/locale.js");
const { Content } = require("./core/content.js");
const { ToolboxChrome } = require("./toolbox-chrome.js");
const { devtools, gDevTools } = require("./core/devtools.js");
const { Dom } = require("./core/dom.js");
const { TabMenu } = require("./tab-menu.js");

// Platform
const { Services } = Cu.import("resource://gre/modules/Services.jsm", {});

/**
 * This object represents base for Toolbox panel. It automatically
 * sets up communication channel between the panel (chrome scope)
 * and the view (content) scope as well as handles theme changes.
 */
const PanelBase = Class(
/** @lends PanelBase */
{
  extends: Panel,

  // Needs to be specified by derived object.
  label: "",
  tooltip: "",
  icon: "",
  url: "",

  // Feature flags
  searchable: false,

  /**
   * Executed by the framework when an instance of this panel is created.
   * There is one instance of this panel per {@Toolbox}. The panel is
   * instantiated when selected in the toolbox for the first time.
   */
  initialize: function(options) {
    console.log("PanelBase.initialize;", options);

    this.onContentMessage = this.onContentMessage.bind(this);
    this.onThemeChanged = this.onThemeChanged.bind(this);
  },

  /**
   * Executed by the framework when an overlaid panel is destroyed.
   */
  destroy: function() {
    this.tabMenu.destroy();
  },

  /**
   * Executed by the framework when the panel is destroyed.
   */
  dispose: function() {
    console.log("PanelBase.dispose;");

    this.destroy();
    this.detach();
  },

 /**
  * Executed by the framework when the panel content iframe is
  * constructed. Allows e.g to connect the backend through
  * `debuggee` object
  */
  setup: function(options) {
    console.log("PanelBase.setup;", options);

    this.debuggee = options.debuggee;
    this.panelFrame = viewFor(this);
    this.toolbox = getToolbox(this.panelFrame.contentWindow);

    this.tabMenu = new TabMenu({
      panel: this,
      toolbox: this.toolbox
    });

    ToolboxChrome.on("theme-changed", this.onThemeChanged);

    this.attach();
  },

  onReady: function() {
    console.log("PanelBase.onReady;");

    // Load content script and register message handler.
    let { messageManager } = this.panelFrame.frameLoader;
    if (messageManager) {
      let url = module.uri.replace("panel-base.js", "panel-frame-script.js");
      messageManager.loadFrameScript(url, false);
      messageManager.addMessageListener("firebug.sdk/message", this.onContentMessage);
    }
  },

  // Events from the View (myView.html)

  onContentReady: function(args) {
    console.log("PanelBase.onContentReady;", args);

    let win = this.panelFrame.contentWindow;
    let theme = {
      getDefinition: function(themeId) {
        let view = Content.getContentView(win);
        let def = gDevTools.getThemeDefinition(themeId);
        return view.JSON.parse(JSON.stringify(def));
      },
      getCurrentTheme: function() {
        return ToolboxChrome.getCurrentTheme();
      }
    }

    let options = {
      get: function(name) {
        return prefs[name];
      }
    }

    Content.exportIntoContentScope(win, Locale, "Locale");
    Content.exportIntoContentScope(win, theme, "Theme");
    Content.exportIntoContentScope(win, options, "Options");

    // Load 'theme-switching' script that updates theme class
    // name when the active theme changes.
    let url = module.uri.replace("panel-base.js", "theme-switching.js");
    Dom.loadScript(win.document, url, event => {
      this.postContentMessage("initialize", {
        currentTheme: Services.prefs.getCharPref("devtools.theme")
      });
    });
  },

  /**
   * Handle messages coming from the view (*.html)
   */
  onContentMessage: function(msg) {
    console.log("PanelBase.onContentMessage;", msg);

    let event = msg.data;
    let method = event.type;

    // Execute appropriate event handler.
    if (typeof this[method] == "function") {
      this[method](event.args);
    };
  },

  /**
   * Send message to the content scope (panel's iframe)
   */
  postContentMessage: function(id, data) {
    let { messageManager } = this.panelFrame.frameLoader;
    messageManager.sendAsyncMessage("firebug.sdk/message", {
      type: id,
      bubbles: false,
      cancelable: false,
      data: data,
    });
  },

  // Backend

  attach: function() {
    // TODO: implement in base object
    return resolve();
  },

  detach: function() {
    // TODO: implement in base object
    return resolve();
  },

  // Search

  /**
   * Default search uses simple text selection inside the panel.
   */
  onSearch: function(text, reverse) {
    Trace.sysout("domPanel.onSearch; " + text);

    this.postContentMessage("onSearch", {
      text: text,
      reverse: reverse
    });
  },

  // Theme

  onThemeChanged: function(newTheme, oldTheme) {
    this.postContentMessage("theme-changed", {
      newTheme: newTheme,
      oldTheme: oldTheme,
    });
  },

  /**
   * Executed by the Context object that is distributing "theme-switched"
   * event fired by XUL windows that includes theme-switching.js script.
   */
  onThemeSwitched: function(win, newTheme, oldTheme) {
  },

  // Options

  getOptionsMenuItems: function() {
    let items = [];
    return items;
  },

  /**
   * Executed by the framework when the user clicks panel tab options
   * menu target. Returns custom menu popup for panel options.
   *
   * @returns {MenuPopup} The method can return custom <menupopup> element
   * that will be displayed when the user clicks the tab options target.
   */
  getOptionsMenuPopup: function() {
  },

  // Panel Selection

  /**
   * Executed by the framework when the panel is selected in the toolbox.
   */
  onShow: function() {
    Trace.sysout("PanelOverlay.show;");
    this.tabMenu.onPanelShow();
  },

  /**
   * Executed by the framework when the panel is un-selected in the toolbox.
   */
  onHide: function() {
    Trace.sysout("PanelOverlay.hide;");
    this.tabMenu.onPanelHide();
  },

  // Accessors

  /**
   * Returns content document of the panel frame.
   */
  getPanelDocument: function() {
    return this.panelFrame.contentDocument;
  },

  /**
   * Returns content window of the panel frame.
   */
  getPanelWindow: function() {
    return this.panelFrame.contentWindow;
  }
});

// Helpers

function getToolbox(win) {
  let tab = getCurrentTab(win);
  if (tab) {
    let target = devtools.TargetFactory.forTab(tab);
    return gDevTools.getToolbox(target);
  }
}

function getCurrentTab(win) {
  if (win) {
    let browserDoc = win.top.document;

    // The browser (id='content') is null in case the Toolbox is
    // detached from the main browser window.
    let browser = browserDoc.getElementById("content");
    if (browser) {
      return browser.selectedTab;
    }
  }

  let browser = getMostRecentBrowserWindow();
  if (browser) {
    return browser.gBrowser.mCurrentTab;
  }
}

// Exports from this module
exports.PanelBase = PanelBase;