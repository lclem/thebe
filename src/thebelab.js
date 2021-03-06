import $ from "jquery";
import CodeMirror from "codemirror/lib/codemirror";
import "codemirror/lib/codemirror.css";
import 'codemirror/theme/monokai.css';
import "codemirror/addon/fold/foldcode.js";
import "codemirror/keymap/emacs.js"

// search and replace addon

// import "codemirror/addon/search/searchcursor.js";

// import "codemirror/addon/dialog/dialog.css";
// import "codemirror/addon/dialog/dialog.js";
// import "codemirror/addon/display/panel.js";
// import "codemirror/addon/search/search.js";
// import "codemirror/addon/search/jump-to-line.js";

import "codemirror/addon/fold/foldgutter.css"
import "codemirror/addon/hint/show-hint.js"
import "codemirror/addon/selection/mark-selection";

// make CodeMirror public for loading additional themes
if (typeof window !== "undefined") {
  window.CodeMirror = CodeMirror;
}

import { Widget } from "@lumino/widgets";
import { KernelManager, KernelAPI } from "@jupyterlab/services";
import { ServerConnection } from "@jupyterlab/services";
import { MathJaxTypesetter } from "@jupyterlab/mathjax2";
import { OutputArea, OutputAreaModel } from "@jupyterlab/outputarea";
import {
  RenderMimeRegistry,
  standardRendererFactories,
} from "@jupyterlab/rendermime";
import {
  WIDGET_MIMETYPE,
  WidgetRenderer,
} from "@jupyter-widgets/html-manager/lib/output_renderers";
import { ThebeManager } from "./manager";
import { requireLoader } from "@jupyter-widgets/html-manager";

import { Mode } from "@jupyterlab/codemirror";

//import "@jupyterlab/theme-light-extension/style/index.css";
import "@jupyter-widgets/controls/css/widgets-base.css";
//import "@jupyterlab/rendermime/style/index.css";
import "./index.css";

// Exposing @jupyter-widgets/base and @jupyter-widgets/controls as amd
// modules for custom widget bundles that depend on it.

import * as base from "@jupyter-widgets/base";
import * as controls from "@jupyter-widgets/controls";

// this has the effect of enabling hints
import LaTeXHint from "codemirror-latex-hint";
// import macros from "codemirror-latex-hint/lib/macros.json";
import "codemirror-latex-hint/lib/index.css";

// CodeMirror.registerHelper("hint", "stex", (cm) => LaTeXHint(cm, macros));

if (typeof window !== "undefined" && typeof window.define !== "undefined") {
  window.define("@jupyter-widgets/base", base);
  window.define("@jupyter-widgets/controls", controls);
}

//import "codemirror/addon/search/matchesonscrollbar.js";
//import "codemirror/addon/scroll/annotatescrollbar.js";

//import "codemirror-revisedsearch/dist/revised-search"

// events

export const events = $({});
export const on = function () {
  events.on.apply(events, arguments);
};
export const one = function () {
  events.one.apply(events, arguments);
};
export const off = function () {
  events.off.apply(events, arguments);
};

// agda -------------------

const autocompleteKeyMap = {
  "\\": function(cm) {
    cm.replaceSelection("\\");
    cm.execCommand("autocomplete");
  },
};

// register the global error handler early on

window.addEventListener('error', function(event) {

  console.info("Got ERROR: ", event);

});

window.onerror = function(message, source, lineno, colno, error) {

  console.info("Got ONERROR, messasge: ", message, ", source: ", source, ", lineno: ", lineno, ", colno: ", colno, ", error: ", error);
  appendKernelMessage(message);
  setKernelDisonnected();

};

const hintOptions = {
  extraKeys: {
    // Complete with selected and insert space.
    Space: function(cm) {
      const cA = cm.state.completionActive;
      if (cA) {
        cA.widget.pick();
        cm.replaceSelection(" ");
      }
    },
  },
  // Use custom `closeCharacters` to allow text with ()[]{};:>,
  // Note that this isn't documented.
  closeCharacters: /[\s]/,
  // Disable auto completing even if there's only one choice.
  completeSingle: false,
};

// ------------------------

// options

const _defaultOptions = {
  bootstrap: false,
  preRenderHook: false,
  stripPrompts: false,
  requestKernel: false,
  runAllCells: false,
  predefinedOutput: true,
  indentWithTabs: false,
  smartIndent: true,
  mathjaxUrl: "https://cdnjs.cloudflare.com/ajax/libs/mathjax/2.7.5/MathJax.js",
  mathjaxConfig: "TeX-AMS_CHTML-full,Safe",
  selector: "[data-executable]",
  outputSelector: "[data-output]",
  binderOptions: {
    ref: "master",
    binderUrl: "https://mybinder.org",
    savedSession: {
      enabled: true,
      maxAge: 86400,
      storagePrefix: "thebe-binder-",
    },
  },
  kernelOptions: {
    path: "/",
    loadFromStore: true,
    persistent: false,
    serverSettings: {
      appendToken: true,
    },
  },
};

let ctrl_c = false;

let _pageConfigData = undefined;
function getPageConfig(key) {
  if (typeof window === "undefined") return;
  if (!_pageConfigData) {
    _pageConfigData = {};
    $("script[type='text/x-thebe-config']").map((i, el) => {
      if (el.getAttribute("data-thebe-loaded")) {
        // already loaded
        return;
      }
      el.setAttribute("data-thebe-loaded", "true");
      let thebeConfig = undefined;
      try {
        thebeConfig = eval(`(${el.textContent})`);
        if (thebeConfig) {
          console.log("loading thebe config", thebeConfig);
          $.extend(true, _pageConfigData, thebeConfig);
        } else {
          console.log("No thebeConfig found in ", el);
        }
      } catch (e) {
        console.error("Error loading thebe config", e, el.textContent);
      }
    });
  }
  return _pageConfigData[key];
}

export function mergeOptions(options) {
  // merge options from various sources
  // call > page > defaults
  let merged = {};
  getPageConfig();
  $.extend(true, merged, _defaultOptions);
  $.extend(true, merged, _pageConfigData);
  if (options) $.extend(true, merged, options);

  let loadFromStore = localStorage.getItem("input-loadFromStore");

  if (loadFromStore == "yes") {
    merged.kernelOptions.loadFromStore = true
  }
  else
    merged.kernelOptions.loadFromStore = false

  // retrive this option from the browser store
  let useBinder = localStorage.getItem("input-useBinder");

  console.info("browser storage: useBinder = ", useBinder);

  if (useBinder == "yes") {
    merged.binderOptions.repo = localStorage.getItem("input-repository");
    merged.binderOptions.ref = localStorage.getItem("input-ref");
    merged.binderOptions.binderUrl = localStorage.getItem("input-binderUrl");

    if (localStorage.getItem("input-savedSession") == "yes") {
      merged.binderOptions.savedSession.enabled = true;
    }
    else {
      merged.binderOptions.savedSession.enabled = false;
    }
    
    console.info("merging options to use binder");
  }
  else if (useBinder == "no") {
    merged.binderOptions.repo = "";
    merged.binderOptions.ref = "";
    merged.binderOptions.binderUrl = "";
    console.info("merging options NOT to use binder");
  }

  console.info("Merged options: ", merged);

  return merged;
}

export function getOption(key) {
  return mergeOptions()[key];
}

let _renderers = undefined;
function getRenderers(options) {
  if (!_renderers) {
    _renderers = standardRendererFactories.filter((f) => {
      // filter out latex renderer if mathjax is unavailable
      if (f.mimeTypes.indexOf("text/latex") >= 0) {
        if (options.mathjaxUrl) {
          return true;
        } else {
          console.log("MathJax unavailable");
          return false;
        }
      } else {
        return true;
      }
    });
  }
  return _renderers;
}

function foldHeader(cm, firstTime=false) {

  const marker = "-- BEGIN SOLUTION";
  var lastLine = cm.lastLine();
  var marks = cm.getAllMarks();

  if(! "folded" in cm || firstTime) {
    cm.folded = true;
  } else  {
    cm.folded = !cm.folded;
  }

  for (var i = 0; i <= lastLine; ++i) {
      var text = cm.getLine(i);
      var match = text.indexOf(marker);
      if (match == 0) {
        console.info("foldHeader, match at line: ", i);
        break;
      }

      if (cm.folded) {
        cm.removeLineClass(i, "background", "readOnly");
      }
      else {
        cm.addLineClass(i, "background", "readOnly");
      }

    }

  if (i == lastLine) {
    console.info("foldHeader, NO match");
    i = 0;
  }

  cm.foldCode(CodeMirror.Pos(0, 0), function(cm, start) {
    return {from: CodeMirror.Pos(0, 0), to: CodeMirror.Pos(i, 0)};
  });

  cm.markText({line: 0, ch: 0}, {line: i, ch: 0}, {inclusiveRight: true, inclusiveLeft: true, /* collapsed: true, */ readOnly: true /* , className: "readOnly" */});

}

// progress circle

function setProgress(partial, total) {

  console.info("setProgress: ", partial, "/", total);

  var progress_circle = document.getElementById('progress-circle');

  var radius = progress_circle.r.baseVal.value;
  var circumference = radius * 2 * Math.PI;

  progress_circle.style.strokeDasharray = `${circumference} ${circumference}`;
  progress_circle.style.strokeDashoffset = `${circumference}`;

  var progress_text = document.getElementById('progress-text');

  progress_text.innerHTML = partial + "/" + total;

  var ratio;

  if(total == 0) {
    ratio = 0;
  }
  else {
    //ratio = (partial * 1024 / total) / 1024;
    ratio = partial / total;
  }

  console.info("setProgress, ratio: ", ratio);

  const offset = circumference - ratio * circumference;
  progress_circle.style.strokeDashoffset = offset;
  progress_circle.style.visibility = "visible";

}

// setProgress(0, 0);

// rendering cells

let numberOfCells = 0, numberOfOKCells = 0;

function updateCellCounts() {

  // numberOfCells = 0;
  // numberOfOKCells = 0;

  // window.thebelab.cells.map((idx, { cell }) => {

  //   let theCell = cell[0];

  //   console.info("updateCellCounts, idx: ", idx, ", cell: ", theCell);

  //   let id = theCell.getAttribute("id");

  //   console.info("updateCellCounts, id: ", id);

  //   let badge_ok_id  = "status_badge_ok_" + id;

  //   console.info("updateCellCounts, badge_ok_id: ", badge_ok_id);

  //   let badge_ok = document.getElementById(badge_ok_id);

  //   console.info("updateCellCounts, badge_ok: ", badge_ok);

  //   let display = badge_ok.style.display;
  //   console.info("badge ok visible:", display);

  //   if (display == "none") {

  //   } else {

  //     numberOfOKCells++;

  //   }

  //   numberOfCells++;

  // }); 

  console.info("updateCellCounts, result: ", numberOfOKCells, "/", numberOfCells);
  setProgress(numberOfOKCells, numberOfCells);

}

function runAllCells() {
  var i = 0;
  window.thebelab.cells.map((idx, { execute }) => {
    console.info("runAllCells, i = ", i++);
    execute();
  }); 
}

function renderCell(element, options) {
  // render a single cell
  // element should be an `<pre>` tag with some code in it
  let mergedOptions = mergeOptions({ options });

  console.info("mergedOptions: ", mergedOptions);

  let kernelOptions = mergedOptions.kernelOptions;

  numberOfCells++;
  updateCellCounts();

  let $cell = $("<div class='thebelab-cell'/>");
  let $element = $(element);
  let $output = $element.next(mergedOptions.outputSelector);
  let source = $element.text().trim();
  let renderers = {
    initialFactories: getRenderers(mergedOptions),
  };
  if (mergedOptions.mathjaxUrl) {
    renderers.latexTypesetter = new MathJaxTypesetter({
      url: mergedOptions.mathjaxUrl,
      config: mergedOptions.mathjaxConfig,
    });
  }
  let renderMime = new RenderMimeRegistry(renderers);

  let manager = options.manager;

  renderMime.addFactory(
    {
      safe: false,
      mimeTypes: [WIDGET_MIMETYPE],
      createRenderer: (options) => new WidgetRenderer(options, manager),
    },
    1
  );

  let model = new OutputAreaModel({ trusted: true });

  let outputArea = new OutputArea({
    model: model,
    rendermime: renderMime,
  });

  let infoModel = new OutputAreaModel({ trusted: true });

  let infoArea = new OutputArea({
    model: infoModel,
    rendermime: renderMime,
  });

  infoArea.addClass("info-area");

  let cell_id = $element.attr("id")
  $cell.attr("id", cell_id);

  $element.replaceWith($cell);

  let $cm_element = $("<div class='thebelab-input'>");

  //  let $status_badge = $("<span class='status-badge status-badge-unknown'>").attr("title", "cell status");

  let $status_badge_ok = $('<span >\
    <svg class="status-badge-ok" xmlns="http://www.w3.org/2000/svg" width="10px" height="10px" viewBox="0 0 52 52">\
    <circle class="checkmark__circle" cx="26" cy="26" r="15" fill="none"/>\
    <path class="checkmark__check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>\
    </svg></span>');

  $status_badge_ok.attr("id", "status_badge_ok_" + cell_id);

  let $status_badge_unknown = $('<span>\
    <svg class="status-badge-unknown" xmlns="http://www.w3.org/2000/svg" width="10px" height="10px" viewBox="0 0 52 52">\
    <circle class="unknown__circle" cx="26" cy="26" r="15" fill="none"/>\
    </svg></span>');

  let $status_badge_running = $('<span>\
    <svg class="status-badge-running" xmlns="http://www.w3.org/2000/svg" width="10px" height="10px" viewBox="0 0 52 52">\
    <circle class="running__circle" cx="26" cy="26" r="15" fill="none"/>\
    </svg></span>');

  let $status_badge_error = $('<span><svg class="status-badge-error" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" height="32" style="overflow:visible;enable-background:new 0 0 32 32" viewBox="0 0 32 32" width="32" xml:space="preserve"><g><g id="Error_1_"><g id="Error"><circle cx="16" cy="16" id="BG" r="16" style="fill:#D72828;"/><path d="M14.5,25h3v-3h-3V25z M14.5,6v13h3V6H14.5z" id="Exclamatory_x5F_Sign" style="fill:#E6E6E6;"/></g></g></g></svg></span>');

  let $status_badge_warning = $('<span><svg class="status-badge-warning" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" height="32" style="overflow:visible;enable-background:new 0 0 32 32" viewBox="0 0 32 32" width="32" xml:space="preserve"><g><g id="Error_1_"><g id="Error"><circle cx="16" cy="16" id="BG" r="16" style="fill:#ebb372;"/><path d="M14.5,25h3v-3h-3V25z M14.5,6v13h3V6H14.5z" id="Exclamatory_x5F_Sign" style="fill:#E6E6E6;"/></g></g></g></svg></span>');

  let $cell_info = $("<span class='cell-info'>").text(" ");
  let $cell_toolbar = $("<div class='cell-toolbar'>").append(
    $("<button>") // class='thebelab-button thebelab-run-button'
      //.text("run")
      //.attr("title", "run this cell")
      .addClass("play-button-class")
      //.addClass("tooltip")
      //.append($("<span class=\"tooltiptext\">run this cell</span>"))
      .click(execute)
  )
  .append($cell_info)
  .append($status_badge_ok)
  .append($status_badge_unknown)
  .append($status_badge_running)
  .append($status_badge_error)
  .append($status_badge_warning);

  function hide_badges() {

    $status_badge_ok.hide();
    $status_badge_running.hide();
    $status_badge_unknown.hide();
    $status_badge_error.hide();
    $status_badge_warning.hide();

  }

  hide_badges();
  $status_badge_unknown.show();

  $cell.append($cm_element);
  $cell.append($cell_toolbar);

  // $cell.append(
  //   $("<button class='thebelab-button thebelab-run-button'>")
  //     .text("inspect")
  //     .attr("title", "inspect")
  //     .click(inspect)
  // );

  // $cell.append(
  //   $("<button class='thebelab-button thebelab-restart-button'>")
  //     .text("restart")
  //     .attr("title", "restart the kernel")
  //     .click(restart)
  // );

  // $cell.append(
  //   $("<button class='thebelab-button thebelab-restartall-button'>")
  //     .text("restart & run all")
  //     .attr("title", "restart the kernel and run all cells")
  //     .click(restartAndRunAll)
  // );

  let kernelResolve, kernelReject;
  let kernelPromise = new Promise((resolve, reject) => {
    kernelResolve = resolve;
    kernelReject = reject;
  });

  kernelPromise.then((kernel) => {
    $cell.data("kernel", kernel);
    manager.registerWithKernel(kernel);
    return kernel;
  });

  $cell.data("kernel-promise-resolve", kernelResolve);
  $cell.data("kernel-promise-reject", kernelReject);

  if ($output.length && mergedOptions.predefinedOutput) {
    outputArea.model.add({
      output_type: "display_data",
      data: {
        "text/html": $output.html(),
      },
    });
    $output.remove();
  }

  // show the header when a code cell receives focus
  $cell.focusin( (event) => {

    console.info("focusin");
    var header = document.getElementById("site-header");
    header.style.top = 0;
    header.style["box-shadow"] = "0 7px 8px rgba(0, 0, 0, 0.12)";

  });

  function setOutputText(text = "Waiting for kernel...", name = "stdout") {
    outputArea.model.clear();

    if (text != "") {

      outputArea.model.add({
        output_type: "stream",
        name: name,
        text,
      });
    }
  }

  // send a requestComplete
  function complete(agdaCMD="") {

    console.info("complete");

    let kernel = $cell.data("kernel");
    let code = cm.getValue();

    if (!kernel) {
      console.debug("No kernel connected");
      appendKernelMessage("No kernel connected");
      setOutputText();
      events.trigger("request-kernel");
    }

    kernelPromise.then((kernel) => {
  
      let expr = { "persistent": "no", "unicodeComplete": "no", "loadFromStore": "no", "username": "", "password": "", "agdaCMD": agdaCMD };
      let request = { code: code, user_expressions: expr };
  
      try {
        const future = kernel.requestExecute(request);
        future.onReply = function (reply) {

          let content = reply.content;
          let status = content.status;
          // let user_expressions = content.user_expressions;
          // let new_code = user_expressions.code;
          // let result = user_expressions.result;

          if (status != "error") {

            let pos = cm.getCursor();
            let index = cm.indexFromPos(pos);
      
            console.info("Current cursor position:", pos);
      
            kernel.requestComplete({code: code, cursor_pos: index}).then(msg => {
              const response = msg.content;
              let matches = response.matches;
      
              console.info("Complete response: ", response);
      
              if (response.status === 'error') {
      
                if(matches.length >= 1) {
                  let text = matches[0];
                  setOutputText(text, "stderr");
                }
      
              }
              else if (response.status === 'ok') {
        
                let start = response.cursor_start;
                let end = response.cursor_end;
                let start_pos = cm.posFromIndex(start);
                let end_pos = cm.posFromIndex(end);

                if(matches.length == 1) {
      
                  let match = matches[0];
                  //let metadata = response.metadata; // unused
                  console.info("Got a single match:", match);
                  cm.replaceRange(match, start_pos, end_pos);
      
                  // reload the cell after substitution
                  execute();
                  
                }
                // if more than one match, just display the result (for now)
                // if more than one match, show a dropdown selection menu
                else if (matches.length >= 2) {

                  var hintFun = function (cm, options) {
                    return {list: matches, from: start_pos, to: end_pos};
                  };
                  
                  var hintAutoOptions = {...hintOptions, hint: hintFun};
                  cm.showHint(hintAutoOptions);

                }
                else {
                  setOutputText("no matches");
                }
              }
      
            });

          }
          else {
            if (status == "error") {
              console.log("got error: ", result);
              //$status_badge_error.show();
              process_new_output(result);
            }
          }
        }

      } catch (error) {
        setOutputText("`Failed to execute. ${error} Please refresh the page.`", "stderr");
      }

    });
    return false;

  }

  // inspect the current cursor position
  function inspect() {

    console.info("inspect");

    let kernel = $cell.data("kernel");
    let code = cm.getValue();

    if (!kernel) {
      console.debug("No kernel connected");
      setOutputText();
      events.trigger("request-kernel");
    }
    kernelPromise.then((kernel) => {

      let pos = cm.getCursor();
      let index = cm.indexFromPos(pos);

      console.info("Current cursor position:", pos);

      kernel.requestInspect({ code: code, cursor_pos: index, detail_level: 0 }).then(msg => {
        const response = msg.content;
  
        console.info("inspect response: ", response);

        //if (response.status !== 'ok' || !response.found) {
        //  throw new Error('Inspection fetch failed to return successfully.');
        //}
  
        let result = response.data['text/plain'];
        //response.metadata

        console.info("inspect result:", result);

        setOutputText(result);        
      });
      ;
    });
    return false;

  }

  function highlight_hole(where) {

    cm.addLineClass(where, "background", "compile-hole");

  }

  function highlight_error(from, to) {

    console.info("Highlighting error from line " + from + " to line " + to);

    for (var lineno = from; lineno <= to; lineno++) {
        cm.addLineClass(lineno - 1, "background", "compile-error");
    }

  }

  function remove_all_highlights() {

    cm.eachLine(function(lineHandle) {
        cm.removeLineClass(lineHandle, "background", "compile-error");
        cm.removeLineClass(lineHandle, "background", "compile-hole");
    });

    cm.refresh();
  };

  function process_new_output(output) {

    /* output examples
        *All Errors*: /Users/lorenzo/Dropbox/Workspace/teaching/Teaching/2018-2019/summer semester/LDI (logika dla informatyków)/lab/agda/raw_material/test.agda:2,1-7
        The following names are declared but not accompanied by a
        definition: error1
        *Error*: /Users/lorenzo/Dropbox/Workspace/teaching/Teaching/2018-2019/summer semester/LDI (logika dla informatyków)/lab/agda/raw_material/code/coinduction.agda:53,27-28
        Data.Product.Σ P (λ x → Q) !=< P of type Set
        when checking that the expression A has type NFA Σ (P × Q)
        *Error*: /Users/lorenzo/Dropbox/Workspace/teaching/Teaching/2018-2019/summer semester/LDI (logika dla informatyków)/lab/agda/raw_material/test.agda:5,8-8
        /Users/lorenzo/Dropbox/Workspace/teaching/Teaching/2018-2019/summer semester/LDI (logika dla informatyków)/lab/agda/raw_material/test.agda:5,8: Parse error
        <EOF><ERROR>
        ...
        *All Goals, Errors*: ?0 : _58
        Sort _57  [ at /Users/lorenzo/Dropbox/Workspace/teaching/Teaching/2018-2019/summer semester/LDI (logika dla informatyków)/lab/agda/raw_material/code/coinduction.agda:53,27-30 ]
        _58 : _57  [ at /Users/lorenzo/Dropbox/Workspace/teaching/Teaching/2018-2019/summer semester/LDI (logika dla informatyków)/lab/agda/raw_material/code/coinduction.agda:53,27-30 ]
        _61 : NFA Σ (P × Q)  [ at /Users/lorenzo/Dropbox/Workspace/teaching/Teaching/2018-2019/summer semester/LDI (logika dla informatyków)/lab/agda/raw_material/code/coinduction.agda:53,27-30 ]
        ———— Errors ————————————————————————————————————————————————
        Failed to solve the following constraints:
        _60 := (_ : _58) [?] :? NFA Σ (P × Q)
    */

    //var new_output = String(output);

    if (output == "OK") {
        //unmake_cell_yellow(cell);
        //make_cell_green(cell);
        return;
    }

    // if there is an error
    if (output.match(/^\*Error\*|\*All Errors\*|\*All Warnings\*|\*All Goals, Errors\*|\*All Errors, Warnings\*|\*All Goals, Errors, Warnings\*|\*All Goals, Warnings\*/)) {

        var re = /(\/.*\/((?![\/]).*\.agda))\:(\d+),\d+-(\d+)(,\d+)?/g;
        var matches = output.matchAll(re);

        for (const match of matches) {

            //console.log("[agda-extension] found a match \"" + match + "\"");
            //console.log("[agda-extension] 0: \"" + match[0] + "\", ", "1: \"" + match[1] + "\", ", "2: \"" + match[2] + "\"" + "\", ", "3: \"" + match[3] + "\"");

            var long_fname = match[1];
            var fname = match[2];
            var from = match[3];

            // adjust if this cell uses a default prequel
            //if (cell.metadata.preambleLength)
            //    from -= Number(cell.metadata.preambleLength);

            var to = from;

            if (match[5] !== undefined) {
                to = match[4];
            }

            // check whether the error is in this cell
            //if (long_fname === cell.metadata.fileName)
                highlight_error(from, to);

            // shorten the filename for readability
            //console.log("[agda-extension] replacing full filename \"" + long_fname + "\", with: \"" + fname + "\"");

            //var re1 = new RegExp(escape(long_fname), "g");
            //new_output = new_output.replace(re1, fname);
        }

    }

  //    return new_output;
  }

  let firstTime = true;
  let stausOKSet = false;

  // execute a cell
  function execute(agdaCMD=null) {
    let kernel = $cell.data("kernel");
    let code = cm.getValue();

    // setup the options

    let persistent = "no";
    let loadFromStore = "no";

    console.info("kernelOptions.persistent = ", kernelOptions.persistent);

    if (kernelOptions.persistent) {
      console.info("Cell changes are persistent");
      persistent = "yes";
    }
    else {
      console.info("Cell changes are not persistent");
    }

    if (firstTime && kernelOptions.loadFromStore) {
      console.info("Loading from kernel store");
      loadFromStore = "yes";
    }
    else {
      console.info("Not loading from kernel store");
    }

    let username = localStorage.getItem("input-username");
    let password = localStorage.getItem("input-password");

    let expr = { "persistent": persistent, "unicodeComplete": "no", "loadFromStore": loadFromStore, "username": username, "password": password, "agdaCMD": agdaCMD, "sendInfoMessages": "yes" };

    remove_all_highlights();

    //    $status_badge.addClass();
    //    $status_badge.addClass("status-badge");
    //    $status_badge.addClass("status-badge-running");
    hide_badges();
    $status_badge_running.show();

    let request = { code: code, user_expressions: expr };

    if (!kernel) {
      console.info("No kernel connected");
      setOutputText();
      events.trigger("request-kernel");
    }

    kernelPromise.then((kernel) => {
      try {
        console.info('Sending kernel request: ', request);
        const future = kernel.requestExecute(request);
        console.info("got future: ", future);

        future.done.then(function() {
          console.info('Future is fulfilled');
        });

        // the output generated by execute is asynchronously sent to the output area
        outputArea.future = future;
        var onIOPubOld = future.onIOPub;

        infoArea.model.clear();
        theImg.style.visibility = "hidden";

        future.onIOPub = function (msg) {
          console.info('Got onIOPub: ', msg);

          var content = msg.content;
          var name = content.name;

          // if a standard message is returned, then just continue the standard chain
          if (name != "stdinfo") {
            return onIOPubOld(msg);
          }

          // handle custom Agda kernel info messages
          var text = content.text;

          if (text != "") {
            infoArea.model.add({
              output_type: "stream",
              name: "stdout",
              text: text,
            });

            theImg.style.visibility = "visible";      
          }
        }

        future.onReply = function (reply) {
          console.info('Got execute reply', reply);

          let content = reply.content;
          let status = content.status;
          let user_expressions = content.user_expressions;
          let new_code = user_expressions.code;
          let result = user_expressions.result;

          console.info('Got user_expressions', user_expressions);

          if (firstTime && "code" in user_expressions) {
            console.info('Set new code');

            let old_code = cm.getValue();
            console.info('Old code: ', old_code);
            console.info('Got new code', new_code);

            cm.setValue(new_code);
            foldHeader(cm, true);

            // need to reset the firstTime flag asynchronously here,
            // otherwise it will be reset too quickly
            firstTime = false;
          }

          hide_badges();
          let thereAreHoles = false;

          if ("holes" in user_expressions && user_expressions["holes"].length > 0 && status == "ok") {

            $status_badge_warning.show();
            thereAreHoles = true;

            var holes = user_expressions["holes"];
            console.info('There are holes: ', holes);

            for (const hole of holes) {
                console.log("Processing hole: ", hole);
                highlight_hole(hole);
            }

            // not very visible against white background
            //if (holes.length > 0)
            //    cell.moduleName_element.find(".module-name-text").addClass("compile-hole");
            //else
            //    cell.moduleName_element.find(".module-name-text").removeClass("compile-hole");

          }
          else {
            console.info('No holes returned.');
          }

          if (status == "ok" && !thereAreHoles) {
            //unmake_cell_yellow(cell);
            //make_cell_green(cell);

            // $status_badge.removeClass();
            // $status_badge.addClass("status-badge");
            // $status_badge.addClass("status-badge-ok");

            $status_badge_ok.show();

            if(!stausOKSet) {
              numberOfOKCells++;
              stausOKSet = true;
            }
          }
          else {

            if (status == "error") {

              console.log("got error: ", result);
              // $status_badge.removeClass();
              // $status_badge.addClass("status-badge");
              // $status_badge.addClass("status-badge-error");

              $status_badge_error.show();
              process_new_output(result);

            }

            if (stausOKSet) {
              numberOfOKCells--;
              stausOKSet = false;
            }
          }

          updateCellCounts();
        };

      } catch (error) {
        setOutputText(`Failed to execute. ${error} Please refresh the page.`, "stderr");
      }
    });

    return false;
  }

  function restart() {
    let kernel = $cell.data("kernel");

    if (kernel) {
      return kernelPromise.then(async (kernel) => {
        console.log("Restarting kernel...");
        await kernel.restart();
        return kernel;
      });
    }
    else {
      console.log("No kernel to restart.");
    }
    return Promise.resolve(kernel);
  }

  function restartAndRunAll() {
    if (window.thebelab) {
      window.thebelab.cells.map((idx, { setOutputText }) => setOutputText());
    }
    restart().then((kernel) => {
      if (!kernel || !window.thebelab) return kernel;
      // Note, the jquery map is overridden, and is in the opposite order of native JS
      window.thebelab.cells.map((idx, { execute }) => execute());
      return kernel;
    });
  }

  let theDiv = document.createElement("div");
  $cell.append(theDiv);
  Widget.attach(outputArea, theDiv);

  // attach the info area after the output area
  let theOtherDiv = document.createElement("div");
  $cell.append(theOtherDiv);
  Widget.attach(infoArea, theOtherDiv);

  // create the show / hide icon for the info area
  let theSpan = document.createElement("span");
  theDiv.firstElementChild.appendChild(theSpan);
  let theImg = document.createElement("img");

  let infoAreaVisible = false;
  theImg.classList.add("info-area-button");
  theImg.classList.add("show-info-area");

  theImg.addEventListener("click", function() {

    if (infoAreaVisible) {
      theImg.classList.remove("hide-info-area");
      theImg.classList.add("show-info-area");

      infoArea.node.style.display = "none";
    }
    else {
      theImg.classList.remove("show-info-area");
      theImg.classList.add("hide-info-area");  

      infoArea.node.style.display = "block";
    }

    infoAreaVisible = !infoAreaVisible;

  });

  theSpan.append(theImg);

  const mode = $element.data("language") || "python";
  const isReadOnly = $element.data("readonly");

  console.log("Mode: ", mode);

  const required = {
    value: source,
    mode: mode,
    extraKeys: {
      "Shift-Enter": execute,
      //      "Cmd-F": cm => { console.info("Find...", find); find(); },
      "Ctrl-Q": cm => foldHeader(cm),
      Tab: (cm) => {
        if (cm.getMode().name === 'null') {
          cm.execCommand('insertTab');
        } else {
          if (cm.somethingSelected()) {
            cm.execCommand('indentMore');
          } else {
            cm.execCommand('insertSoftTab');
          }
        }
      },
      'Shift-Tab': (cm) => cm.execCommand('indentLess')
    },
  };
  if (isReadOnly !== undefined) {
    required.readOnly = isReadOnly !== false; //overrides codeMirrorConfig.readOnly for cell
  }
  //else
  //  required.readOnly = false;

  // Gets CodeMirror config if it exists
  let codeMirrorOptions = {};
  // if ("binderOptions" in mergedOptions) {
  //   if ("codeMirrorConfig" in mergedOptions.binderOptions) {
  //     codeMirrorOptions = mergedOptions.binderOptions.codeMirrorConfig;
  //   }
  // }
  // it should really be a top-level group of options
  if ("codeMirrorConfig" in mergedOptions) {
      codeMirrorOptions = mergedOptions.codeMirrorConfig;
  }

  // Dynamically loads CSS for a given theme
  if ("theme" in codeMirrorOptions) {
    //require(`codemirror/theme/${codeMirrorOptions.theme}.css`);
  }

  let codeMirrorConfig = Object.assign(codeMirrorOptions || {}, required);
  let cm = new CodeMirror($cm_element[0], codeMirrorConfig);

  console.log("CodeMirror cm: ", cm);

  Mode.ensure(mode).then((modeSpec) => {
    cm.setOption("mode", mode);

    console.log("adding autocomplete for mode = ", mode);

    var resetChordCounter = 0;
    var resetChord = function(){

      resetChordCounter++;

      setTimeout(function(){

        resetChordCounter--;

        if(resetChordCounter == 0) {
          $cell_info.text("");
          ctrl_c = false;
        }
      }, 1000);}; // 1 sec

    // agda specific
    if (mode === "agda") {
      cm.addKeyMap(autocompleteKeyMap);
      cm.setOption("hintOptions", hintOptions);

      var agdaKeyMap = {

        "Cmd-F": function(cm) {
          console.log("pressed Cmd-F");
          cm.execCommand("replace");
          console.log("getSearchCursor: ", cm.getSearchCursor);
        },

        "Cmd-G": function(cm) {
          console.log("pressed Cmd-G");
          cm.execCommand("findNext");
        },

        // conflicts with removing tabs;
        // inspect
        // "Shift-Tab": function(cm){
        
        // console.log("pressed shift-tab");
        // inspect();

        // },

        'Cmd-/': function(cm) {
          console.log("pressed Cmd-/");
          cm.toggleComment();
        },
      
        "Ctrl-C": function(cm){
        
          console.log("pressed Ctrl-c");

          if(ctrl_c) {

            console.log("pressed Ctrl-c+Ctrl-c");
            $cell_info.text("Ctrl-c+Ctrl-c");
            ctrl_c = false;
            complete("Cmd_make_case");

          }
          else {
            ctrl_c = true;
            $cell_info.text("Ctrl-c+");
          }

          resetChord();

        },

        "Ctrl-L": function(cm){
        
          if(ctrl_c) {
            console.log("pressed Ctrl-c+Ctrl-l");
            $cell_info.text("Ctrl-c+Ctrl-l");
            ctrl_c = false;
            resetChord();
            execute();
          }

  
        },

        "Ctrl-,": function(cm){
        
          if(ctrl_c) {
            console.log("pressed Ctrl-c+Ctrl-,");
            $cell_info.text("Ctrl-c+Ctrl-,");
            ctrl_c = false;
            resetChord();
            inspect();
          }
  
        },

        "Ctrl-Space": function(cm){
        
          if(ctrl_c) {
            console.log("pressed Ctrl-c+Ctrl-Space");
            $cell_info.text("Ctrl-c+Ctrl-Space");
            ctrl_c = false;
            resetChord();
            complete("Cmd_give"); // give
          }
  
        },

        "Ctrl-A": function(cm){
        
          if(ctrl_c) {
            console.log("pressed Ctrl-c+Ctrl-a");
            $cell_info.text("Ctrl-c+Ctrl-a");
            ctrl_c = false;
            complete("Cmd_auto"); // auto

            resetChord();
          }
          else {
            // fall-back on the standard behaviour if not inside a chord
            cm.execCommand("goLineStart");
          }
  
        },

        "Ctrl-R": function(cm){
        
          if(ctrl_c) {
            console.log("pressed Ctrl-c+Ctrl-r");
            $cell_info.text("Ctrl-c+Ctrl-r");
            ctrl_c = false;
            complete("Cmd_refine_or_intro"); // refine

            resetChord();
          }

        }
      };

      cm.addKeyMap(agdaKeyMap);

      console.log("added autocomplete for mode = ", mode);
    } else {
      cm.removeKeyMap(autocompleteKeyMap);
      cm.setOption("hintOptions", undefined);
    }

  });

  if (cm.isReadOnly()) {
    cm.display.lineDiv.setAttribute("data-readonly", "true");
    $cm_element[0].setAttribute("data-readonly", "true");
    $cell.attr("data-readonly", "true");
  }

  // browser storage facility for cell code

  console.info("registering text change handler for cell with id = ", cell_id);

  var key = "input-" + cell_id;
  var storedCode = localStorage.getItem(key);

  console.info("Stored code: ", storedCode);

  // if there is a stored code, use it
  if (kernelOptions.loadFromStore && storedCode) {
      console.info("restoring stored code");
      cm.setValue(storedCode);
  }
  // if there is no stored value, store the current value
  else {
    console.info("NOT restoring stored code");
    localStorage.setItem(key, cm.getValue());
  }

  // add a even handler on changing the code text
  cm.on('change', cm => {
    localStorage.setItem(key, cm.getValue());
  });

  // code folding
  foldHeader(cm, firstTime=true);

  return { cell: $cell, execute, setOutputText };
}

export function renderAllCells({ selector = _defaultOptions.selector } = {}) {
  // render all elements matching `selector` as cells.
  // by default, this is all cells with `data-executable`

  let manager = new ThebeManager({
    loader: requireLoader,
  });

  return $(selector).map((i, cell) =>
    renderCell(cell, {
      manager: manager,
    })
  );
}

export function hookupKernel(kernel, cells, options) {
  // hooks up cells to the kernel
  cells.map((i, { cell }) => {
    $(cell).data("kernel-promise-resolve")(kernel);
  });

  // automatically run all cells on init
  if(options.runAllCells) {
    console.info("runAllCells = true => running all cells");
    runAllCells();
  }
  else {
    console.info("runAllCells = false => do NOT run all cells on init");
  }
}

function appendKernelMessage(message) {

  let elem = document.getElementById("kernel-messages"); //$(".kernel-messages");
  //elem.append($("<p>").text(message));

  var isScrolledToBottom = elem.scrollHeight - elem.clientHeight <= elem.scrollTop + 1;

  var newElem = document.createElement("div");
  newElem.innerHTML = message;
  elem.appendChild(newElem);

  if(isScrolledToBottom)
    elem.scrollTop = elem.scrollHeight - elem.clientHeight;

}

function setKernelConnected() {

  // kernel icon ready
  let kernel_status = $(".kernel-status-button");
  kernel_status.addClass();
  kernel_status.addClass("kernel-status-button");
  kernel_status.addClass("kernel-status-button-connected");

  appendKernelMessage("Kernel connected.");
} 

function setKernelDisonnected() {

  // kernel icon unready
  let kernel_status = $(".kernel-status-button");
  kernel_status.addClass();
  kernel_status.addClass("kernel-status-button");
  kernel_status.addClass("kernel-status-button-disconnected");

  appendKernelMessage("Kernel disconnected.");
} 

// requesting Kernels

export function requestKernel(kernelOptions) {
  // request a new Kernel
  kernelOptions = mergeOptions({ kernelOptions }).kernelOptions;
  let serverSettings = ServerConnection.makeSettings(
    kernelOptions.serverSettings
  );
  events.trigger("status", {
    status: "starting",
    message: "Starting Kernel",
  });
  let km = new KernelManager({ serverSettings });

  km.onerror = function(event) {
  
    console.error("Kernel manager ERROR: ", event);
    
  }

  return km.ready
    .then(() => {
      return km.startNew(kernelOptions);
    })
    .then((kernel) => {
      events.trigger("status", {
        status: "ready",
        message: "Kernel is ready",
        kernel: kernel,
      });
      return kernel;
    });
}

export function requestBinderKernel({ binderOptions, kernelOptions }) {
  // request a Kernel from Binder
  // this strings together requestBinder and requestKernel.
  // returns a Promise for a running Kernel.
  return requestBinder(binderOptions).then((serverSettings) => {
    kernelOptions.serverSettings = serverSettings;
    return requestKernel(kernelOptions);
  });
}

export function requestBinder({
  repo,
  ref = "master",
  binderUrl = null,
  repoProvider = "",
  savedSession = _defaultOptions.binderOptions.savedSession,
} = {}) {
  // request a server from Binder
  // returns a Promise that will resolve with a serverSettings dict

  // populate from defaults
  let defaults = mergeOptions().binderOptions;
  if (!repo) {
    repo = defaults.repo;
    repoProvider = "";
  }
  console.log("binder url", binderUrl, defaults);
  binderUrl = binderUrl || defaults.binderUrl;
  ref = ref || defaults.ref;
  savedSession = savedSession || defaults.savedSession;
  savedSession = $.extend(true, defaults.savedSession, savedSession);

  let url;

  if (repoProvider.toLowerCase() === "git") {
    // trim trailing or leading '/' on repo
    repo = repo.replace(/(^\/)|(\/?$)/g, "");
    // trailing / on binderUrl
    binderUrl = binderUrl.replace(/(\/?$)/g, "");
    //convert to URL acceptable string. Required for git
    repo = encodeURIComponent(repo);

    url = binderUrl + "/build/git/" + repo + "/" + ref;
  } else if (repoProvider.toLowerCase() === "gitlab") {
    // trim gitlab.com from repo
    repo = repo.replace(/^(https?:\/\/)?gitlab.com\//, "");
    // trim trailing or leading '/' on repo
    repo = repo.replace(/(^\/)|(\/?$)/g, "");
    // trailing / on binderUrl
    binderUrl = binderUrl.replace(/(\/?$)/g, "");
    //convert to URL acceptable string. Required for gitlab
    repo = encodeURIComponent(repo);

    url = binderUrl + "/build/gl/" + repo + "/" + ref;
  } else {
    // trim github.com from repo
    repo = repo.replace(/^(https?:\/\/)?github.com\//, "");
    // trim trailing or leading '/' on repo
    repo = repo.replace(/(^\/)|(\/?$)/g, "");
    // trailing / on binderUrl
    binderUrl = binderUrl.replace(/(\/?$)/g, "");

    url = binderUrl + "/build/gh/" + repo + "/" + ref;
  }
  console.log("Binder build URL", url);

  const storageKey = savedSession.storagePrefix + url;

  async function getExistingServer() {
    if (!savedSession.enabled) {
      return;
    }
    let storedInfoJSON = window.localStorage.getItem(storageKey);
    if (storedInfoJSON == null) {
      console.debug("No session saved in ", storageKey);
      return;
    }
    console.debug("Saved binder session detected");
    let existingServer = JSON.parse(storedInfoJSON);
    let lastUsed = new Date(existingServer.lastUsed);
    let ageSeconds = (new Date() - lastUsed) / 1000;
    if (ageSeconds > savedSession.maxAge) {
      console.debug(
        `Not using expired binder session for ${existingServer.url} from ${lastUsed}`
      );
      window.localStorage.removeItem(storageKey);
      return;
    }
    let settings = ServerConnection.makeSettings({
      baseUrl: existingServer.url,
      wsUrl: "ws" + existingServer.url.slice(4),
      token: existingServer.token,
      appendToken: true,
    });
    try {
      await KernelAPI.listRunning(settings);
    } catch (err) {
      console.log(
        "Saved binder connection appears to be invalid, requesting new session",
        err
      );
      window.localStorage.removeItem(storageKey);
      return;
    }
    // refresh lastUsed timestamp in stored info
    existingServer.lastUsed = new Date();
    window.localStorage.setItem(storageKey, JSON.stringify(existingServer));
    let message = `Saved binder session is valid, reusing connection to ${existingServer.url}`
    console.log(message);
    appendKernelMessage(message);
    return settings;
  }

  return new Promise(async (resolve, reject) => {
    // if binder already spawned our server and we remember the creds
    // try to reuse it
    let existingServer;
    try {
      existingServer = await getExistingServer();
    } catch (err) {
      // catch unhandled errors such as JSON parse errors,
      // invalid formats, permission error on localStorage, etc.
      console.error("Failed to load existing server connection", err);
    }

    if (existingServer) {
      // found an existing server
      // return it instead of requesting a new one
      resolve(existingServer);
      return;
    }

    events.trigger("status", {
      status: "building",
      message: "Requesting build from binder",
    });

    let es = new EventSource(url);
    es.onerror = (err) => {
      console.error("Lost connection to " + url, err);
      es.close();
      events.trigger("status", {
        status: "failed",
        message: "Lost connection to Binder",
        error: err,
      });
      reject(new Error(err));
    };
    let phase = null;
    es.onmessage = (evt) => {
      let msg = JSON.parse(evt.data);
      if (msg.phase && msg.phase !== phase) {
        phase = msg.phase.toLowerCase();
        console.log("Binder phase: " + phase);
        let status = phase;
        if (status === "ready") {
          status = "server-ready";
        }
        events.trigger("status", {
          status: status,
          message: "Binder is " + phase,
          binderMessage: msg.message,
        });
      }
      if (msg.message) {
        console.log("Binder: " + msg.message);
        appendKernelMessage("Binder: " + msg.message);
      }
      switch (msg.phase) {
        case "failed":
          console.error("Failed to build", url, msg);
          es.close();
          reject(new Error(msg));
          break;
        case "ready":
          es.close();
          try {
            // save the current connection url+token to reuse later
            window.localStorage.setItem(
              storageKey,
              JSON.stringify({
                url: msg.url,
                token: msg.token,
                lastUsed: new Date(),
              })
            );
          } catch (e) {
            // storage quota full, gently ignore nonfatal error
            console.warn(
              "Couldn't save thebe binder connection info to local storage",
              e
            );
          }

          resolve(
            ServerConnection.makeSettings({
              baseUrl: msg.url,
              wsUrl: "ws" + msg.url.slice(4),
              token: msg.token,
              appendToken: true,
            })
          );
          break;
        default:
        // console.log(msg);
      }
    };
  });
}

/**
 * Do it all in one go.

 * 1. load options
 * 2. run hooks
 * 3. render cells
 * 4. request a Kernel
 * 5. hook everything up

 * @param {Object} options Object containing thebe options.
 * Same structure as x-thebe-options.
 * @returns {Promise} Promise for connected Kernel object

 */

export function bootstrap(options) {
  // bootstrap thebe on the page
  // merge defaults, pageConfig, etc.
  options = mergeOptions(options);

  if (options.preRenderHook) {
    options.preRenderHook();
  }
  if (options.stripPrompts) {
    stripPrompts(options.stripPrompts);
  }
  if (options.stripOutputPrompts) {
    stripOutputPrompts(options.stripOutputPrompts);
  }

  // bootstrap thebelab on the page
  let cells = renderAllCells({
    selector: options.selector,
  });

  function getKernel() {
    if (options.binderOptions.repo) {
      return requestBinderKernel({
        binderOptions: options.binderOptions,
        kernelOptions: options.kernelOptions,
      });
    } else {
      return requestKernel(options.kernelOptions);
    }
  }

  let kernelPromise;
  if (options.requestKernel) {
    kernelPromise = getKernel();
  } else {
    kernelPromise = new Promise((resolve, reject) => {
      events.one("request-kernel", () => {
        getKernel().then(resolve).catch(reject);
      });
    });
  }

  kernelPromise.then((kernel) => {
      // debug
      if (typeof window !== "undefined")
        window.thebeKernel = kernel;
        
      setKernelConnected();
      hookupKernel(kernel, cells, options);
  }).catch((e) => {
    
    console.info("Set kernel disconnected");

    let msg = "Kernel promise ERROR: " + e;
    console.error(msg);
    appendKernelMessage(msg);
    setKernelDisonnected();

  });

  if (window.thebelab) window.thebelab.cells = cells;

  let run_all = document.getElementById("run-all");

  run_all.addEventListener("click", function() {
    console.info("run-all click runAllCells");
    runAllCells();
  });

  return kernelPromise;
}

function splitCell(element, { inPrompt, continuationPrompt } = {}) {
  let rawText = element.text().trim();
  if (rawText.indexOf(inPrompt) == -1) {
    return element;
  }
  let cells = [];
  let cell = null;
  rawText.split("\n").map((line) => {
    line = line.trim();
    if (line.slice(0, inPrompt.length) === inPrompt) {
      // line with a prompt
      line = line.slice(inPrompt.length) + "\n";
      if (cell) {
        cell += line;
      } else {
        cell = line;
      }
    } else if (
      continuationPrompt &&
      line.slice(0, continuationPrompt.length) === continuationPrompt
    ) {
      // line with a continuation prompt
      cell += line.slice(continuationPrompt.length) + "\n";
    } else {
      // output line
      if (cell) {
        cells.push(cell);
        cell = null;
      }
    }
  });
  if (cell) {
    cells.push(cell);
  }
  // console.log("cells: ", cells);
  // clear the parent element
  element.html("");
  // add the thebe-able cells
  cells.map((cell) => {
    element.append($("<executable-pre>").text(cell).attr("data-executable", "true"));
  });
}

function splitCellOutputPrompt(element, { outPrompt } = {}) {
  let rawText = element.text().trim();
  if (rawText.indexOf(outPrompt) == -1) {
    return element;
  }
  let cells = [];
  let cell = null;
  rawText.split("\n").map((line) => {
    line = line.trim();
    if (line.slice(0, outPrompt.length) === outPrompt) {
      // output line
      if (cell) {
        cells.push(cell);
        cell = null;
      }
    } else {
      // input line
      if (cell) {
        cell += line + "\n";
      } else {
        cell = line + "\n";
      }
    }
  });
  if (cell) {
    cells.push(cell);
  }
  // console.log("cells: ", cells);
  // clear the parent element
  element.html("");
  // add the thebe-able cells
  cells.map((cell) => {
    element.append($("<pre>").text(cell).attr("data-executable", "true"));
  });
}

export function stripPrompts(options) {
  // strip prompts from a
  $(options.selector).map((i, el) => splitCell($(el), options));
}

export function stripOutputPrompts(options) {
  // strip prompts from a
  $(options.selector).map((i, el) => splitCellOutputPrompt($(el), options));
}
