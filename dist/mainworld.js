"use strict";
(() => {
  // src/mainworld/react-key-stamper.ts
  var CHAT_LIST_SELECTOR = "#chatroom-messages .no-scrollbar";
  var ROW_SELECTOR = "[data-index]";
  var REACT_FIBER_PROPERTY_PREFIX = "__reactFiber";
  var MID_ATTR = "data-kickflow-mid";
  var DEBUG_SAMPLE_LIMIT = 25;
  var debugSamples = 0;
  function debugEnabled() {
    try {
      return window.localStorage.getItem("kickflow.debug") === "1";
    } catch {
      return false;
    }
  }
  function rawReactKey(el) {
    try {
      const prop = Object.getOwnPropertyNames(el).find((name) => name.startsWith(REACT_FIBER_PROPERTY_PREFIX));
      const key = prop ? el[prop]?.key : null;
      return typeof key === "string" && key ? key : null;
    } catch {
      return null;
    }
  }
  var REACT_MESSAGE_KEY = /^(\d+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
  function parseMessageId(key) {
    return REACT_MESSAGE_KEY.exec(key)?.[2] ?? null;
  }
  function readMessageId(row) {
    const rawKey = rawReactKey(row);
    return rawKey ? parseMessageId(rawKey) : null;
  }
  function stampRow(row) {
    const rawKey = rawReactKey(row);
    const messageId = rawKey ? parseMessageId(rawKey) : null;
    if (messageId) {
      if (row.getAttribute(MID_ATTR) !== messageId) {
        row.setAttribute(MID_ATTR, messageId);
      }
    } else if (row.hasAttribute(MID_ATTR)) {
      row.removeAttribute(MID_ATTR);
    }
    if (debugEnabled() && debugSamples < DEBUG_SAMPLE_LIMIT) {
      debugSamples++;
      if (rawKey && !messageId) {
        console.debug("[kickflow-mainworld] unexpected React row key shape; skipped stamping", rawKey);
      } else {
        console.debug("[kickflow-mainworld] key", rawKey, "-> mid", messageId);
      }
    }
  }
  function collectRows(node) {
    if (!(node instanceof HTMLElement)) return [];
    const rows = [];
    if (node.matches(ROW_SELECTOR)) rows.push(node);
    rows.push(...Array.from(node.querySelectorAll(ROW_SELECTOR)));
    return rows;
  }
  function closestRow(node) {
    if (!(node instanceof HTMLElement)) return node.parentElement?.closest(ROW_SELECTOR) ?? null;
    return node.matches(ROW_SELECTOR) ? node : node.closest(ROW_SELECTOR);
  }
  function stampExistingRows(list) {
    list.querySelectorAll(ROW_SELECTOR).forEach(stampRow);
  }
  function initReactKeyStamper(root = document) {
    const ownerDocument = root instanceof Document ? root : root.ownerDocument;
    const observerRoot = root instanceof Document ? ownerDocument.body : root;
    const MutationObserverCtor = ownerDocument.defaultView?.MutationObserver ?? MutationObserver;
    let observedList = null;
    let listObserver = null;
    let bodyObserver = null;
    const delayedPasses = /* @__PURE__ */ new Set();
    const restampCurrentList = () => {
      if (!observedList) return;
      observedList.querySelectorAll(ROW_SELECTOR).forEach((row) => {
        const currentId = row.getAttribute(MID_ATTR);
        const nextId = readMessageId(row);
        if (!currentId || currentId !== nextId) {
          stampRow(row);
        }
      });
    };
    const scheduleDelayedRestamps = () => {
      for (const delayMs of [100, 1e3]) {
        const timeoutId = window.setTimeout(() => {
          delayedPasses.delete(timeoutId);
          restampCurrentList();
        }, delayMs);
        delayedPasses.add(timeoutId);
      }
    };
    const detachObservedList = () => {
      listObserver?.disconnect();
      listObserver = null;
      observedList = null;
    };
    const observeList = (list) => {
      if (list === observedList) return;
      listObserver?.disconnect();
      observedList = list;
      stampExistingRows(list);
      scheduleDelayedRestamps();
      listObserver = new MutationObserverCtor((mutations) => {
        for (const mutation of mutations) {
          const targetRow = closestRow(mutation.target);
          if (targetRow) stampRow(targetRow);
          for (const node of mutation.addedNodes) {
            collectRows(node).forEach(stampRow);
          }
        }
      });
      listObserver.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-index"] });
    };
    const attachToCurrentList = () => {
      const list = root.querySelector(CHAT_LIST_SELECTOR);
      if (list) {
        observeList(list);
      } else if (observedList) {
        detachObservedList();
      }
    };
    attachToCurrentList();
    bodyObserver = new MutationObserverCtor((records) => {
      const currentWasDetached = observedList !== null && !observedList.isConnected;
      const couldIntroduceList = observedList === null && records.some(
        (record) => Array.from(record.addedNodes).some((node) => node instanceof Element && (node.matches(CHAT_LIST_SELECTOR) || node.querySelector(CHAT_LIST_SELECTOR) !== null))
      );
      if (currentWasDetached || couldIntroduceList) attachToCurrentList();
    });
    if (observerRoot) {
      bodyObserver.observe(observerRoot, { childList: true, subtree: true });
    }
    const intervalId = window.setInterval(() => {
      attachToCurrentList();
      restampCurrentList();
    }, 1e3);
    return {
      restampCurrentList,
      teardown() {
        detachObservedList();
        bodyObserver?.disconnect();
        window.clearInterval(intervalId);
        delayedPasses.forEach((timeoutId) => window.clearTimeout(timeoutId));
        delayedPasses.clear();
        bodyObserver = null;
      }
    };
  }
  var autoController = null;
  function start() {
    autoController ??= initReactKeyStamper();
  }
  if (document.body) {
    start();
  } else {
    window.addEventListener("DOMContentLoaded", start, { once: true });
  }
  window.addEventListener("pagehide", () => {
    autoController?.teardown();
    autoController = null;
  });
  window.addEventListener("pageshow", start);
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL21haW53b3JsZC9yZWFjdC1rZXktc3RhbXBlci50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiZXhwb3J0IGNvbnN0IENIQVRfTElTVF9TRUxFQ1RPUiA9ICcjY2hhdHJvb20tbWVzc2FnZXMgLm5vLXNjcm9sbGJhcic7XHJcbmV4cG9ydCBjb25zdCBST1dfU0VMRUNUT1IgPSAnW2RhdGEtaW5kZXhdJztcclxuZXhwb3J0IGNvbnN0IFJFQUNUX0ZJQkVSX1BST1BFUlRZX1BSRUZJWCA9ICdfX3JlYWN0RmliZXInO1xyXG5jb25zdCBNSURfQVRUUiA9ICdkYXRhLWtpY2tmbG93LW1pZCc7XHJcbmNvbnN0IERFQlVHX1NBTVBMRV9MSU1JVCA9IDI1O1xyXG5cclxubGV0IGRlYnVnU2FtcGxlcyA9IDA7XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIFJlYWN0S2V5U3RhbXBlckNvbnRyb2xsZXIge1xyXG4gIHJlc3RhbXBDdXJyZW50TGlzdCgpOiB2b2lkO1xyXG4gIHRlYXJkb3duKCk6IHZvaWQ7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGRlYnVnRW5hYmxlZCgpOiBib29sZWFuIHtcclxuICB0cnkge1xyXG4gICAgcmV0dXJuIHdpbmRvdy5sb2NhbFN0b3JhZ2UuZ2V0SXRlbSgna2lja2Zsb3cuZGVidWcnKSA9PT0gJzEnO1xyXG4gIH0gY2F0Y2gge1xyXG4gICAgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gcmF3UmVhY3RLZXkoZWw6IEVsZW1lbnQpOiBzdHJpbmcgfCBudWxsIHtcclxuICB0cnkge1xyXG4gICAgY29uc3QgcHJvcCA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKGVsKS5maW5kKChuYW1lKSA9PiBuYW1lLnN0YXJ0c1dpdGgoUkVBQ1RfRklCRVJfUFJPUEVSVFlfUFJFRklYKSk7XHJcbiAgICBjb25zdCBrZXkgPSBwcm9wID8gKGVsIGFzIHVua25vd24gYXMgUmVjb3JkPHN0cmluZywgeyBrZXk/OiB1bmtub3duIH0gfCB1bmRlZmluZWQ+KVtwcm9wXT8ua2V5IDogbnVsbDtcclxuICAgIHJldHVybiB0eXBlb2Yga2V5ID09PSAnc3RyaW5nJyAmJiBrZXkgPyBrZXkgOiBudWxsO1xyXG4gIH0gY2F0Y2gge1xyXG4gICAgcmV0dXJuIG51bGw7XHJcbiAgfVxyXG59XHJcblxyXG5leHBvcnQgY29uc3QgUkVBQ1RfTUVTU0FHRV9LRVkgPSAvXihcXGQrKS0oWzAtOWEtZl17OH0tWzAtOWEtZl17NH0tWzAtOWEtZl17NH0tWzAtOWEtZl17NH0tWzAtOWEtZl17MTJ9KSQvaTtcclxuXHJcbi8qKiBSZWFjdCBjdXJyZW50bHkga2V5cyB2aXJ0dWFsaXplZCByb3dzIGFzIGBudW1lcmljLWluZGV4LVVVSURgLiBSZWplY3QgdW5leHBlY3RlZCBzaGFwZXNcclxuICogaW5zdGVhZCBvZiBzbGljaW5nIGFyYml0cmFyeSB0ZXh0IGludG8gYSBwbGF1c2libGUtYnV0LXdyb25nIG1lc3NhZ2UgaWQuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU1lc3NhZ2VJZChrZXk6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xyXG4gIHJldHVybiBSRUFDVF9NRVNTQUdFX0tFWS5leGVjKGtleSk/LlsyXSA/PyBudWxsO1xyXG59XHJcblxyXG5mdW5jdGlvbiByZWFkTWVzc2FnZUlkKHJvdzogSFRNTEVsZW1lbnQpOiBzdHJpbmcgfCBudWxsIHtcclxuICBjb25zdCByYXdLZXkgPSByYXdSZWFjdEtleShyb3cpO1xyXG4gIHJldHVybiByYXdLZXkgPyBwYXJzZU1lc3NhZ2VJZChyYXdLZXkpIDogbnVsbDtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHN0YW1wUm93KHJvdzogSFRNTEVsZW1lbnQpOiB2b2lkIHtcclxuICBjb25zdCByYXdLZXkgPSByYXdSZWFjdEtleShyb3cpO1xyXG4gIGNvbnN0IG1lc3NhZ2VJZCA9IHJhd0tleSA/IHBhcnNlTWVzc2FnZUlkKHJhd0tleSkgOiBudWxsO1xyXG5cclxuICBpZiAobWVzc2FnZUlkKSB7XHJcbiAgICBpZiAocm93LmdldEF0dHJpYnV0ZShNSURfQVRUUikgIT09IG1lc3NhZ2VJZCkge1xyXG4gICAgICByb3cuc2V0QXR0cmlidXRlKE1JRF9BVFRSLCBtZXNzYWdlSWQpO1xyXG4gICAgfVxyXG4gIH0gZWxzZSBpZiAocm93Lmhhc0F0dHJpYnV0ZShNSURfQVRUUikpIHtcclxuICAgIHJvdy5yZW1vdmVBdHRyaWJ1dGUoTUlEX0FUVFIpO1xyXG4gIH1cclxuXHJcbiAgaWYgKGRlYnVnRW5hYmxlZCgpICYmIGRlYnVnU2FtcGxlcyA8IERFQlVHX1NBTVBMRV9MSU1JVCkge1xyXG4gICAgZGVidWdTYW1wbGVzKys7XHJcbiAgICBpZiAocmF3S2V5ICYmICFtZXNzYWdlSWQpIHtcclxuICAgICAgY29uc29sZS5kZWJ1ZygnW2tpY2tmbG93LW1haW53b3JsZF0gdW5leHBlY3RlZCBSZWFjdCByb3cga2V5IHNoYXBlOyBza2lwcGVkIHN0YW1waW5nJywgcmF3S2V5KTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGNvbnNvbGUuZGVidWcoJ1traWNrZmxvdy1tYWlud29ybGRdIGtleScsIHJhd0tleSwgJy0+IG1pZCcsIG1lc3NhZ2VJZCk7XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG5mdW5jdGlvbiBjb2xsZWN0Um93cyhub2RlOiBOb2RlKTogSFRNTEVsZW1lbnRbXSB7XHJcbiAgaWYgKCEobm9kZSBpbnN0YW5jZW9mIEhUTUxFbGVtZW50KSkgcmV0dXJuIFtdO1xyXG4gIGNvbnN0IHJvd3M6IEhUTUxFbGVtZW50W10gPSBbXTtcclxuICBpZiAobm9kZS5tYXRjaGVzKFJPV19TRUxFQ1RPUikpIHJvd3MucHVzaChub2RlKTtcclxuICByb3dzLnB1c2goLi4uQXJyYXkuZnJvbShub2RlLnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KFJPV19TRUxFQ1RPUikpKTtcclxuICByZXR1cm4gcm93cztcclxufVxyXG5cclxuZnVuY3Rpb24gY2xvc2VzdFJvdyhub2RlOiBOb2RlKTogSFRNTEVsZW1lbnQgfCBudWxsIHtcclxuICBpZiAoIShub2RlIGluc3RhbmNlb2YgSFRNTEVsZW1lbnQpKSByZXR1cm4gbm9kZS5wYXJlbnRFbGVtZW50Py5jbG9zZXN0PEhUTUxFbGVtZW50PihST1dfU0VMRUNUT1IpID8/IG51bGw7XHJcbiAgcmV0dXJuIG5vZGUubWF0Y2hlcyhST1dfU0VMRUNUT1IpID8gbm9kZSA6IG5vZGUuY2xvc2VzdDxIVE1MRWxlbWVudD4oUk9XX1NFTEVDVE9SKTtcclxufVxyXG5cclxuZnVuY3Rpb24gc3RhbXBFeGlzdGluZ1Jvd3MobGlzdDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcclxuICBsaXN0LnF1ZXJ5U2VsZWN0b3JBbGw8SFRNTEVsZW1lbnQ+KFJPV19TRUxFQ1RPUikuZm9yRWFjaChzdGFtcFJvdyk7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBpbml0UmVhY3RLZXlTdGFtcGVyKHJvb3Q6IERvY3VtZW50IHwgSFRNTEVsZW1lbnQgPSBkb2N1bWVudCk6IFJlYWN0S2V5U3RhbXBlckNvbnRyb2xsZXIge1xyXG4gIGNvbnN0IG93bmVyRG9jdW1lbnQgPSByb290IGluc3RhbmNlb2YgRG9jdW1lbnQgPyByb290IDogcm9vdC5vd25lckRvY3VtZW50O1xyXG4gIGNvbnN0IG9ic2VydmVyUm9vdCA9IHJvb3QgaW5zdGFuY2VvZiBEb2N1bWVudCA/IG93bmVyRG9jdW1lbnQuYm9keSA6IHJvb3Q7XHJcbiAgY29uc3QgTXV0YXRpb25PYnNlcnZlckN0b3IgPSBvd25lckRvY3VtZW50LmRlZmF1bHRWaWV3Py5NdXRhdGlvbk9ic2VydmVyID8/IE11dGF0aW9uT2JzZXJ2ZXI7XHJcblxyXG4gIGxldCBvYnNlcnZlZExpc3Q6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XHJcbiAgbGV0IGxpc3RPYnNlcnZlcjogTXV0YXRpb25PYnNlcnZlciB8IG51bGwgPSBudWxsO1xyXG4gIGxldCBib2R5T2JzZXJ2ZXI6IE11dGF0aW9uT2JzZXJ2ZXIgfCBudWxsID0gbnVsbDtcclxuICBjb25zdCBkZWxheWVkUGFzc2VzID0gbmV3IFNldDxudW1iZXI+KCk7XHJcblxyXG4gIGNvbnN0IHJlc3RhbXBDdXJyZW50TGlzdCA9ICgpOiB2b2lkID0+IHtcclxuICAgIGlmICghb2JzZXJ2ZWRMaXN0KSByZXR1cm47XHJcbiAgICBvYnNlcnZlZExpc3QucXVlcnlTZWxlY3RvckFsbDxIVE1MRWxlbWVudD4oUk9XX1NFTEVDVE9SKS5mb3JFYWNoKChyb3cpID0+IHtcclxuICAgICAgY29uc3QgY3VycmVudElkID0gcm93LmdldEF0dHJpYnV0ZShNSURfQVRUUik7XHJcbiAgICAgIGNvbnN0IG5leHRJZCA9IHJlYWRNZXNzYWdlSWQocm93KTtcclxuICAgICAgaWYgKCFjdXJyZW50SWQgfHwgY3VycmVudElkICE9PSBuZXh0SWQpIHtcclxuICAgICAgICBzdGFtcFJvdyhyb3cpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICB9O1xyXG5cclxuICBjb25zdCBzY2hlZHVsZURlbGF5ZWRSZXN0YW1wcyA9ICgpOiB2b2lkID0+IHtcclxuICAgIGZvciAoY29uc3QgZGVsYXlNcyBvZiBbMTAwLCAxMDAwXSkge1xyXG4gICAgICBjb25zdCB0aW1lb3V0SWQgPSB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgZGVsYXllZFBhc3Nlcy5kZWxldGUodGltZW91dElkKTtcclxuICAgICAgICByZXN0YW1wQ3VycmVudExpc3QoKTtcclxuICAgICAgfSwgZGVsYXlNcyk7XHJcbiAgICAgIGRlbGF5ZWRQYXNzZXMuYWRkKHRpbWVvdXRJZCk7XHJcbiAgICB9XHJcbiAgfTtcclxuXHJcbiAgY29uc3QgZGV0YWNoT2JzZXJ2ZWRMaXN0ID0gKCk6IHZvaWQgPT4ge1xyXG4gICAgbGlzdE9ic2VydmVyPy5kaXNjb25uZWN0KCk7XHJcbiAgICBsaXN0T2JzZXJ2ZXIgPSBudWxsO1xyXG4gICAgb2JzZXJ2ZWRMaXN0ID0gbnVsbDtcclxuICB9O1xyXG5cclxuICBjb25zdCBvYnNlcnZlTGlzdCA9IChsaXN0OiBIVE1MRWxlbWVudCk6IHZvaWQgPT4ge1xyXG4gICAgaWYgKGxpc3QgPT09IG9ic2VydmVkTGlzdCkgcmV0dXJuO1xyXG4gICAgbGlzdE9ic2VydmVyPy5kaXNjb25uZWN0KCk7XHJcbiAgICBvYnNlcnZlZExpc3QgPSBsaXN0O1xyXG4gICAgc3RhbXBFeGlzdGluZ1Jvd3MobGlzdCk7XHJcbiAgICBzY2hlZHVsZURlbGF5ZWRSZXN0YW1wcygpO1xyXG5cclxuICAgIGxpc3RPYnNlcnZlciA9IG5ldyBNdXRhdGlvbk9ic2VydmVyQ3RvcigobXV0YXRpb25zKSA9PiB7XHJcbiAgICAgIGZvciAoY29uc3QgbXV0YXRpb24gb2YgbXV0YXRpb25zKSB7XHJcbiAgICAgICAgY29uc3QgdGFyZ2V0Um93ID0gY2xvc2VzdFJvdyhtdXRhdGlvbi50YXJnZXQpO1xyXG4gICAgICAgIGlmICh0YXJnZXRSb3cpIHN0YW1wUm93KHRhcmdldFJvdyk7XHJcbiAgICAgICAgZm9yIChjb25zdCBub2RlIG9mIG11dGF0aW9uLmFkZGVkTm9kZXMpIHtcclxuICAgICAgICAgIGNvbGxlY3RSb3dzKG5vZGUpLmZvckVhY2goc3RhbXBSb3cpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgICBsaXN0T2JzZXJ2ZXIub2JzZXJ2ZShsaXN0LCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSwgYXR0cmlidXRlczogdHJ1ZSwgYXR0cmlidXRlRmlsdGVyOiBbJ2RhdGEtaW5kZXgnXSB9KTtcclxuICB9O1xyXG5cclxuICBjb25zdCBhdHRhY2hUb0N1cnJlbnRMaXN0ID0gKCk6IHZvaWQgPT4ge1xyXG4gICAgY29uc3QgbGlzdCA9IHJvb3QucXVlcnlTZWxlY3RvcjxIVE1MRWxlbWVudD4oQ0hBVF9MSVNUX1NFTEVDVE9SKTtcclxuICAgIGlmIChsaXN0KSB7XHJcbiAgICAgIG9ic2VydmVMaXN0KGxpc3QpO1xyXG4gICAgfSBlbHNlIGlmIChvYnNlcnZlZExpc3QpIHtcclxuICAgICAgLy8gQ2hhdCBjb2xsYXBzZS91bm1vdW50IGNhbiBsZWF2ZSB0aGUgbGlzdCBhYnNlbnQgaW5kZWZpbml0ZWx5LiBTdG9wIHRoZSBwZXItbGlzdCBvYnNlcnZlclxyXG4gICAgICAvLyBhbmQgcmVsZWFzZSB0aGUgZGV0YWNoZWQgUmVhY3Qgc3VidHJlZSB1bnRpbCBhIHJlcGxhY2VtZW50IGFwcGVhcnMuXHJcbiAgICAgIGRldGFjaE9ic2VydmVkTGlzdCgpO1xyXG4gICAgfVxyXG4gIH07XHJcblxyXG4gIGF0dGFjaFRvQ3VycmVudExpc3QoKTtcclxuXHJcbiAgYm9keU9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXJDdG9yKChyZWNvcmRzKSA9PiB7XHJcbiAgICBjb25zdCBjdXJyZW50V2FzRGV0YWNoZWQgPSBvYnNlcnZlZExpc3QgIT09IG51bGwgJiYgIW9ic2VydmVkTGlzdC5pc0Nvbm5lY3RlZDtcclxuICAgIGNvbnN0IGNvdWxkSW50cm9kdWNlTGlzdCA9IG9ic2VydmVkTGlzdCA9PT0gbnVsbCAmJiByZWNvcmRzLnNvbWUoKHJlY29yZCkgPT5cclxuICAgICAgQXJyYXkuZnJvbShyZWNvcmQuYWRkZWROb2Rlcykuc29tZSgobm9kZSkgPT4gbm9kZSBpbnN0YW5jZW9mIEVsZW1lbnQgJiYgKFxyXG4gICAgICAgIG5vZGUubWF0Y2hlcyhDSEFUX0xJU1RfU0VMRUNUT1IpIHx8IG5vZGUucXVlcnlTZWxlY3RvcihDSEFUX0xJU1RfU0VMRUNUT1IpICE9PSBudWxsXHJcbiAgICAgICkpLFxyXG4gICAgKTtcclxuICAgIGlmIChjdXJyZW50V2FzRGV0YWNoZWQgfHwgY291bGRJbnRyb2R1Y2VMaXN0KSBhdHRhY2hUb0N1cnJlbnRMaXN0KCk7XHJcbiAgfSk7XHJcbiAgaWYgKG9ic2VydmVyUm9vdCkge1xyXG4gICAgYm9keU9ic2VydmVyLm9ic2VydmUob2JzZXJ2ZXJSb290LCB7IGNoaWxkTGlzdDogdHJ1ZSwgc3VidHJlZTogdHJ1ZSB9KTtcclxuICB9XHJcbiAgY29uc3QgaW50ZXJ2YWxJZCA9IHdpbmRvdy5zZXRJbnRlcnZhbCgoKSA9PiB7XHJcbiAgICBhdHRhY2hUb0N1cnJlbnRMaXN0KCk7XHJcbiAgICByZXN0YW1wQ3VycmVudExpc3QoKTtcclxuICB9LCAxMDAwKTtcclxuXHJcbiAgcmV0dXJuIHtcclxuICAgIHJlc3RhbXBDdXJyZW50TGlzdCxcclxuICAgIHRlYXJkb3duKCk6IHZvaWQge1xyXG4gICAgICBkZXRhY2hPYnNlcnZlZExpc3QoKTtcclxuICAgICAgYm9keU9ic2VydmVyPy5kaXNjb25uZWN0KCk7XHJcbiAgICAgIHdpbmRvdy5jbGVhckludGVydmFsKGludGVydmFsSWQpO1xyXG4gICAgICBkZWxheWVkUGFzc2VzLmZvckVhY2goKHRpbWVvdXRJZCkgPT4gd2luZG93LmNsZWFyVGltZW91dCh0aW1lb3V0SWQpKTtcclxuICAgICAgZGVsYXllZFBhc3Nlcy5jbGVhcigpO1xyXG4gICAgICBib2R5T2JzZXJ2ZXIgPSBudWxsO1xyXG4gICAgfSxcclxuICB9O1xyXG59XHJcblxyXG5sZXQgYXV0b0NvbnRyb2xsZXI6IFJlYWN0S2V5U3RhbXBlckNvbnRyb2xsZXIgfCBudWxsID0gbnVsbDtcclxuXHJcbmZ1bmN0aW9uIHN0YXJ0KCk6IHZvaWQge1xyXG4gIGF1dG9Db250cm9sbGVyID8/PSBpbml0UmVhY3RLZXlTdGFtcGVyKCk7XHJcbn1cclxuXHJcbmlmIChkb2N1bWVudC5ib2R5KSB7XHJcbiAgc3RhcnQoKTtcclxufSBlbHNlIHtcclxuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignRE9NQ29udGVudExvYWRlZCcsIHN0YXJ0LCB7IG9uY2U6IHRydWUgfSk7XHJcbn1cclxuXHJcbndpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdwYWdlaGlkZScsICgpID0+IHtcclxuICBhdXRvQ29udHJvbGxlcj8udGVhcmRvd24oKTtcclxuICBhdXRvQ29udHJvbGxlciA9IG51bGw7XHJcbn0pO1xyXG53aW5kb3cuYWRk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
