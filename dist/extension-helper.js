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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2V4dGVuc2lvbi1oZWxwZXItcmVwb3J0ZXIubWpzIiwgIi4uL3NyYy9leHRlbnNpb24taGVscGVyLm1qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiZXhwb3J0IGZ1bmN0aW9uIG9yaWdpbk9ubHkodmFsdWUpIHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCB1ID0gbmV3IFVSTCh2YWx1ZSk7XG4gICAgICAgIHJldHVybiBbJ2h0dHA6JywgJ2h0dHBzOiddLmluY2x1ZGVzKHUucHJvdG9jb2wpID8gdS5vcmlnaW4gOiAnJztcbiAgICB9XG4gICAgY2F0Y2gge1xuICAgICAgICByZXR1cm4gJyc7XG4gICAgfVxufVxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVJlcG9ydGVyKG9wdGlvbnMpIHtcbiAgICBpZiAoIS9eW2EtcF17MzJ9JC8udGVzdChvcHRpb25zLmhlbHBlcklkKSlcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGhlbHBlciBleHRlbnNpb24gSUQnKTtcbiAgICBjb25zdCBydW50aW1lID0gb3B0aW9ucy5ydW50aW1lID8/IGdsb2JhbFRoaXMuY2hyb21lPy5ydW50aW1lO1xuICAgIGNvbnN0IGVudiA9IG9wdGlvbnMuZW52aXJvbm1lbnQgPz8gZ2xvYmFsVGhpcztcbiAgICBjb25zdCBsb2cgPSBvcHRpb25zLmNvbnNvbGUgPz8gZ2xvYmFsVGhpcy5jb25zb2xlO1xuICAgIGNvbnN0IGNhdGFsb2d1ZSA9IHsgLi4ub3B0aW9ucy5kaWFnbm9zdGljcywgdW5jbGFzc2lmaWVkOiAnVW5jbGFzc2lmaWVkIGV4dGVuc2lvbiBkaWFnbm9zdGljJyB9O1xuICAgIGNvbnN0IG5vdyA9IG9wdGlvbnMubm93ID8/IERhdGUubm93O1xuICAgIGxldCB3aW5kb3dTdGFydCA9IG5vdygpLCBzZW50ID0gMCwgc3RvcHBlZCA9IGZhbHNlLCBpbnN0YWxsZWQgPSBmYWxzZTtcbiAgICBjb25zdCBvcmlnaW5hbFdhcm4gPSBsb2cud2Fybiwgb3JpZ2luYWxFcnJvciA9IGxvZy5lcnJvcjtcbiAgICBmdW5jdGlvbiBjbGFzc2lmeSh2YWx1ZXMpIHtcbiAgICAgICAgLy8gTmV2ZXIgaW5zcGVjdCBvYmplY3RzLCBnZXR0ZXJzLCByZWplY3Rpb24gcmVhc29ucywgRXJyb3IubWVzc2FnZSBvciBzdGFjay5cbiAgICAgICAgZm9yIChjb25zdCBbY29kZSwgbGl0ZXJhbF0gb2YgT2JqZWN0LmVudHJpZXMoY2F0YWxvZ3VlKSkge1xuICAgICAgICAgICAgaWYgKGxpdGVyYWwgJiYgdmFsdWVzLnNvbWUodiA9PiB0eXBlb2YgdiA9PT0gJ3N0cmluZycgJiYgdi5pbmNsdWRlcyhsaXRlcmFsKSkpXG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvZGU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuICd1bmNsYXNzaWZpZWQnO1xuICAgIH1cbiAgICBhc3luYyBmdW5jdGlvbiByZXBvcnQoY29kZSA9ICd1bmNsYXNzaWZpZWQnLCBsZXZlbCA9ICdlcnJvcicpIHtcbiAgICAgICAgaWYgKHN0b3BwZWQgfHwgIXJ1bnRpbWUpXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIGlmIChub3coKSAtIHdpbmRvd1N0YXJ0ID49IDYwMF8wMDApIHtcbiAgICAgICAgICAgIHdpbmRvd1N0YXJ0ID0gbm93KCk7XG4gICAgICAgICAgICBzZW50ID0gMDtcbiAgICAgICAgfVxuICAgICAgICBpZiAoc2VudCA+PSA2MClcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgc2VudCsrO1xuICAgICAgICBjb25zdCBzYWZlQ29kZSA9IE9iamVjdC5oYXNPd24oY2F0YWxvZ3VlLCBjb2RlKSAmJiAvXlthLXowLTktXXsxLDY0fSQvLnRlc3QoY29kZSkgPyBjb2RlIDogJ3VuY2xhc3NpZmllZCc7XG4gICAgICAgIGxldCBvcmlnaW4gPSAnJztcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIG9yaWdpbiA9IG9yaWdpbk9ubHkob3B0aW9ucy5vcmlnaW4/LigpID8/IGdsb2JhbFRoaXMubG9jYXRpb24/LmhyZWYgPz8gJycpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIHsgLyogbm8gcGFnZSBkYXRhICovIH1cbiAgICAgICAgY29uc3QgcGF5bG9hZCA9IHsgdHlwZTogJ2V4dC1oZWxwZXIucmVwb3J0LnYxJywgY29kZTogc2FmZUNvZGUsIGxldmVsOiBsZXZlbCA9PT0gJ3dhcm4nID8gJ3dhcm4nIDogJ2Vycm9yJywgb3JpZ2luIH07XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHRpbWVyID0gc2V0VGltZW91dCgoKSA9PiByZXNvbHZlKGZhbHNlKSwgb3B0aW9ucy50aW1lb3V0TXMgPz8gMzAwMCk7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHJ1bnRpbWUuc2VuZE1lc3NhZ2Uob3B0aW9ucy5oZWxwZXJJZCwgcGF5bG9hZCwgcmVwbHkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQodGltZXIpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBmYWlsZWQgPSBCb29sZWFuKHJ1bnRpbWUubGFzdEVycm9yKTsgLy8gQ29uc3VtZSBDaHJvbWUgY2FsbGJhY2sgZXJyb3IsIG5ldmVyIGxvZyBpdCByZWN1cnNpdmVseS5cbiAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZSghZmFpbGVkICYmIHJlcGx5Py5vayA9PT0gdHJ1ZSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXRjaCB7XG4gICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVyKTtcbiAgICAgICAgICAgICAgICByZXNvbHZlKGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuICAgIGNvbnN0IHdhcm4gPSAoLi4uYXJncykgPT4ge1xuICAgICAgICBSZWZsZWN0LmFwcGx5KG9yaWdpbmFsV2FybiwgbG9nLCBhcmdzKTtcbiAgICAgICAgdm9pZCByZXBvcnQoY2xhc3NpZnkoYXJncyksICd3YXJuJyk7XG4gICAgfTtcbiAgICBjb25zdCBlcnJvciA9ICguLi5hcmdzKSA9PiB7XG4gICAgICAgIFJlZmxlY3QuYXBwbHkob3JpZ2luYWxFcnJvciwgbG9nLCBhcmdzKTtcbiAgICAgICAgdm9pZCByZXBvcnQoY2xhc3NpZnkoYXJncyksICdlcnJvcicpO1xuICAgIH07XG4gICAgY29uc3QgdW5jYXVnaHQgPSAoKSA9PiB7IHZvaWQgcmVwb3J0KCd1bmNsYXNzaWZpZWQnKTsgfTtcbiAgICByZXR1cm4ge1xuICAgICAgICByZXBvcnQsXG4gICAgICAgIGluc3RhbGwoKSB7XG4gICAgICAgICAgICBpZiAoaW5zdGFsbGVkIHx8IHN0b3BwZWQpXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgaW5zdGFsbGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIGxvZy53YXJuID0gd2FybjtcbiAgICAgICAgICAgIGxvZy5lcnJvciA9IGVycm9yO1xuICAgICAgICAgICAgZW52LmFkZEV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgdW5jYXVnaHQpO1xuICAgICAgICAgICAgZW52LmFkZEV2ZW50TGlzdGVuZXIoJ3VuaGFuZGxlZHJlamVjdGlvbicsIHVuY2F1Z2h0KTtcbiAgICAgICAgfSxcbiAgICAgICAgc3RvcCgpIHtcbiAgICAgICAgICAgIHN0b3BwZWQgPSB0cnVlO1xuICAgICAgICAgICAgaWYgKCFpbnN0YWxsZWQpXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgaWYgKGxvZy53YXJuID09PSB3YXJuKVxuICAgICAgICAgICAgICAgIGxvZy53YXJuID0gb3JpZ2luYWxXYXJuO1xuICAgICAgICAgICAgaWYgKGxvZy5lcnJvciA9PT0gZXJyb3IpXG4gICAgICAgICAgICAgICAgbG9nLmVycm9yID0gb3JpZ2luYWxFcnJvcjtcbiAgICAgICAgICAgIGVudi5yZW1vdmVFdmVudExpc3RlbmVyKCdlcnJvcicsIHVuY2F1Z2h0KTtcbiAgICAgICAgICAgIGVudi5yZW1vdmVFdmVudExpc3RlbmVyKCd1bmhhbmRsZWRyZWplY3Rpb24nLCB1bmNhdWdodCk7XG4gICAgICAgIH1cbiAgICB9O1xufVxuIiwgIi8vIEV4dGVuc2lvbi1vbmx5IGRpYWdub3N0aWNzIGNvbXBvc2l0aW9uIHJvb3QuIEFwcHJvdmVkIGludGVncmF0aW9uOiAyMDI2LTEwLTIyLlxuaW1wb3J0IHsgY3JlYXRlUmVwb3J0ZXIgfSBmcm9tICcuL2V4dGVuc2lvbi1oZWxwZXItcmVwb3J0ZXIubWpzJztcblxuZXhwb3J0IGNvbnN0IEhFTFBFUl9JRCA9ICdpZG9hanBtbGFoaGhsYW1iYWxsZm1ia2dnbWZtbWlkaCc7XG5leHBvcnQgY29uc3QgRElBR05PU1RJQ1MgPSBPYmplY3QuZnJlZXplKHtcbiAgJ3F1YWxpdHktbG9jay1nYXZlLXVwJzogJ3F1YWxpdHktbG9jazogZ2F2ZSB1cCcsXG4gICdxdWFsaXR5LWxvY2stdW5jb25maXJtZWQnOiAncXVhbGl0eS1sb2NrOiBoaWdoZXN0IHF1YWxpdHkgY291bGQgbm90IGJlIGNvbmZpcm1lZCcsXG4gICdzZWxmLWNoZWNrLWZhaWxlZCc6ICdFeHRlbnNpb24gc2VsZi1jaGVjayBmYWlsZWQnLFxufSk7XG5jb25zdCBTTE9UID0gJ19fbGF1cmV0aEV4dGVuc2lvblJlcG9ydGVyVjEnO1xuLy8gTm9kZSBmaXh0dXJlcyBhbmQgTUFJTi13b3JsZCBwYWdlIHNjcmlwdHMgaGF2ZSBubyBleHRlbnNpb24gdHJhbnNwb3J0LlxuaWYgKGdsb2JhbFRoaXMuY2hyb21lPy5ydW50aW1lPy5zZW5kTWVzc2FnZSAmJiB0eXBlb2YgZ2xvYmFsVGhpcy5hZGRFdmVudExpc3RlbmVyID09PSAnZnVuY3Rpb24nXG4gICAgJiYgIWdsb2JhbFRoaXNbU0xPVF0pIHtcbiAgY29uc3QgcmVwb3J0ZXIgPSBjcmVhdGVSZXBvcnRlcih7IGhlbHBlcklkOiBIRUxQRVJfSUQsIGRpYWdub3N0aWNzOiBESUFHTk9TVElDUyB9KTtcbiAgZ2xvYmFsVGhpc1tTTE9UXSA9IHJlcG9ydGVyO1xuICByZXBvcnRlci5pbnN0YWxsKCk7XG4gIC8vIFRoaXMgcGFnZS1zcG9vZmFibGUsIGNvZGUtb25seSBicmlkZ2UgY2FuIG9ubHkgY291bnQgZGlhZ25vc3RpY3MuXG4gIGdsb2JhbFRoaXMuYWRkRXZlbnRMaXN0ZW5lcignbGF1cmV0aDpleHRlbnNpb24tZGlhZ25vc3RpYy12MScsIChldmVudCkgPT4ge1xuICAgIGNvbnN0IGRldGFpbCA9IGV2ZW50LmRldGFpbDtcbiAgICBpZiAoIWRldGFpbCB8fCB0eXBlb2YgZGV0YWlsICE9PSAnb2JqZWN0JyB8fCBBcnJheS5pc0FycmF5KGRldGFpbClcbiAgICAgICAgfHwgT2JqZWN0LmtleXMoZGV0YWlsKS5sZW5ndGggIT09IDEgfHwgIU9iamVjdC5oYXNPd24oZGV0YWlsLCAnY29kZScpXG4gICAgICAgIHx8ICFPYmplY3QuaGFzT3duKERJQUdOT1NUSUNTLCBkZXRhaWwuY29kZSkpIHJldHVybjtcbiAgICB2b2lkIHJlcG9ydGVyLnJlcG9ydChkZXRhaWwuY29kZSk7XG4gIH0pO1xufVxuXG4iXSwKICAibWFwcGluZ3MiOiAiOzs7QUFBTyxXQUFTLFdBQVcsT0FBTztBQUM5QixRQUFJO0FBQ0EsWUFBTSxJQUFJLElBQUksSUFBSSxLQUFLO0FBQ3ZCLGFBQU8sQ0FBQyxTQUFTLFFBQVEsRUFBRSxTQUFTLEVBQUUsUUFBUSxJQUFJLEVBQUUsU0FBUztBQUFBLElBQ2pFLFFBQ007QUFDRixhQUFPO0FBQUEsSUFDWDtBQUFBLEVBQ0o7QUFDTyxXQUFTLGVBQWUsU0FBUztBQUNwQyxRQUFJLENBQUMsY0FBYyxLQUFLLFFBQVEsUUFBUTtBQUNwQyxZQUFNLElBQUksTUFBTSw2QkFBNkI7QUFDakQsVUFBTSxVQUFVLFFBQVEsV0FBVyxXQUFXLFFBQVE7QUFDdEQsVUFBTSxNQUFNLFFBQVEsZUFBZTtBQUNuQyxVQUFNLE1BQU0sUUFBUSxXQUFX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
