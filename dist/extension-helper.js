"use strict";
(() => {
  // src/extension-helper-reporter.mjs
  function originOnly(value) {
    try {
      const u = new URL(value);
      return ["http:", "https:"].includes(u.protocol) ? u.origin : "";
    } catch {
      return "";
    }
  }
  function createReporter(options) {
    if (!/^[a-p]{32}$/.test(options.helperId))
      throw new Error("Invalid helper extension ID");
    const runtime = options.runtime ?? globalThis.chrome?.runtime;
    const env = options.environment ?? globalThis;
    const log = options.console ?? globalThis.console;
    const catalogue = { ...options.diagnostics, unclassified: "Unclassified extension diagnostic" };
    const now = options.now ?? Date.now;
    let windowStart = now(), sent = 0, stopped = false, installed = false;
    const originalWarn = log.warn, originalError = log.error;
    function classify(values) {
      for (const [code, literal] of Object.entries(catalogue)) {
        if (literal && values.some((v) => typeof v === "string" && v.includes(literal)))
          return code;
      }
      return "unclassified";
    }
    async function report(code = "unclassified", level = "error") {
      if (stopped || !runtime)
        return false;
      if (now() - windowStart >= 6e5) {
        windowStart = now();
        sent = 0;
      }
      if (sent >= 60)
        return false;
      sent++;
      const safeCode = Object.hasOwn(catalogue, code) && /^[a-z0-9-]{1,64}$/.test(code) ? code : "unclassified";
      let origin = "";
      try {
        origin = originOnly(options.origin?.() ?? globalThis.location?.href ?? "");
      } catch {
      }
      const payload = { type: "ext-helper.report.v1", code: safeCode, level: level === "warn" ? "warn" : "error", origin };
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), options.timeoutMs ?? 3e3);
        try {
          runtime.sendMessage(options.helperId, payload, (reply) => {
            clearTimeout(timer);
            const failed = Boolean(runtime.lastError);
            resolve(!failed && reply?.ok === true);
          });
        } catch {
          clearTimeout(timer);
          resolve(false);
        }
      });
    }
    const warn = (...args) => {
      Reflect.apply(originalWarn, log, args);
      void report(classify(args), "warn");
    };
    const error = (...args) => {
      Reflect.apply(originalError, log, args);
      void report(classify(args), "error");
    };
    const uncaught = () => {
      void report("unclassified");
    };
    return {
      report,
      install() {
        if (installed || stopped)
          return;
        installed = true;
        log.warn = warn;
        log.error = error;
        env.addEventListener("error", uncaught);
        env.addEventListener("unhandledrejection", uncaught);
      },
      stop() {
        stopped = true;
        if (!installed)
          return;
        if (log.warn === warn)
          log.warn = originalWarn;
        if (log.error === error)
          log.error = originalError;
        env.removeEventListener("error", uncaught);
        env.removeEventListener("unhandledrejection", uncaught);
      }
    };
  }

  // src/extension-helper.mjs
  var HELPER_ID = "idoajpmlahhhlamballfmbkggmfmmidh";
  var DIAGNOSTICS = Object.freeze({
    "quality-lock-gave-up": "quality-lock: gave up",
    "quality-lock-unconfirmed": "quality-lock: highest quality could not be confirmed",
    "self-check-failed": "Extension self-check failed"
  });
  var SLOT = "__laurethExtensionReporterV1";
  if (globalThis.chrome?.runtime?.sendMessage && typeof globalThis.addEventListener === "function" && !globalThis[SLOT]) {
    const reporter = createReporter({ helperId: HELPER_ID, diagnostics: DIAGNOSTICS });
    globalThis[SLOT] = reporter;
    reporter.install();
    globalThis.addEventListener("laureth:extension-diagnostic-v1", (event) => {
      const detail = event.detail;
      if (!detail || typeof detail !== "object" || Array.isArray(detail) || Object.keys(detail).length !== 1 || !Object.hasOwn(detail, "code") || !Object.hasOwn(DIAGNOSTICS, detail.code)) return;
      void reporter.report(detail.code);
    });
  }
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2V4dGVuc2lvbi1oZWxwZXItcmVwb3J0ZXIubWpzIiwgIi4uL3NyYy9leHRlbnNpb24taGVscGVyLm1qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiZXhwb3J0IGZ1bmN0aW9uIG9yaWdpbk9ubHkodmFsdWUpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgdSA9IG5ldyBVUkwodmFsdWUpO1xyXG4gICAgICAgIHJldHVybiBbJ2h0dHA6JywgJ2h0dHBzOiddLmluY2x1ZGVzKHUucHJvdG9jb2wpID8gdS5vcmlnaW4gOiAnJztcclxuICAgIH1cclxuICAgIGNhdGNoIHtcclxuICAgICAgICByZXR1cm4gJyc7XHJcbiAgICB9XHJcbn1cclxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVJlcG9ydGVyKG9wdGlvbnMpIHtcclxuICAgIGlmICghL15bYS1wXXszMn0kLy50ZXN0KG9wdGlvbnMuaGVscGVySWQpKVxyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBoZWxwZXIgZXh0ZW5zaW9uIElEJyk7XHJcbiAgICBjb25zdCBydW50aW1lID0gb3B0aW9ucy5ydW50aW1lID8/IGdsb2JhbFRoaXMuY2hyb21lPy5ydW50aW1lO1xyXG4gICAgY29uc3QgZW52ID0gb3B0aW9ucy5lbnZpcm9ubWVudCA/PyBnbG9iYWxUaGlzO1xyXG4gICAgY29uc3QgbG9nID0gb3B0aW9ucy5jb25zb2xlID8/IGdsb2JhbFRoaXMuY29uc29sZTtcclxuICAgIGNvbnN0IGNhdGFsb2d1ZSA9IHsgLi4ub3B0aW9ucy5kaWFnbm9zdGljcywgdW5jbGFzc2lmaWVkOiAnVW5jbGFzc2lmaWVkIGV4dGVuc2lvbiBkaWFnbm9zdGljJyB9O1xyXG4gICAgY29uc3Qgbm93ID0gb3B0aW9ucy5ub3cgPz8gRGF0ZS5ub3c7XHJcbiAgICBsZXQgd2luZG93U3RhcnQgPSBub3coKSwgc2VudCA9IDAsIHN0b3BwZWQgPSBmYWxzZSwgaW5zdGFsbGVkID0gZmFsc2U7XHJcbiAgICBjb25zdCBvcmlnaW5hbFdhcm4gPSBsb2cud2Fybiwgb3JpZ2luYWxFcnJvciA9IGxvZy5lcnJvcjtcclxuICAgIGZ1bmN0aW9uIGNsYXNzaWZ5KHZhbHVlcykge1xyXG4gICAgICAgIC8vIE5ldmVyIGluc3BlY3Qgb2JqZWN0cywgZ2V0dGVycywgcmVqZWN0aW9uIHJlYXNvbnMsIEVycm9yLm1lc3NhZ2Ugb3Igc3RhY2suXHJcbiAgICAgICAgZm9yIChjb25zdCBbY29kZSwgbGl0ZXJhbF0gb2YgT2JqZWN0LmVudHJpZXMoY2F0YWxvZ3VlKSkge1xyXG4gICAgICAgICAgICBpZiAobGl0ZXJhbCAmJiB2YWx1ZXMuc29tZSh2ID0+IHR5cGVvZiB2ID09PSAnc3RyaW5nJyAmJiB2LmluY2x1ZGVzKGxpdGVyYWwpKSlcclxuICAgICAgICAgICAgICAgIHJldHVybiBjb2RlO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gJ3VuY2xhc3NpZmllZCc7XHJcbiAgICB9XHJcbiAgICBhc3luYyBmdW5jdGlvbiByZXBvcnQoY29kZSA9ICd1bmNsYXNzaWZpZWQnLCBsZXZlbCA9ICdlcnJvcicpIHtcclxuICAgICAgICBpZiAoc3RvcHBlZCB8fCAhcnVudGltZSlcclxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgIGlmIChub3coKSAtIHdpbmRvd1N0YXJ0ID49IDYwMF8wMDApIHtcclxuICAgICAgICAgICAgd2luZG93U3RhcnQgPSBub3coKTtcclxuICAgICAgICAgICAgc2VudCA9IDA7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChzZW50ID49IDYwKVxyXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgc2VudCsrO1xyXG4gICAgICAgIGNvbnN0IHNhZmVDb2RlID0gT2JqZWN0Lmhhc093bihjYXRhbG9ndWUsIGNvZGUpICYmIC9eW2EtejAtOS1dezEsNjR9JC8udGVzdChjb2RlKSA/IGNvZGUgOiAndW5jbGFzc2lmaWVkJztcclxuICAgICAgICBsZXQgb3JpZ2luID0gJyc7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgb3JpZ2luID0gb3JpZ2luT25seShvcHRpb25zLm9yaWdpbj8uKCkgPz8gZ2xvYmFsVGhpcy5sb2NhdGlvbj8uaHJlZiA/PyAnJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNhdGNoIHsgLyogbm8gcGFnZSBkYXRhICovIH1cclxuICAgICAgICBjb25zdCBwYXlsb2FkID0geyB0eXBlOiAnZXh0LWhlbHBlci5yZXBvcnQudjEnLCBjb2RlOiBzYWZlQ29kZSwgbGV2ZWw6IGxldmVsID09PSAnd2FybicgPyAnd2FybicgOiAnZXJyb3InLCBvcmlnaW4gfTtcclxuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZSA9PiB7XHJcbiAgICAgICAgICAgIGNvbnN0IHRpbWVyID0gc2V0VGltZW91dCgoKSA9PiByZXNvbHZlKGZhbHNlKSwgb3B0aW9ucy50aW1lb3V0TXMgPz8gMzAwMCk7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICBydW50aW1lLnNlbmRNZXNzYWdlKG9wdGlvbnMuaGVscGVySWQsIHBheWxvYWQsIHJlcGx5ID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQodGltZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGZhaWxlZCA9IEJvb2xlYW4ocnVudGltZS5sYXN0RXJyb3IpOyAvLyBDb25zdW1lIENocm9tZSBjYWxsYmFjayBlcnJvciwgbmV2ZXIgbG9nIGl0IHJlY3Vyc2l2ZWx5LlxyXG4gICAgICAgICAgICAgICAgICAgIHJlc29sdmUoIWZhaWxlZCAmJiByZXBseT8ub2sgPT09IHRydWUpO1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgY2F0Y2gge1xyXG4gICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVyKTtcclxuICAgICAgICAgICAgICAgIHJlc29sdmUoZmFsc2UpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBjb25zdCB3YXJuID0gKC4uLmFyZ3MpID0+IHtcclxuICAgICAgICBSZWZsZWN0LmFwcGx5KG9yaWdpbmFsV2FybiwgbG9nLCBhcmdzKTtcclxuICAgICAgICB2b2lkIHJlcG9ydChjbGFzc2lmeShhcmdzKSwgJ3dhcm4nKTtcclxuICAgIH07XHJcbiAgICBjb25zdCBlcnJvciA9ICguLi5hcmdzKSA9PiB7XHJcbiAgICAgICAgUmVmbGVjdC5hcHBseShvcmlnaW5hbEVycm9yLCBsb2csIGFyZ3MpO1xyXG4gICAgICAgIHZvaWQgcmVwb3J0KGNsYXNzaWZ5KGFyZ3MpLCAnZXJyb3InKTtcclxuICAgIH07XHJcbiAgICBjb25zdCB1bmNhdWdodCA9ICgpID0+IHsgdm9pZCByZXBvcnQoJ3VuY2xhc3NpZmllZCcpOyB9O1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICByZXBvcnQsXHJcbiAgICAgICAgaW5zdGFsbCgpIHtcclxuICAgICAgICAgICAgaWYgKGluc3RhbGxlZCB8fCBzdG9wcGVkKVxyXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICBpbnN0YWxsZWQgPSB0cnVlO1xyXG4gICAgICAgICAgICBsb2cud2FybiA9IHdhcm47XHJcbiAgICAgICAgICAgIGxvZy5lcnJvciA9IGVycm9yO1xyXG4gICAgICAgICAgICBlbnYuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCB1bmNhdWdodCk7XHJcbiAgICAgICAgICAgIGVudi5hZGRFdmVudExpc3RlbmVyKCd1bmhhbmRsZWRyZWplY3Rpb24nLCB1bmNhdWdodCk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBzdG9wKCkge1xyXG4gICAgICAgICAgICBzdG9wcGVkID0gdHJ1ZTtcclxuICAgICAgICAgICAgaWYgKCFpbnN0YWxsZWQpXHJcbiAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgIGlmIChsb2cud2FybiA9PT0gd2FybilcclxuICAgICAgICAgICAgICAgIGxvZy53YXJuID0gb3JpZ2luYWxXYXJuO1xyXG4gICAgICAgICAgICBpZiAobG9nLmVycm9yID09PSBlcnJvcilcclxuICAgICAgICAgICAgICAgIGxvZy5lcnJvciA9IG9yaWdpbmFsRXJyb3I7XHJcbiAgICAgICAgICAgIGVudi5yZW1vdmVFdmVudExpc3RlbmVyKCdlcnJvcicsIHVuY2F1Z2h0KTtcclxuICAgICAgICAgICAgZW52LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3VuaGFuZGxlZHJlamVjdGlvbicsIHVuY2F1Z2h0KTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG59XHJcbiIsICIvLyBFeHRlbnNpb24tb25seSBkaWFnbm9zdGljcyBjb21wb3NpdGlvbiByb290LiBBcHByb3ZlZCBpbnRlZ3JhdGlvbjogMjAyNi0xMC0yMi5cclxuaW1wb3J0IHsgY3JlYXRlUmVwb3J0ZXIgfSBmcm9tICcuL2V4dGVuc2lvbi1oZWxwZXItcmVwb3J0ZXIubWpzJztcclxuXHJcbmV4cG9ydCBjb25zdCBIRUxQRVJfSUQgPSAnaWRvYWpwbWxhaGhobGFtYmFsbGZtYmtnZ21mbW1pZGgnO1xyXG5leHBvcnQgY29uc3QgRElBR05PU1RJQ1MgPSBPYmplY3QuZnJlZXplKHtcclxuICAncXVhbGl0eS1sb2NrLWdhdmUtdXAnOiAncXVhbGl0eS1sb2NrOiBnYXZlIHVwJyxcclxuICAncXVhbGl0eS1sb2NrLXVuY29uZmlybWVkJzogJ3F1YWxpdHktbG9jazogaGlnaGVzdCBxdWFsaXR5IGNvdWxkIG5vdCBiZSBjb25maXJtZWQnLFxyXG4gICdzZWxmLWNoZWNrLWZhaWxlZCc6ICdFeHRlbnNpb24gc2VsZi1jaGVjayBmYWlsZWQnLFxyXG59KTtcclxuY29uc3QgU0xPVCA9ICdfX2xhdXJldGhFeHRlbnNpb25SZXBvcnRlclYxJztcclxuLy8gTm9kZSBmaXh0dXJlcyBhbmQgTUFJTi13b3JsZCBwYWdlIHNjcmlwdHMgaGF2ZSBubyBleHRlbnNpb24gdHJhbnNwb3J0LlxyXG5pZiAoZ2xvYmFsVGhpcy5jaHJvbWU/LnJ1bnRpbWU/LnNlbmRNZXNzYWdlICYmIHR5cGVvZiBnbG9iYWxUaGlzLmFkZEV2ZW50TGlzdGVuZXIgPT09ICdmdW5jdGlvbidcclxuICAgICYmICFnbG9iYWxUaGlzW1NMT1RdKSB7XHJcbiAgY29uc3QgcmVwb3J0ZXIgPSBjcmVhdGVSZXBvcnRlcih7IGhlbHBlcklkOiBIRUxQRVJfSUQsIGRpYWdub3N0aWNzOiBESUFHTk9TVElDUyB9KTtcclxuICBnbG9iYWxUaGlzW1NMT1RdID0gcmVwb3J0ZXI7XHJcbiAgcmVwb3J0ZXIuaW5zdGFsbCgpO1xyXG4gIC8vIFRoaXMgcGFnZS1zcG9vZmFibGUsIGNvZGUtb25seSBicmlkZ2UgY2FuIG9ubHkgY291bnQgZGlhZ25vc3RpY3MuXHJcbiAgZ2xvYmFsVGhpcy5hZGRFdmVudExpc3RlbmVyKCdsYXVyZXRoOmV4dGVuc2lvbi1kaWFnbm9zdGljLXYxJywgKGV2ZW50KSA9PiB7XHJcbiAgICBjb25zdCBkZXRhaWwgPSBldmVudC5kZXRhaWw7XHJcbiAgICBpZiAoIWRldGFpbCB8fCB0eXBlb2YgZGV0YWlsICE9PSAnb2JqZWN0JyB8fCBBcnJheS5pc0FycmF5KGRldGFpbClcclxuICAgICAgICB8fCBPYmplY3Qua2V5cyhkZXRhaWwpLmxlbmd0aCAhPT0gMSB8fCAhT2JqZWN0Lmhhc093bihkZXRhaWwsICdjb2RlJylcclxuICAgICAgICB8fCAhT2JqZWN0Lmhhc093bihESUFHTk9TVElDUywgZGV0YWlsLmNvZGUpKSByZXR1cm47XHJcbiAgICB2b2lkIHJlcG9ydGVyLnJlcG9ydChkZXRhaWwuY29kZSk7XHJcbiAgfSk7XHJcbn1cclxuXHJcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQUFPLFdBQVMsV0FBVyxPQUFPO0FBQzlCLFFBQUk7QUFDQSxZQUFNLElBQUksSUFBSSxJQUFJLEtBQUs7QUFDdkIsYUFBTyxDQUFDLFNBQVMsUUFBUSxFQUFFLFNBQVMsRUFBRSxR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
